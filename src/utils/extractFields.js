import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { parseFlexibleDate, parseFlexibleTime } from '../utils/dateHelpers.js';
dotenv.config();

export const extractFields = async (vivInput, restaurantId) => {
  const start = Date.now();

  console.log('[DEBUG][extractFields] Incoming vivInput:', JSON.stringify(vivInput, null, 2));
  console.log('[DEBUG][extractFields] For restaurantId:', restaurantId);

  const systemPrompt = [
    'You are VivB, a structured parser for a restaurant AI assistant.',
    'IMPORTANT: Always respond ONLY with a single valid JSON object. Do NOT include explanations, confirmations, or extra text.',
    '',
    'Date & Time Formatting Rules:',
    '- Dates MUST be in ISO format: yyyy-MM-dd (e.g., 2025-08-02).',
    '- Times MUST be in 24-hour format: HH:mm (e.g., 21:30).',
    '',
    'Classification Rule:',
    '- Set `type` to `reservation.complete` if ALL required fields are present.',
    '- Set `type` to `reservation.incomplete` if ANY required field is missing.',
    '- Do the same for other intents (e.g., `reservation.change` vs `reservation.change.incomplete`).',
    '',
    'Intent & Schema Rules:',
    '- If the user provides a confirmation code and requests a new date or time, intent is "changeReservation".',
    '- If the user provides a confirmation code and requests cancellation, intent is "cancelReservation".',
    '- If the user asks about availability without booking, intent is "checkAvailability".',
    '- Otherwise, default to "reservation".',
    '',
    'Field Schemas by Intent:',
    '- For reservation: { "intent": "reservation", "type": "reservation.incomplete|reservation.complete", "parsed": { "name": null, "partySize": null, "contactInfo": null, "date": null, "timeSlot": null } }',
    '- For changeReservation: { "intent": "changeReservation", "type": "reservation.change|reservation.change.incomplete", "parsed": { "confirmationCode": null, "newDate": null, "newTimeSlot": null } }',
    '- For cancelReservation: { "intent": "cancelReservation", "type": "reservation.cancel", "parsed": { "confirmationCode": null } }',
    '- For checkAvailability: { "intent": "checkAvailability", "type": "availability.check", "parsed": { "date": null, "timeSlot": null } }',
    '',
    'Rules:',
    '- Absolutely no extra text before or after the JSON.',
    '- Always return "intent", "type", and "parsed".',
    '- If any field is unknown, set it to null.',
  ].join('\n');

  const messages = Array.isArray(vivInput.messages)
    ? [{ role: 'system', content: systemPrompt }, ...vivInput.messages]
    : [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: vivInput.text || '' }
      ];

  const safeFormat = (val, fmt, fieldName) => {
    try {
      if (val && typeof val === 'object' && typeof val.toFormat === 'function') {
        const formatted = val.toFormat(fmt);
        console.log(`[DEBUG][extractFields] Successfully formatted ${fieldName}:`, formatted);
        return formatted;
      }
      return val || null;
    } catch (err) {
      console.error(`[DEBUG][extractFields] Failed to format ${fieldName}:`, err, 'Raw value:', val);
      return val || null;
    }
  };

  const isLikelyConfirmationCode = (val) => {
    return typeof val === 'string' && /^[a-zA-Z0-9]{6,12}$/.test(val) && !val.includes('@');
  };

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
        temperature: 0,
        messages
      }),
    });

    const json = await openaiRes.json();
    console.log('[DEBUG][extractFields] Raw OpenAI response:', JSON.stringify(json, null, 2));

    if (json.error) {
      console.error('[extractFields] ❌ OpenAI API returned error:', json.error);
      return { type: 'chat', parsed: {} };
    }

    let aiResponse = json.choices?.[0]?.message?.content?.trim() ?? '';
    const jsonStart = aiResponse.indexOf('{');
    const jsonEnd = aiResponse.lastIndexOf('}') + 1;
    if (jsonStart !== -1 && jsonEnd > jsonStart) aiResponse = aiResponse.slice(jsonStart, jsonEnd);

    let parsed;
    try {
      parsed = JSON.parse(aiResponse);
      if (!parsed.parsed) parsed.parsed = {};

      // Normalize date/time fields safely
      const normalizeField = (field, fmt, parser, rawKey) => {
        if (parsed.parsed[field]) {
          parsed.parsed[rawKey] = parsed.parsed[field];
          const parsedVal = parser(parsed.parsed[field], 2025);
          parsed.parsed[field] = safeFormat(parsedVal, fmt, field);
        }
      };
      normalizeField('date', 'yyyy-MM-dd', parseFlexibleDate, 'rawDate');
      normalizeField('newDate', 'yyyy-MM-dd', parseFlexibleDate, 'rawNewDate');
      normalizeField('timeSlot', 'HH:mm', parseFlexibleTime, 'rawTimeSlot');
      normalizeField('newTimeSlot', 'HH:mm', parseFlexibleTime, 'rawNewTimeSlot');

      // Move name → confirmationCode if applicable
      if (parsed.intent === 'changeReservation' && !parsed.parsed.confirmationCode && isLikelyConfirmationCode(parsed.parsed.name)) {
        parsed.parsed.confirmationCode = parsed.parsed.name;
        parsed.parsed.name = null;
      }

      // Heuristic override: recheck based on userText
      const userText = (vivInput.messages?.map(m => m.content).join(' ') || '').toLowerCase();
      const hasCode = isLikelyConfirmationCode(parsed.parsed?.confirmationCode || parsed.parsed?.name);
      const hasDateOrTime = parsed.parsed?.date || parsed.parsed?.timeSlot || parsed.parsed?.newDate || parsed.parsed?.newTimeSlot;

      if (hasCode) {
        if (/\bcancel\b/i.test(userText.split(/[.?!]/)[0])) parsed.intent = 'cancelReservation';
        else if (hasDateOrTime) parsed.intent = 'changeReservation';
      }

      // Guardrails: don’t allow change/cancel without code
      if ((parsed.intent === 'changeReservation' || parsed.intent === 'cancelReservation') && !parsed.parsed.confirmationCode) {
        parsed.intent = 'reservation';
      }

      // Always recompute type
      if (parsed.intent === 'reservation') {
        const { name, partySize, contactInfo, date, timeSlot } = parsed.parsed;
        parsed.type = [name, partySize, contactInfo, date, timeSlot].some(v => !v)
          ? 'reservation.incomplete'
          : 'reservation.complete';
      } else if (parsed.intent === 'changeReservation') {
        const { confirmationCode, newDate, newTimeSlot } = parsed.parsed;
        parsed.type = [confirmationCode, newDate, newTimeSlot].some(v => !v)
          ? 'reservation.change.incomplete'
          : 'reservation.change';
      } else if (parsed.intent === 'cancelReservation') {
        parsed.type = 'reservation.cancel';
      } else if (parsed.intent === 'checkAvailability') {
        parsed.type = 'availability.check';
      }

    } catch (e) {
      console.error('[extractFields] 💥 JSON parse error:', e, 'AI response:', aiResponse);
      return { type: 'chat', parsed: {} };
    }

    console.log('[DEBUG][extractFields] Final output to router:', parsed);
    console.log(`[DEBUG][extractFields] Processing time: ${Date.now() - start}ms`);

    return { type: parsed.type, intent: parsed.intent, parsed: parsed.parsed };
  } catch (error) {
    console.error('[extractFields] ❌ Fatal failure:', error);
    return { type: 'chat', parsed: {} };
  }
};
