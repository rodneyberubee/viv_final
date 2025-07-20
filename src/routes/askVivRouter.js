import { reservation } from './reservation.js';
import { changeReservation } from './changeReservation.js';
import { cancelReservation } from './cancelReservation.js';
import { checkAvailability } from './checkAvailability.js';
import { extractFields } from '../utils/extractFields.js';

const renameKeysForViv = (parsed) => {
  const keyMap = {
    confirmationCode: 'confirmation code',
    contactInfo: 'email',
    partySize: 'party size',
    timeSlot: 'time',
    newDate: 'new date',
    newTimeSlot: 'new time'
  };
  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [keyMap[key] || key, value])
  );
};

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
      return res.status(200).json({ type: 'chat', parsed: {}, error: false });
    }

    parsed = {
      ...aiParsed.parsed,
      type: aiParsed.type,
      intent: aiParsed.intent || null
    };
  } else if (req.body.type && req.body.parsed) {
    parsed = req.body.parsed;
    parsed.type = req.body.type;
    parsed.intent = req.body.intent || null;
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
    // Handle incomplete types — send back to VivA for clarification
    if (parsed.type.endsWith('.incomplete')) {
      console.log('[askVivRouter] ⏳ Incomplete input — returning to VivA for clarification.');
      return res.status(200).json({
        type: parsed.type,
        intent: parsed.intent,
        parsed: renameKeysForViv(parsed)
      });
    }

    switch (parsed.type) {
      case 'chat':
        console.log('[askVivRouter] 💬 Chat message — no backend logic triggered.');
        return res.status(200).json({
          type: 'chat',
          user: messages[messages.length - 1]?.content || '',
          passthrough: true
        });

      case 'reservation.complete':
        console.log('[askVivRouter] 📤 Routing to reservation.js');
        const result = await reservation(newReq);
        return res.status(result.status || 200).json(result.body);

      case 'reservation.change':
        console.log('[askVivRouter] 📤 Routing to changeReservation.js');
        const changeResult = await changeReservation(newReq);
        return res.status(changeResult.status || 200).json(changeResult.body);

      case 'reservation.cancel':
        console.log('[askVivRouter] 📤 Routing to cancelReservation.js');
        const cancelResult = await cancelReservation(newReq);
        return res.status(cancelResult.status || 200).json(cancelResult.body);

      case 'availability.check':
        console.log('[askVivRouter] 📤 Routing to checkAvailability.js');
        const availabilityResult = await checkAvailability(newReq);
        return res.status(availabilityResult.status || 200).json(availabilityResult.body);

      default:
        console.warn('[askVivRouter] ⚠️ Unrecognized type:', parsed.type);
        return res.status(200).json({
          type: 'chat',
          response: 'Sorry, I didn’t understand that request.',
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
