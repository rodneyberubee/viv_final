import { reservation } from './reservation.js';
import { changeReservation } from './changeReservation.js';
import { cancelReservation } from './cancelReservation.js';
import { checkAvailability } from './checkAvailability.js';
import { extractFields } from '../utils/extractFields.js';

export const askVivRouter = async (req, res) => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[askVivRouter] 🧠 Triggered');
  console.log('[askVivRouter] 📩 Incoming body:', JSON.stringify(req.body, null, 2));
  console.log('[askVivRouter] 📍 Path Params:', req.params);

  const { restaurantId } = req.params;
  if (!restaurantId) {
    console.error('[askVivRouter] ❌ Missing restaurantId in req.params');
    return res.status(400).json({ error: 'Missing restaurantId in URL.' });
  }

  let parsed = {};

  if (Array.isArray(req.body.messages) && req.body.messages.length > 0) {
    console.log('[askVivRouter] 📥 Using messages[] input for GPT parsing');
    const aiParsed = await extractFields({ messages: req.body.messages }, restaurantId);
    console.log('[askVivRouter] 🔍 AI Parsed Response:', aiParsed);

    if (!aiParsed) {
      console.warn('[askVivRouter] ❌ AI failed to parse messages — returning fallback chat');
      return res.status(200).json({ type: 'chat', parsed: {}, raw: '', error: false });
    }

    parsed = {
      ...aiParsed.parsed,
      type: aiParsed.type,
      raw: aiParsed.raw
    };
  } else if (req.body.userMessage) {
    parsed = typeof req.body.userMessage === 'string'
      ? { text: req.body.userMessage }
      : req.body.userMessage;

    console.log('[askVivRouter] 📥 Parsed userMessage input:', parsed);

    if (parsed.text) {
      console.log('[askVivRouter] 🤖 Detected free-text. Parsing via extractFields...');
      const aiParsed = await extractFields({ text: parsed.text }, restaurantId);
      console.log('[askVivRouter] 🔍 AI Parsed Response:', aiParsed);

      if (!aiParsed) {
        return res.status(200).json({ type: 'chat', parsed: {}, raw: parsed.text, error: false });
      }

      parsed = {
        ...aiParsed.parsed,
        type: aiParsed.type,
        raw: aiParsed.raw
      };
    }
  } else if (req.body.type && req.body.parsed) {
    parsed = req.body.parsed;
    parsed.type = req.body.type;
    console.log('[askVivRouter] 🔁 Structured request received:', parsed);
  } else {
    console.warn('[askVivRouter] ⚠️ No usable input detected. Body:', req.body);
    return res.status(400).json({ error: 'Missing valid content in request body.' });
  }

  parsed.restaurantId = restaurantId;
  const newReq = {
    ...req,
    body: { ...parsed }
  };

  console.log('[askVivRouter] 🎯 Routing type:', parsed.type);
  console.log('[askVivRouter] 📦 Payload to next route:', parsed);

  try {
    switch (parsed.type) {
      case 'chat':
        console.log('[askVivRouter] 💬 Chat message — no backend logic triggered.');
        return res.status(200).json({
          type: 'chat',
          parsed,
          raw: parsed.raw || '',
          passthrough: true
        });

      case 'reservation.complete': {
        console.log('[askVivRouter] 📤 Routing to reservation.js');
        const result = await reservation(newReq, res, false);
        if (res.headersSent) return;
        return res.status(result.status || 200).json({
          type: parsed.type,
          parsed,
          confirmationCode: result.body?.confirmationCode || null
        });
      }

      case 'reservation.change': {
        console.log('[askVivRouter] 📤 Routing to changeReservation.js');
        const changeResult = await changeReservation(newReq, res, true);
        if (res.headersSent) return;
        return res.status(changeResult.status || 200).json({
          type: parsed.type,
          parsed,
          ...changeResult.body
        });
      }

      case 'reservation.cancel': {
        console.log('[askVivRouter] 📤 Routing to cancelReservation.js');
        const cancelResult = await cancelReservation(newReq, res, true);
        if (res.headersSent) return;
        return res.status(cancelResult.status || 200).json({
          type: parsed.type,
          parsed,
          ...cancelResult.body
        });
      }

      case 'availability.check': {
        console.log('[askVivRouter] 📤 Routing to checkAvailability.js');
        const availabilityResult = await checkAvailability(newReq, res, true);
        if (res.headersSent) return;
        return res.status(availabilityResult.status || 200).json({
          type: parsed.type,
          parsed,
          ...availabilityResult.body
        });
      }

      default:
        console.warn('[askVivRouter] ⚠️ Unrecognized type:', parsed.type);
        return res.status(200).json({
          type: 'chat',
          parsed,
          raw: parsed.raw || '',
          error: false
        });
    }
  } catch (error) {
    console.error('[askVivRouter] ❌ Uncaught error:', error);
    if (!res.headersSent) {
      return res.status(500).json({
        type: 'error',
        message: 'Uh oh! Something went wrong. Please try again in a moment.'
      });
    }
  }
};
