import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { parseFlexibleDate, parseFlexibleTime } from '../utils/dateHelpers.js';
dotenv.config();

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

      // Normalize + retain raw values (NO timezone applied here)
      if (parsed.parsed) {
        if (parsed.parsed.date) {
          parsed.parsed.rawDate = parsed.parsed.date;
          const parsedDate = parseFlexibleDate(parsed.parsed.date, 2025);
          parsed.parsed.date = parsedDate ? parsedDate.toFormat('yyyy-MM-dd') : parsed.parsed.date;
        }
        if (parsed.parsed.newDate) {
          parsed.parsed.rawNewDate = parsed.parsed.newDate;
          const parsedNewDate = parseFlexibleDate(parsed.parsed.newDate, 2025);
          parsed.parsed.newDate = parsedNewDate ? parsedNewDate.toFormat('yyyy-MM-dd') : parsed.parsed.newDate;
        }
        if (parsed.parsed.timeSlot) {
          parsed.parsed.rawTimeSlot = parsed.parsed.timeSlot;
          const parsedTime = parseFlexibleTime(parsed.parsed.timeSlot);
          parsed.parsed.timeSlot = parsedTime ? parsedTime.toFormat('HH:mm') : parsed.parsed.timeSlot;
        }
        if (parsed.parsed.newTimeSlot) {
          parsed.parsed.rawNewTimeSlot = parsed.parsed.newTimeSlot;
          const parsedNewTime = parseFlexibleTime(parsed.parsed.newTimeSlot);
          parsed.parsed.newTimeSlot = parsedNewTime ? parsedNewTime.toFormat('HH:mm') : parsed.parsed.newTimeSlot;
        }
      }

      // Adjust type based on completion
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
    } catch (e) {
      console.error('[extractFields] 💥 JSON parse error:', e);
      return { type: 'chat', parsed: {} };
    }

    return { type: parsed.type, intent: parsed.intent, parsed: parsed.parsed };
  } catch (error) {
    console.error('[extractFields] ❌ Fatal failure:', error);
    return { type: 'chat', parsed: {} };
  }
};
