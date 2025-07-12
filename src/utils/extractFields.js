import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

export const extractFields = async (vivInput, restaurantId) => {
  const start = Date.now();
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[extractFields] 🚀 Triggered');
  console.log('[extractFields] 📬 Input message:', vivInput);
  console.log('[extractFields] 📌 restaurantId:', restaurantId);

  const systemPrompt = [
    'You are Viv, a helpful and warm AI concierge who helps users make, cancel, or change reservations, or check availability.',
    'When the user has provided all necessary information, respond first with a single valid JSON object.',
    'Then, in your own words, briefly confirm what you’ve done in a friendly tone.',
    'If the user hasn’t provided enough info, continue the conversation naturally to gather what’s missing.',
    '',
    'Examples:',
    '1. Reservation:',
    '{"type":"reservation.complete","name":"John","partySize":2,"contactInfo":"john@example.com","date":"2025-07-10","timeSlot":"18:00"}',
    '(Then confirm the booking naturally in your own words)',
    '',
    '2. Cancellation:',
    '{"type":"reservation.cancel","confirmationCode":"ABC123"}',
    '(Then confirm the cancellation in your own words)',
    '',
    '3. Change:',
    '{"type":"reservation.change","confirmationCode":"ABC123","newDate":"2025-07-11","newTimeSlot":"19:00"}',
    '(Then confirm the change naturally in your own words)',
    '',
    '4. Availability:',
    '{"type":"availability.check","date":"2025-07-12","timeSlot":"18:30"}',
    '(Then say you’ll check or report if it’s available)',
    '',
    'Do not repeat these examples. Use your own words freely.'
  ].join('\n');

  const messages = Array.isArray(vivInput.messages)
    ? [{ role: 'system', content: systemPrompt }, ...vivInput.messages]
    : [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: vivInput.text || '' }
      ];

  // ✅ Ignore known structured system echo to prevent duplicate reservations
  const hasStructuredSystemEcho = Array.isArray(vivInput.messages) &&
    vivInput.messages.some(
      m => m.role === 'system' &&
           typeof m.content === 'string' &&
           m.content.includes('"type":"reservation.complete"')
    );

  if (hasStructuredSystemEcho) {
    console.warn('[extractFields] 🚫 Structured reservation object found in system message. Skipping reparse.');
    return {
      type: 'chat',
      parsed: {},
      raw: 'System reservation context received — no action taken.'
    };
  }

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Organization': process.env.OPENAI_ORG_ID,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        temperature: 0.8,
        messages
      }),
    });

    console.log('[extractFields] 📡 OpenAI response status:', openaiRes.status);
    const json = await openaiRes.json();
    console.log('[extractFields] 🧾 Full OpenAI JSON:', JSON.stringify(json, null, 2));

    if (json.error) {
      console.error('[extractFields] ❌ OpenAI API returned error:', json.error);
      return { error: `OpenAI API error: ${json.error.message}` };
    }

    const aiResponse = json.choices?.[0]?.message?.content?.trim() ?? '';
    console.log('[extractFields] 💬 AI Raw Content:', aiResponse);

    const match = aiResponse.match(/{.*?}/s);
    if (!match) {
      console.warn('[extractFields] ℹ️ No JSON detected — treating as freeform assistant response');
      return {
        type: 'chat',
        parsed: {},
        raw: aiResponse
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(match[0]);
      if (!parsed.type) {
        console.warn('[extractFields] ❌ No "type" field in parsed JSON:', parsed);
        return {
          type: 'chat',
          parsed: {},
          raw: aiResponse
        };
      }
    } catch (e) {
      console.error('[extractFields] 💥 JSON parse error:', e);
      return {
        type: 'chat',
        parsed: {},
        raw: aiResponse
      };
    }

    const elapsed = Date.now() - start;
    console.log(`[extractFields] ✅ Success in ${elapsed}ms — Parsed JSON:`, parsed);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return {
      type: parsed.type,
      parsed,
      raw: aiResponse
    };

  } catch (error) {
    console.error('[extractFields] ❌ Fatal failure:', error);
    return {
      type: 'chat',
      parsed: {},
      raw: '❌ Sorry, something went wrong. Please try again.'
    };
  }
};
