import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { DateTime } from 'luxon';

dotenv.config();

const normalizeDate = (rawDate) => {
  if (!rawDate || typeof rawDate !== 'string') return rawDate;

  const formats = ['yyyy-MM-dd', 'd MMMM', 'MMMM d', 'd MMM', 'MMM d'];
  let parsed;

  // Try each format until one is valid
  for (const fmt of formats) {
    parsed = DateTime.fromFormat(rawDate, fmt, { zone: 'utc' });
    if (parsed.isValid) break;
  }

  return parsed && parsed.isValid
    ? parsed.set({ year: 2025 }).toFormat('yyyy-MM-dd')
    : rawDate;
};

const normalizeTimeSlot = (rawTime) => {
  if (!rawTime || typeof rawTime !== 'string') return rawTime;

  const cleaned = rawTime.trim().toUpperCase().replace(/\./g, '').replace(/\s+/g, '');
  const withSpace = cleaned.replace(/(AM|PM)/, ' $1');

  const timeFormats = ['h:mm a', 'h a', 'H:mm', 'H', 'HH:mm'];
  let parsed;

  for (const fmt of timeFormats) {
    parsed = DateTime.fromFormat(withSpace, fmt, { zone: 'utc' });
    if (parsed.isValid) break;
  }

  return parsed && parsed.isValid
    ? parsed.toFormat('HH:mm')
    : rawTime;
};

export const extractFields = async (vivInput, restaurantId) => {
  const start = Date.now();

  const systemPrompt = [
    'You are VivB, a structured parser for a restaurant AI assistant.',
    '',
    'Your job is to:',
    '- Determine user intent: "reservation", "changeReservation", "cancelReservation", or "checkAvailability"',
    '- Output valid JSON starting on the first line like:',
    '{ "intent": "reservation", "type": "reservation.incomplete", "parsed": { "name": null, "partySize": null, "contactInfo": null, "date": null, "timeSlot": null } }',
    '{ "intent": "changeReservation", "type": "changeReservation.incomplete", "parsed": { "confirmationCode": null, "newDate": null, "newTimeSlot": null } }',
    '{ "intent": "cancelReservation", "type": "cancelReservation.incomplete", "parsed": { "confirmationCode": null } }',
    '{ "intent": "checkAvailability", "type": "checkAvailability.incomplete", "parsed": { "date": null, "timeSlot": null } }',
    '',
    'Rules:',
    '- Always return "intent", "type", and "parsed"',
    '- If any required fields are missing, set them to null',
    '- For incomplete data, use types like "reservation.incomplete", "reservation.change.incomplete"',
    '- Never speak before or after the JSON block.',
    '',
    'Confirmation Code Rules:',
    '- confirmationCode is a short string used to identify an existing reservation.',
    '- Typical format: lowercase letters and/or numbers (e.g., "abc123", "5e4wotk2r", "38f02zn")',
    '- confirmationCodes are 6–10 characters and are never a time like "6:30 PM".',
    '- Users might say: "My code is abc123", "Cancel reservation 9x7vwp", "Change 5e4wotk2r to 7 PM".',
    '- Always extract this value into the "confirmationCode" field when user intent is cancelReservation or changeReservation.',
    '- Never confuse confirmationCode with timeSlot or name.'
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

    const json = await openaiRes.json();

    if (json.error) {
      console.error('[extractFields] ❌ OpenAI API returned error:', json.error);
      return { type: 'chat', parsed: {} };
    }

    const aiResponse = json.choices?.[0]?.message?.content?.trim() ?? '';

    let parsed;
    try {
      const jsonStart = aiResponse.indexOf('{');
      const jsonEnd = aiResponse.lastIndexOf('}') + 1;
      const jsonString = aiResponse.slice(jsonStart, jsonEnd);

      parsed = JSON.parse(jsonString);

      if (!parsed.intent) {
        const lastMsg = vivInput.messages?.slice(-1)[0]?.content?.toLowerCase() || '';
        const chatTriggers = ['what', 'see', 'debug', 'why', 'status', 'viv', 'explain', 'help'];
        if (chatTriggers.some(trigger => lastMsg.includes(trigger))) {
          return { type: 'chat', parsed: {} };
        }

        return { type: 'chat', parsed: {} };
      }

      let normalizedType = parsed.type;

      if (parsed.parsed) {
        if (parsed.parsed.date) {
          parsed.parsed.date = normalizeDate(parsed.parsed.date);
        }
        if (parsed.parsed.newDate) {
          parsed.parsed.newDate = normalizeDate(parsed.parsed.newDate);
        }
        if (parsed.parsed.timeSlot) {
          const original = parsed.parsed.timeSlot;
          parsed.parsed.timeSlot = normalizeTimeSlot(original);
        }
        if (parsed.parsed.newTimeSlot) {
          const original = parsed.parsed.newTimeSlot;
          parsed.parsed.newTimeSlot = normalizeTimeSlot(original);
        }
      }

      if (parsed.intent === 'reservation') {
        const { name, partySize, contactInfo, date, timeSlot } = parsed.parsed || {};
        const incomplete = [name, partySize, contactInfo, date, timeSlot].some(v => !v);
        normalizedType = incomplete ? 'reservation.incomplete' : 'reservation.complete';
      }

      if (parsed.intent === 'changeReservation') {
        const { confirmationCode, newDate, newTimeSlot } = parsed.parsed || {};
        const incomplete = [confirmationCode, newDate, newTimeSlot].some(v => !v);
        normalizedType = incomplete ? 'reservation.change.incomplete' : 'reservation.change';
      }

      if (parsed.intent === 'cancelReservation') {
        normalizedType = 'reservation.cancel';
      }

      if (parsed.intent === 'checkAvailability') {
        normalizedType = 'availability.check';
      }

      parsed.type = normalizedType;

      const cc = parsed.parsed?.confirmationCode;
      if (cc && cc.includes(':')) {
        // Do nothing (debug removed)
      }

    } catch (e) {
      console.error('[extractFields] 💥 JSON parse error:', e);
      return { type: 'chat', parsed: {} };
    }

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
