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
    '',
    '⚠️ Important: If the user has provided enough information, respond first with a single valid JSON block.',
    'Never speak before the JSON. Use natural language only after the backend has responded.',
    'Always use one of the following values for `type`: "reservation.complete", "reservation.cancel", "reservation.change", "availability.check".',
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
      return { type: 'chat', parsed: {} };
    }

    const aiResponse = json.choices?.[0]?.message?.content?.trim() ?? '';
    console.log('[extractFields] 💬 AI Raw Content:', aiResponse);

    let parsed;
    try {
      const jsonStart = aiResponse.indexOf('{');
      const jsonEnd = aiResponse.lastIndexOf('}') + 1;
      const jsonString = aiResponse.slice(jsonStart, jsonEnd);

      parsed = JSON.parse(jsonString);

      if (!parsed.type) {
        console.warn('[extractFields] ❌ No "type" field in parsed JSON:', parsed);
        return { type: 'chat', parsed: {} };
      }

      // 🔄 Normalize type
      const normalizedType = {
        cancelReservation: 'reservation.cancel',
        reservationCancel: 'reservation.cancel',
        changeReservation: 'reservation.change',
        reservationChange: 'reservation.change',
        makeReservation: 'reservation.complete',
        reservationComplete: 'reservation.complete',
        checkAvailability: 'availability.check',
        availabilityCheck: 'availability.check'
      }[parsed.type] || parsed.type;

      parsed.type = normalizedType;

      // 🔍 Validate required fields for reservation.change
      if (parsed.type === 'reservation.change') {
        const { confirmationCode, newDate, newTimeSlot } = parsed;
        if (!confirmationCode || !newDate || !newTimeSlot) {
          console.warn('[extractFields] ❌ Missing fields for reservation.change:', {
            confirmationCode,
            newDate,
            newTimeSlot
          });
          return { type: 'chat', parsed: {} };
        }
      }

    } catch (e) {
      console.error('[extractFields] 💥 JSON parse error:', e);
      return { type: 'chat', parsed: {} };
    }

    const elapsed = Date.now() - start;
    console.log(`[extractFields] ✅ Success in ${elapsed}ms — Parsed JSON:`, parsed);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return {
      type: parsed.type,
      parsed
    };

  } catch (error) {
    console.error('[extractFields] ❌ Fatal failure:', error);
    return { type: 'chat', parsed: {} };
  }
};
