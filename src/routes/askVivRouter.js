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
  const { restaurantId } = req.params;
  if (!restaurantId) {
    console.error('[askVivRouter] ❌ Missing restaurantId in req.params');
    return res.status(400).json({ error: 'Missing restaurantId in URL.' });
  }

  let parsed = {};
  let messages = [];

  if (Array.isArray(req.body.messages)) {
    messages = req.body.messages;
  } else if (req.body.userMessage) {
    messages = [{
      role: 'user',
      content: typeof req.body.userMessage === 'string'
        ? req.body.userMessage
        : req.body.userMessage.text
    }];
  }

  if (messages.length > 0) {
    const aiParsed = await extractFields({ messages }, restaurantId);

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
  } else {
    console.warn('[askVivRouter] ⚠️ No usable input detected. Body:', req.body);
    return res.status(400).json({ error: 'Missing valid content in request body.' });
  }

  parsed.restaurantId = restaurantId;
  const newReq = {
    ...req,
    body: { ...parsed }
  };

  try {
    if (parsed.type.endsWith('.incomplete')) {
      const { intent, restaurantId, openTime, closeTime, ...safeParsed } = parsed;

      const response = {
        type: parsed.type,
        parsed: renameKeysForViv(safeParsed),
        user: messages[messages.length - 1]?.content || ''
      };

      // Include open/close times if available
      if (openTime) response.openTime = openTime;
      if (closeTime) response.closeTime = closeTime;

      console.log('[askVivRouter] Returning incomplete response with hours:', response);
      return res.status(200).json(response);
    }

    switch (parsed.type) {
      case 'chat':
        return res.status(200).json({
          type: 'chat',
          user: messages[messages.length - 1]?.content || '',
          passthrough: true
        });

      case 'reservation.complete':
        const result = await reservation(newReq);
        return res.status(result.status || 200).json(result.body);

      case 'reservation.change':
        const changeResult = await changeReservation(newReq);
        return res.status(changeResult.status || 200).json(changeResult.body);

      case 'reservation.cancel':
        const cancelResult = await cancelReservation(newReq);
        return res.status(cancelResult.status || 200).json(cancelResult.body);

      case 'availability.check':
        const availabilityResult = await checkAvailability(newReq);
        return res.status(availabilityResult.status || 200).json(availabilityResult.body);

      default:
        console.warn('[askVivRouter] ⚠️ Unrecognized type:', parsed.type);
        return res.status(200).json({
          type: 'chat',
          response: 'Sorry, I didn’t understand that request.',
          error: false,
          user: messages[messages.length - 1]?.content || ''
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
