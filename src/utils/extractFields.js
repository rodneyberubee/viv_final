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
    'Your job is to:',
    '- Determine user intent: "reservation", "changeReservation", "cancelReservation", or "checkAvailability"',
    '- Output valid JSON starting on the first line like:',
    '{ "intent": "reservation", "type": "reservation.incomplete", "parsed": { "name": null, "partySize": null, "contactInfo": null, "date": null, "timeSlot": null } }',
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
      console.warn(`[DEBUG][extractFields] Value for ${fieldName} not a Luxon object, keeping raw:`, val);
      return val || null;
    } catch (err) {
      console.error(`[DEBUG][extractFields] Failed to format ${fieldName}:`, err, 'Raw value:', val);
      return val || null;
    }
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
    console.log('[DEBUG][extractFields] AI Raw content:', aiResponse);

    // Extract only the JSON portion if extra text appears
    const jsonStart = aiResponse.indexOf('{');
    const jsonEnd = aiResponse.lastIndexOf('}') + 1;
    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      aiResponse = aiResponse.slice(jsonStart, jsonEnd);
      console.log('[DEBUG][extractFields] Trimmed AI content to JSON block:', aiResponse);
    } else {
      console.warn('[DEBUG][extractFields] Could not find proper JSON boundaries. Raw response used.');
    }

    let parsed;
    try {
      parsed = JSON.parse(aiResponse);
      console.log('[DEBUG][extractFields] Parsed JSON before normalization:', parsed);

      let normalizedType = parsed.type;

      // Normalize and preserve raw values for fallback
      if (parsed.parsed) {
        if (parsed.parsed.date) {
          parsed.parsed.rawDate = parsed.parsed.date;
          const parsedDate = parseFlexibleDate(parsed.parsed.date, 2025);
          parsed.parsed.date = safeFormat(parsedDate, 'yyyy-MM-dd', 'date');
        }
        if (parsed.parsed.newDate) {
          parsed.parsed.rawNewDate = parsed.parsed.newDate;
          const parsedNewDate = parseFlexibleDate(parsed.parsed.newDate, 2025);
          parsed.parsed.newDate = safeFormat(parsedNewDate, 'yyyy-MM-dd', 'newDate');
        }
        if (parsed.parsed.timeSlot) {
          parsed.parsed.rawTimeSlot = parsed.parsed.timeSlot;
          const parsedTime = parseFlexibleTime(parsed.parsed.timeSlot);
          parsed.parsed.timeSlot = safeFormat(parsedTime, 'HH:mm', 'timeSlot');
        }
        if (parsed.parsed.newTimeSlot) {
          parsed.parsed.rawNewTimeSlot = parsed.parsed.newTimeSlot;
          const parsedNewTime = parseFlexibleTime(parsed.parsed.newTimeSlot);
          parsed.parsed.newTimeSlot = safeFormat(parsedNewTime, 'HH:mm', 'newTimeSlot');
        }
      } else {
        console.warn('[DEBUG][extractFields] Missing parsed object in AI response');
      }

      // Recompute type based on completeness
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
      if (parsed.intent === 'cancelReservation') normalizedType = 'reservation.cancel';
      if (parsed.intent === 'checkAvailability') normalizedType = 'availability.check';

      parsed.type = normalizedType;

      console.log('[DEBUG][extractFields] Parsed JSON after normalization:', parsed);

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
