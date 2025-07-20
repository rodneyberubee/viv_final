import fetch from 'node-fetch';
import dotenv from 'dotenv';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
dayjs.extend(customParseFormat);

dotenv.config();

const normalizeDate = (rawDate) => {
  if (!rawDate || typeof rawDate !== 'string') return rawDate;
  const formats = ['YYYY-MM-DD', 'D MMMM', 'MMMM D', 'D MMM', 'MMM D'];
  const parsed = dayjs(rawDate, formats, true);
  return parsed.isValid() ? parsed.year(2025).format('YYYY-MM-DD') : rawDate;
};

const normalizetime = (rawTime) => {
  if (!rawTime || typeof rawTime !== 'string') return rawTime;

  const cleaned = rawTime.trim().toUpperCase().replace(/\./g, '').replace(/\s+/g, '');
  const withSpace = cleaned.replace(/(AM|PM)/, ' $1');

  const parsed = dayjs(withSpace, ['h:mm A', 'h A', 'H:mm', 'H', 'HH:mm'], true);
  if (!parsed.isValid()) {
    console.warn('[normalizetime] ⚠️ Could not parse:', rawTime);
    return rawTime;
  }

  return parsed.format('HH:mm');
};

export const extractFields = async (vivInput, restaurantId) => {
  const start = Date.now();
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[extractFields] 🚀 Triggered');
  console.log('[extractFields] 📬 Input message:', vivInput);
  console.log('[extractFields] 📌 restaurantId:', restaurantId);

  const systemPrompt = [
    'You are VivB, a structured parser for a restaurant AI assistant.',
    '',
    'Your job is to:',
    '- Determine user intent: "reservation", "changeReservation", "cancelReservation", or "checkAvailability"',
    '- Output valid JSON starting on the first line like:',
    '{ "intent": "reservation", "type": "reservation.incomplete", "parsed": { "name": null, "party size": null, "email": null, "date": null, "time": null } }',
    '{ "intent": "changeReservation", "type": "changeReservation.incomplete", "parsed": { "confirmation code": null, "newDate": null, "newtime": null } }',
    '{ "intent": "cancelReservation", "type": "cancelReservation.incomplete", "parsed": { "confirmation code": null } }',
    '{ "intent": "checkAvailability", "type": "checkAvailability.incomplete", "parsed": { "date": null, "time": null } }',
    '',
    'Rules:',
    '- Always return "intent", "type", and "parsed"',
    '- If any required fields are missing, set them to null',
    '- For incomplete data, use types like "reservation.incomplete", "reservation.change.incomplete"',
    '- Never speak before or after the JSON block.',
    '',
    'Confirmation Code Rules:',
    '- confirmation code is a short string used to identify an existing reservation.',
    '- Typical format: lowercase letters and/or numbers (e.g., "abc123", "5e4wotk2r", "38f02zn")',
    '- confirmation codes are 6–10 characters and are never a time like "6:30 PM".',
    '- Users might say: "My code is abc123", "Cancel reservation 9x7vwp", "Change 5e4wotk2r to 7 PM".',
    '- Always extract this value into the "confirmation code" field when user intent is cancelReservation or changeReservation.',
    '- Never confuse confirmation code with time or name.'
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

      if (!parsed.intent) {
        console.warn('[extractFields] ❌ No "intent" field in parsed JSON:', parsed);
        return { type: 'chat', parsed: {} };
      }

      // 🔄 Normalize fields
      let normalizedType = parsed.type;

      if (parsed.parsed) {
        if (parsed.parsed.date) {
          parsed.parsed.date = normalizeDate(parsed.parsed.date);
        }
        if (parsed.parsed.newDate) {
          parsed.parsed.newDate = normalizeDate(parsed.parsed.newDate);
        }
        if (parsed.parsed.time) {
          const original = parsed.parsed.time;
          parsed.parsed.time = normalizetime(original);
          console.log('[normalizetime] 🕓 Normalized time:', original, '→', parsed.parsed.time);
        }
        if (parsed.parsed.newtime) {
          const original = parsed.parsed.newtime;
          parsed.parsed.newtime = normalizetime(original);
          console.log('[normalizetime] 🕓 Normalized newtime:', original, '→', parsed.parsed.newtime);
        }
      }

      // 🧠 Final intent/type handling
      if (parsed.intent === 'reservation') {
        const { name, party size, email, date, time } = parsed.parsed || {};
        const incomplete = [name, party size, email, date, time].some(v => !v);
        normalizedType = incomplete ? 'reservation.incomplete' : 'reservation.complete';
      }

      if (parsed.intent === 'changeReservation') {
        const { confirmation code, newDate, newtime } = parsed.parsed || {};
        const incomplete = [confirmation code, newDate, newtime].some(v => !v);
        normalizedType = incomplete ? 'reservation.change.incomplete' : 'reservation.change';
      }

      if (parsed.intent === 'cancelReservation') {
        normalizedType = 'reservation.cancel';
      }

      if (parsed.intent === 'checkAvailability') {
        normalizedType = 'availability.check';
      }

      parsed.type = normalizedType;

      // 🛡️ Confirmation code safety check
      const cc = parsed.parsed?.confirmation code;
      if (cc && cc.includes(':')) {
        console.warn('[extractFields] ⚠️ Suspected time misparsed as confirmation code:', cc);
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
      intent: parsed.intent,
      parsed: parsed.parsed
    };

  } catch (error) {
    console.error('[extractFields] ❌ Fatal failure:', error);
    return { type: 'chat', parsed: {} };
  }
};
