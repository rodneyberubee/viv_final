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
  let messages = [];

  // Normalize input into messages[]
  if (Array.isArray(req.body.messages)) {
    messages = req.body.messages;
    console.log('[askVivRouter] 📥 Using messages[] input for GPT parsing');
  } else if (req.body.userMessage) {
    messages = [{ role: 'user', content: typeof req.body.userMessage === 'string' ? req.body.userMessage : req.body.userMessage.text }];
    console.log('[askVivRouter] 🧾 Converted userMessage to messages[]:', messages);
  }

  // If we now have messages, run GPT extraction
  if (messages.length > 0) {
    const aiParsed = await extractFields({ messages }, restaurantId);
    console.log('[askVivRouter] 🔍 AI Parsed Response:', aiParsed);

    if (!aiParsed) {
      return res.status(200).json({ type: 'chat', parsed: {}, raw: '', error: false });
    }

    parsed = {
      ...aiParsed.parsed,
      type: aiParsed.type,
      raw: aiParsed.raw
    };
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

      case 'reservation.complete':
        console.log('[askVivRouter] 📤 Routing to reservation.js');
        const result = await reservation(newReq, res, false);
        return res.status(result.status || 200).json({
          type: parsed.type,
          parsed,
          confirmationCode: result.body?.confirmationCode || null
        });

      case 'reservation.change':
        console.log('[askVivRouter] 📤 Routing to changeReservation.js');
        const changeResult = await changeReservation(newReq, res, true);
        return res.status(changeResult.status || 200).json({
          type: parsed.type,
          parsed,
          ...changeResult.body
        });

      case 'reservation.cancel':
        console.log('[askVivRouter] 📤 Routing to cancelReservation.js');
        const cancelResult = await cancelReservation(newReq, res, true);
        return res.status(cancelResult.status || 200).json({
          type: parsed.type,
          parsed,
          ...cancelResult.body
        });

      case 'availability.check':
        console.log('[askVivRouter] 📤 Routing to checkAvailability.js');
        const availabilityResult = await checkAvailability(newReq, res, true);
        return res.status(availabilityResult.status || 200).json({
          type: parsed.type,
          parsed,
          ...availabilityResult.body
        });

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
    return res.status(500).json({
      type: 'error',
      message: 'Uh oh! Something went wrong. Please try again in a moment.'
    });
  }
};
