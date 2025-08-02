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
    // ... (rest of prompt unchanged)
  ].join('\n');

  const messages = Array.isArray(vivInput.messages)
    ? [{ role: 'system', content: systemPrompt }, ...vivInput.messages]
    : [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: vivInput.text || '' }
      ];

  const safeFormat = (val, fmt) => {
    try {
      return val && typeof val === 'object' && typeof val.toFormat === 'function'
        ? val.toFormat(fmt)
        : (val || null);
    } catch {
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
        temperature: 0.8,
        messages
      }),
    });

    const json = await openaiRes.json();
    console.log('[DEBUG][extractFields] Raw OpenAI response:', JSON.stringify(json, null, 2));

    if (json.error) {
      console.error('[extractFields] ❌ OpenAI API returned error:', json.error);
      return { type: 'chat', parsed: {} };
    }

    const aiResponse = json.choices?.[0]?.message?.content?.trim() ?? '';
    console.log('[DEBUG][extractFields] AI Raw content:', aiResponse);

    let parsed;
    try {
      const jsonStart = aiResponse.indexOf('{');
      const jsonEnd = aiResponse.lastIndexOf('}') + 1;
      const jsonString = aiResponse.slice(jsonStart, jsonEnd);
      parsed = JSON.parse(jsonString);

      console.log('[DEBUG][extractFields] Parsed JSON before normalization:', parsed);

      let normalizedType = parsed.type;

      if (parsed.parsed) {
        if (parsed.parsed.date) {
          parsed.parsed.rawDate = parsed.parsed.date;
          parsed.parsed.date = safeFormat(parseFlexibleDate(parsed.parsed.date, 2025), 'yyyy-MM-dd');
        }
        if (parsed.parsed.newDate) {
          parsed.parsed.rawNewDate = parsed.parsed.newDate;
          parsed.parsed.newDate = safeFormat(parseFlexibleDate(parsed.parsed.newDate, 2025), 'yyyy-MM-dd');
        }
        if (parsed.parsed.timeSlot) {
          parsed.parsed.rawTimeSlot = parsed.parsed.timeSlot;
          parsed.parsed.timeSlot = safeFormat(parseFlexibleTime(parsed.parsed.timeSlot), 'HH:mm');
        }
        if (parsed.parsed.newTimeSlot) {
          parsed.parsed.rawNewTimeSlot = parsed.parsed.newTimeSlot;
          parsed.parsed.newTimeSlot = safeFormat(parseFlexibleTime(parsed.parsed.newTimeSlot), 'HH:mm');
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
      if (parsed.intent === 'cancelReservation') normalizedType = 'reservation.cancel';
      if (parsed.intent === 'checkAvailability') normalizedType = 'availability.check';

      parsed.type = normalizedType;

      console.log('[DEBUG][extractFields] Parsed JSON after normalization:', parsed);

    } catch (e) {
      console.error('[extractFields] 💥 JSON parse error:', e);
      return { type: 'chat', parsed: {} };
    }

    console.log('[DEBUG][extractFields] Final output:', parsed);
    console.log(`[DEBUG][extractFields] Processing time: ${Date.now() - start}ms`);

    return { type: parsed.type, intent: parsed.intent, parsed: parsed.parsed };
  } catch (error) {
    console.error('[extractFields] ❌ Fatal failure:', error);
    return { type: 'chat', parsed: {} };
  }
};
