import Airtable from 'airtable';
import { parseDateTime, getCurrentDateTime, isPast } from '../utils/dateHelpers.js'; // ✅ Added isPast
import { loadRestaurantConfig } from '../utils/loadConfig.js';
import { sendConfirmationEmail } from '../utils/sendConfirmationEmail.js'; // ✨ added

const airtableClient = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY });

export const createReservation = async (parsed, config) => {
  const { name, partySize, contactInfo, date, timeSlot, restaurantId } = parsed; // <-- include restaurantId
  const { baseId, tableName } = config;

  const base = airtableClient.base(baseId);
  const confirmationCode = Math.random().toString(36).substr(2, 9);

  const fields = {
    name,
    partySize,
    contactInfo,
    date,
    timeSlot,
    restaurantId, // <-- store it in Airtable
    rawConfirmationCode: confirmationCode,
    status: 'confirmed'
  };

  await base(tableName).create([{ fields }]);
  return { confirmationCode };
};

export const reservation = async (req) => {
  const { restaurantId } = req.params;

  let parsed = req.body;

  // Handle stringified userMessage JSON
  if (typeof parsed.userMessage === 'string') {
    try {
      const fallback = JSON.parse(parsed.userMessage);
      parsed = { ...fallback, restaurantId: restaurantId, route: parsed.route }; // <-- ensure restaurantId is carried over
    } catch (e) {
      return { status: 400, body: { type: 'reservation.error', error: 'invalid_json_in_userMessage' } };
    }
  } else {
    parsed.restaurantId = restaurantId; // <-- add it for non-stringified bodies
  }

  const { name, partySize, contactInfo, date, timeSlot } = parsed;
  const missing = [];
  if (!name) missing.push('name');
  if (!partySize) missing.push('partySize');
  if (!contactInfo) missing.push('contactInfo');
  if (!date) missing.push('date');
  if (!timeSlot) missing.push('timeSlot');

  if (missing.length > 0) {
    return { status: 400, body: { type: 'reservation.error', error: 'missing_required_fields', missing } };
  }

  try {
    const config = await loadRestaurantConfig(restaurantId);
    if (!config) {
      return { status: 404, body: { type: 'reservation.error', error: 'config_not_found' } };
    }

    const { baseId, tableName, maxReservations, futureCutoff, timeZone } = config;
    const base = airtableClient.base(baseId);

    // ✅ Use dateHelpers for consistent parsing and zone awareness
    const now = getCurrentDateTime(timeZone).startOf('day'); // Start of today in restaurant's timezone
    const cutoffDate = now.plus({ days: futureCutoff }).endOf('day'); // Future cutoff at end of day
    const reservationTime = parseDateTime(date, timeSlot, timeZone);

    // Debugging: log parsed values
    console.log('[DEBUG][reservation] Incoming date/time:', { date, timeSlot });
    console.log('[DEBUG][reservation] Parsed reservationTime:', reservationTime?.toISO() || 'Invalid');
    console.log('[DEBUG][reservation] Current day start:', now.toISO());
    console.log('[DEBUG][reservation] Cutoff date (end of day):', cutoffDate.toISO());
    console.log('[DEBUG][reservation] TimeZone used:', timeZone);

    // Guard: invalid date/time
    if (!reservationTime) {
      return { status: 400, body: { type: 'reservation.error', error: 'invalid_date_or_time' } };
    }

    // Guardrail: Block past-time reservations
    if (isPast(date, timeSlot, timeZone)) {
      console.warn('[WARN][reservation] Attempted to book past time');
      return { status: 400, body: { type: 'reservation.error', error: 'cannot_book_in_past' } };
    }

    // Guardrail: Outside reservation window (rounded to full days)
    if (reservationTime > cutoffDate) {
      console.warn('[WARN][reservation] Attempted to book beyond cutoff window');
      return { status: 400, body: { type: 'reservation.error', error: 'outside_reservation_window' } };
    }

    const normalizedDate = date.trim();
    const normalizedTime = timeSlot.toString().trim();

    // 🔹 SCOPED query: only this restaurant + date
    const reservations = await base(tableName)
      .select({
        filterByFormula: `AND({dateFormatted} = '${normalizedDate}', {restaurantId} = '${restaurantId}')`,
        fields: ['status', 'timeSlot', 'date']
      })
      .all();

    // 🔹 PRE-FILTER: remove blocked/past/future-cutoff
    const validReservations = reservations.filter(r => {
      const slot = r.fields.timeSlot?.trim();
      const status = r.fields.status?.trim().toLowerCase();
      const slotDateTime = parseDateTime(normalizedDate, slot, timeZone);
      return (
        status !== 'blocked' &&
        slotDateTime &&
        !isPast(normalizedDate, slot, timeZone) &&
        slotDateTime <= cutoffDate
      );
    });

    console.log('[DEBUG][reservation] Total reservations fetched:', reservations.length);
    console.log('[DEBUG][reservation] Valid reservations after filtering:', validReservations.length);

    const sameSlot = validReservations.filter(r => r.fields.timeSlot?.trim() === normalizedTime);
    const confirmedCount = sameSlot.filter(r => r.fields.status?.trim().toLowerCase() === 'confirmed');

    const isSlotAvailable = (time) => {
      const matching = validReservations.filter(r => r.fields.timeSlot?.trim() === time);
      const confirmed = matching.filter(r => r.fields.status?.trim().toLowerCase() === 'confirmed');
      return confirmed.length < maxReservations;
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

    if (confirmedCount.length >= maxReservations) {
      const alternatives = findNextAvailableSlots(reservationTime);
      return {
        status: 409,
        body: {
          type: 'reservation.unavailable',
          available: false,
          reason: 'full',
          remaining: 0,
          date,
          timeSlot,
          alternatives
        }
      };
    }

    const { confirmationCode } = await createReservation(parsed, config); // <-- now includes restaurantId

    // ✨ Send email after successful reservation creation
    await sendConfirmationEmail({ type: 'reservation', confirmationCode, config });

    return {
      status: 201,
      body: {
        type: 'reservation.complete',
        confirmationCode,
        name: parsed.name,
        partySize: parsed.partySize,
        timeSlot: parsed.timeSlot,
        date: parsed.date
      }
    };
  } catch (err) {
    console.error('[ROUTE][reservation] Error caught:', err);
    return { status: 500, body: { type: 'reservation.error', error: 'internal_server_error' } };
  }
};
