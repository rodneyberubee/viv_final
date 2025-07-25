import Airtable from 'airtable';
import { parseDateTime, getCurrentDateTime, isPast } from '../utils/dateHelpers.js'; // ✅ Added isPast
import { loadRestaurantConfig } from '../utils/loadConfig.js';
import { sendConfirmationEmail } from '../utils/sendConfirmationEmail.js'; // ✨ added

const airtableClient = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY });

export const createReservation = async (parsed, config) => {
  const { name, partySize, contactInfo, date, timeSlot } = parsed;
  const { baseId, tableName } = config;

  const base = airtableClient.base(baseId);
  const confirmationCode = Math.random().toString(36).substr(2, 9);

  const fields = {
    name,
    partySize,
    contactInfo,
    date,
    timeSlot,
    rawConfirmationCode: confirmationCode,
    status: 'confirmed'
  };

  await base(tableName).create([{ fields }]);
  return { confirmationCode };
};

export const reservation = async (req) => {
  const { restaurantId } = req.params;

  let parsed = req.body;

  if (typeof parsed.userMessage === 'string') {
    try {
      const fallback = JSON.parse(parsed.userMessage);
      parsed = { ...fallback, restaurantId: parsed.restaurantId, route: parsed.route };
    } catch (e) {
      const error = {
        type: 'reservation.error',
        error: 'invalid_json_in_userMessage'
      };
      return { status: 400, body: error };
    }
  }

  const { name, partySize, contactInfo, date, timeSlot } = parsed;

  const missing = [];
  if (!name) missing.push('name');
  if (!partySize) missing.push('partySize');
  if (!contactInfo) missing.push('contactInfo');
  if (!date) missing.push('date');
  if (!timeSlot) missing.push('timeSlot');

  if (missing.length > 0) {
    const error = {
      type: 'reservation.error',
      error: 'missing_required_fields',
      missing
    };
    return { status: 400, body: error };
  }

  try {
    const config = await loadRestaurantConfig(restaurantId);
    if (!config) {
      const error = {
        type: 'reservation.error',
        error: 'config_not_found'
      };
      return { status: 404, body: error };
    }

    const { baseId, tableName, maxReservations, futureCutoff, timeZone } = config;
    const base = airtableClient.base(baseId);

    // ✅ Use dateHelpers for consistent parsing and zone awareness
    const now = getCurrentDateTime(timeZone);
    const reservationTime = parseDateTime(date, timeSlot, timeZone);

    // Debugging: log parsed values
    console.log('[DEBUG][reservation] Incoming date/time:', { date, timeSlot });
    console.log('[DEBUG][reservation] Parsed reservationTime:', reservationTime?.toISO() || 'Invalid');
    console.log('[DEBUG][reservation] Current time:', now.toISO());

    if (!reservationTime) {
      return { status: 400, body: { type: 'reservation.error', error: 'invalid_date_or_time' } };
    }

    // ✅ Guardrail: Block past-time reservations
    if (isPast(date, timeSlot, timeZone)) {
      console.warn('[WARN][reservation] Attempted to book past time');
      return { status: 400, body: { type: 'reservation.error', error: 'cannot_book_in_past' } };
    }

    if (reservationTime > now.plus({ days: futureCutoff })) {
      const error = {
        type: 'reservation.error',
        error: 'outside_reservation_window'
      };
      return { status: 400, body: error };
    }

    const normalizedDate = date.trim();
    const normalizedTime = timeSlot.toString().trim();

    const reservations = await base(tableName)
      .select({
        filterByFormula: `{dateFormatted} = '${normalizedDate}'`,
        fields: ['status', 'timeSlot']
      })
      .all();

    const sameSlot = reservations.filter(r => r.fields.timeSlot?.trim() === normalizedTime);
    const blocked = sameSlot.filter(r => r.fields.status?.trim().toLowerCase() === 'blocked');
    const confirmedCount = sameSlot.filter(r => r.fields.status?.trim().toLowerCase() === 'confirmed');

    const isSlotAvailable = (time) => {
      const matching = reservations.filter(r => r.fields.timeSlot?.trim() === time);
      const isBlocked = matching.some(r => r.fields.status?.trim().toLowerCase() === 'blocked');
      const confirmed = matching.filter(r => r.fields.status?.trim().toLowerCase() === 'confirmed');
      return !isBlocked && confirmed.length < maxReservations;
    };

    const findNextAvailableSlots = (centerTime, maxSteps = 96) => {
      let before = null;
      let after = null;

      let forward = centerTime;
      let backward = centerTime;

      for (let i = 1; i <= maxSteps; i++) {
        forward = forward.plus({ minutes: 15 });
        if (isSlotAvailable(forward.toFormat('HH:mm'))) {
          after = forward.toFormat('HH:mm');
          break;
        }
      }

      for (let i = 1; i <= maxSteps; i++) {
        backward = backward.minus({ minutes: 15 });
        if (isSlotAvailable(backward.toFormat('HH:mm'))) {
          before = backward.toFormat('HH:mm');
          break;
        }
      }

      return { before, after };
    };

    if (blocked.length > 0 || confirmedCount.length >= maxReservations) {
      const alternatives = findNextAvailableSlots(reservationTime);

      const payload = {
        type: 'reservation.unavailable',
        available: false,
        reason: 'full',
        remaining: 0,
        date,
        timeSlot,
        alternatives
      };

      return { status: 409, body: payload };
    }

    const { confirmationCode } = await createReservation(parsed, config);

    // ✨ Send email after successful reservation creation
    await sendConfirmationEmail({ type: 'reservation', confirmationCode, config });

    const payload = {
      type: 'reservation.complete',
      confirmationCode,
      name: parsed.name,
      partySize: parsed.partySize,
      timeSlot: parsed.timeSlot,
      date: parsed.date
    };

    return { status: 201, body: payload };
  } catch (err) {
    console.error('[ROUTE][reservation] Error caught:', err);
    const error = {
      type: 'reservation.error',
      error: 'internal_server_error'
    };
    return { status: 500, body: error };
  }
};
