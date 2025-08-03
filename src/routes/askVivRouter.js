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

  // Extract messages from frontend
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
  console.log('[askVivRouter] 📨 Parsed payload before routing:', JSON.stringify(parsed, null, 2));

  const newReq = {
    ...req,
    body: { ...parsed }
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

      // Preserve business hours if available
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
        console.warn('[askVivRouter] ⚠️ Unrecognized type:', parsed.type);
        return res.status(200).json({
          type: 'chat',
          response: 'Sorry, I didn’t understand that request.',
          error: false,
          user: messages[messages.length - 1]?.content || ''
        });
    }

    // Ensure open/close hours are preserved in the final response
    if (result?.body) {
      if (!result.body.openTime && parsed.openTime) {
        console.warn('[askVivRouter] Adding missing openTime from parsed');
        result.body.openTime = parsed.openTime;
      }
      if (!result.body.closeTime && parsed.closeTime) {
        console.warn('[askVivRouter] Adding missing closeTime from parsed');
        result.body.closeTime = parsed.closeTime;
      }
      if (!result.body.openTime || !result.body.closeTime) {
        console.warn('[askVivRouter] ⚠️ Hours still missing in final response:', {
          openTime: result.body.openTime,
          closeTime: result.body.closeTime
        });
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
