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

// Helper: Recalculate type based on fields
const recalculateType = (parsed) => {
  if (!parsed.intent) return parsed.type;

  if (parsed.intent === 'reservation') {
    const { name, partySize, contactInfo, date, timeSlot } = parsed;
    return [name, partySize, contactInfo, date, timeSlot].some((v) => !v)
      ? 'reservation.incomplete'
      : 'reservation.complete';
  }

  if (parsed.intent === 'changeReservation') {
    const { confirmationCode, newDate, newTimeSlot } = parsed;
    return [confirmationCode, newDate, newTimeSlot].some((v) => !v)
      ? 'reservation.change.incomplete'
      : 'reservation.change';
  }

  if (parsed.intent === 'cancelReservation') {
    const { confirmationCode } = parsed;
    return confirmationCode ? 'reservation.cancel' : 'reservation.incomplete';
  }

  if (parsed.intent === 'checkAvailability') {
    const { date, timeSlot } = parsed;
    return date && timeSlot ? 'availability.check' : 'availability.check.incomplete';
  }

  return parsed.type;
};

export const askVivRouter = async (req, res) => {
  const { restaurantId } = req.params;
  if (!restaurantId) {
    console.error('[askVivRouter] ❌ Missing restaurantId in req.params');
    return res.status(400).json({ error: 'Missing restaurantId in URL.' });
  }

  let parsed = {};
  let messages = [];

  // Extract messages from frontend
  if (Array.isArray(req.body.messages)) {
    messages = req.body.messages;
  } else if (req.body.userMessage) {
    messages = [
      {
        role: 'user',
        content:
          typeof req.body.userMessage === 'string'
            ? req.body.userMessage
            : req.body.userMessage.text
      }
    ];
  }

  // AI parsing
  if (messages.length > 0) {
    const aiParsed = await extractFields({ messages }, restaurantId);
    if (!aiParsed) {
      console.warn('[askVivRouter] ⚠️ extractFields returned null');
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

  // Recalculate type to enforce correct routing
  parsed.type = recalculateType(parsed);

  console.log('[askVivRouter] 📨 Parsed payload before routing:', JSON.stringify(parsed, null, 2));

  const newReq = {
    ...req,
    body: { ...parsed } // prevent mutating req.body directly
  };

  try {
    // Handle incomplete cases (ask for missing fields)
    if (parsed.type.endsWith('.incomplete')) {
      const { intent, restaurantId, openTime, closeTime, ...safeParsed } = parsed;
      const response = {
        type: parsed.type,
        parsed: renameKeysForViv(safeParsed),
        user: messages[messages.length - 1]?.content || ''
      };
      if (openTime) response.openTime = openTime;
      if (closeTime) response.closeTime = closeTime;

      console.log('[askVivRouter] Returning incomplete response with hours:', JSON.stringify(response, null, 2));
      return res.status(200).json(response);
    }

    // Route based on type
    let result;
    switch (parsed.type) {
      case 'chat':
        console.log('[askVivRouter] Handling chat');
        return res.status(200).json({
          type: 'chat',
          user: messages[messages.length - 1]?.content || '',
          passthrough: true
        });

      case 'reservation.complete':
        console.log('[askVivRouter] Routing to reservation');
        result = await reservation(newReq);
        break;

      case 'reservation.change':
        console.log('[askVivRouter] Routing to changeReservation');
        result = await changeReservation(newReq);
        break;

      case 'reservation.cancel':
        console.log('[askVivRouter] Routing to cancelReservation');
        result = await cancelReservation(newReq);
        break;

      case 'availability.check':
        console.log('[askVivRouter] Routing to checkAvailability');
        result = await checkAvailability(newReq);
        break;

      default:
        console.warn('[askVivRouter] ⚠️ Unrecognized type after recalculation:', parsed.type);
        return res.status(200).json({
          type: 'chat',
          response: 'Sorry, I didn’t understand that request.',
          error: false,
          user: messages[messages.length - 1]?.content || ''
        });
    }

    // Ensure open/close hours are preserved in the final response
    if (result?.body) {
      if (!result.body.openTime) {
        result.body.openTime = parsed.openTime || req.body.openTime || null;
      }
      if (!result.body.closeTime) {
        result.body.closeTime = parsed.closeTime || req.body.closeTime || null;
      }
    }

    console.log(`[askVivRouter] Final result for ${parsed.type}:`, JSON.stringify(result.body, null, 2));
    return res.status(result.status || 200).json(result.body);
  } catch (error) {
    console.error('[askVivRouter] ❌ Uncaught error:', error);
    return res.status(500).json({
      type: 'error',
      message: 'Uh oh! Something went wrong. Please try again in a moment.'
    });
  }
};
