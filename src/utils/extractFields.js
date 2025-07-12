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
    'You do not need to return structured JSON — the backend will extract what it needs from your conversation.',
    '',
    'Simply chat with the guest naturally and ask for:',
    '- their name',
    '- party size',
    '- contact info',
    '- preferred date and time',
    '',
    'Do not confirm anything yourself — the backend will respond after processing your messages.'
  ].join('\n');

  const messages = Array.isArray(vivInput.messages)
    ? [{ role: 'system', content: systemPrompt }, ...vivInput.messages]
    : [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: vivInput.text || '' }
      ];

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
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);

        const supportedTypes = [
          'reservation.request',
          'changeReservation',
          'cancelReservation',
          'availability.check'
        ];

        if (parsed?.type && supportedTypes.includes(parsed.type)) {
          return {
            type: parsed.type,
            parsed: parsed.parsed || {},
            raw: aiResponse
          };
        } else {
          console.warn('[extractFields] ❌ Unsupported or missing "type" in parsed JSON:', parsed?.type);
          // Attempt fallback if type is unsupported
          const recentUserMessage = messages
            .filter(m => m.role === 'user')
            .map(m => m.content)
            .join(' ')
            .trim();

          const fallback = tryFallbackParse(recentUserMessage);
          if (fallback) {
            console.log('[extractFields] 🔁 Fallback parse success (invalid JSON path):', fallback);
            return {
              type: 'changeReservation',
              parsed: fallback,
              raw: aiResponse
            };
          }
        }
      } catch (e) {
        console.warn('[extractFields] ⚠️ JSON block detected but failed to parse:', e);
      }
    }

    // Fallback logic begins here (pure chat)
    const recentUserMessage = messages
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .join(' ')
      .trim();

    console.log('[extractFields] 🧪 Attempting fallback parse:', recentUserMessage);

    const fallback = tryFallbackParse(recentUserMessage);
    if (fallback) {
      console.log('[extractFields] 🔁 Fallback parse success:', fallback);
      return {
        type: 'changeReservation',
        parsed: fallback,
        raw: aiResponse
      };
    }

    console.warn('[extractFields] ℹ️ No JSON or fallback fields detected — returning as chat');
    return {
      type: 'chat',
      parsed: {},
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

const tryFallbackParse = (text) => {
  const codeMatch = text.match(/\b[a-zA-Z0-9]{6,10}\b/);
  const dateTimeMatch = text.match(/(\d{1,2}\s+\w+)\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);

  if (!codeMatch || !dateTimeMatch) return null;

  const confirmationCode = codeMatch[0];
  const dateStr = `${dateTimeMatch[1]} 2025`;
  const timeStr = dateTimeMatch[2].replace(/\s+/g, '').toUpperCase();

  try {
    const parsed = new Date(`${dateStr} ${timeStr}`);
    const newDate = parsed.toISOString().split('T')[0];
    const newTimeSlot = parsed.toTimeString().slice(0, 5);
    return { confirmationCode, newDate, newTimeSlot };
  } catch {
    return null;
  }
};
