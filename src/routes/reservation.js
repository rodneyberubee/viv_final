import Airtable from 'airtable';
import { parseDateTime, getCurrentDateTime, isPast } from '../utils/dateHelpers.js';
import { loadRestaurantConfig } from '../utils/loadConfig.js';
import { sendConfirmationEmail } from '../utils/sendConfirmationEmail.js';

const airtableClient = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY });

export const createReservation = async (parsed, config) => {
  const { name, partySize, contactInfo, date, timeSlot, restaurantId } = parsed;
  const { baseId, tableName } = config;

  const base = airtableClient.base(baseId);
  const confirmationCode = Math.random().toString(36).substr(2, 9);

  const fields = {
    name,
    partySize,
    contactInfo,
    date,
    timeSlot,
    restaurantId,
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
      parsed = { ...fallback, restaurantId: restaurantId, route: parsed.route };
    } catch (e) {
      return { status: 400, body: { type: 'reservation.error', error: 'invalid_json_in_userMessage' } };
    }
  } else {
    parsed.restaurantId = restaurantId;
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

    const now = getCurrentDateTime(timeZone).startOf('day');
    const cutoffDate = now.plus({ days: futureCutoff }).endOf('day');
    const reservationTime = parseDateTime(date, timeSlot, timeZone);

    if (!reservationTime) {
      return { status: 400, body: { type: 'reservation.error', error: 'invalid_date_or_time' } };
    }
    if (isPast(date, timeSlot, timeZone)) {
      return { status: 400, body: { type: 'reservation.error', error: 'cannot_book_in_past' } };
    }
    if (reservationTime > cutoffDate) {
      return { status: 400, body: { type: 'reservation.error', error: 'outside_reservation_window' } };
    }

    const normalizedDate = date.trim();
    const normalizedTime = timeSlot.toString().trim();

    // Query all reservations for this date
    const reservations = await base(tableName)
      .select({
        filterByFormula: `AND({dateFormatted} = '${normalizedDate}', {restaurantId} = '${restaurantId}')`,
        fields: ['status', 'timeSlot', 'date']
      })
      .all();

    // Helper for capacity checks
    const isSlotAvailable = (time, list) => {
      const matching = list.filter(r => r.fields.timeSlot?.trim() === time && r.fields.status?.trim().toLowerCase() !== 'blocked');
      const confirmed = matching.filter(r => r.fields.status?.trim().toLowerCase() === 'confirmed');
      return confirmed.length < maxReservations;
    };

    // Helper for alternative suggestions
    const findNextAvailableSlots = (centerTime, allReservations, maxSteps = 96) => {
      let before = null;
      let after = null;
      let forward = centerTime;
      let backward = centerTime;

      for (let i = 1; i <= maxSteps; i++) {
        forward = forward.plus({ minutes: 15 });
        if (isSlotAvailable(forward.toFormat('HH:mm'), allReservations)) {
          after = forward.toFormat('HH:mm');
          break;
        }
      }
      for (let i = 1; i <= maxSteps; i++) {
        backward = backward.minus({ minutes: 15 });
        if (isSlotAvailable(backward.toFormat('HH:mm'), allReservations)) {
          before = backward.toFormat('HH:mm');
          break;
        }
      }
      return { before, after };
    };

    // Detect if blocked
    const sameSlotAll = reservations.filter(r => r.fields.timeSlot?.trim() === normalizedTime);
    const isBlocked = sameSlotAll.some(r => r.fields.status?.trim().toLowerCase() === 'blocked');
    if (isBlocked) {
      const alternatives = findNextAvailableSlots(reservationTime, reservations, maxReservations);
      return {
        status: 409,
        body: {
          type: 'reservation.unavailable',
          available: false,
          reason: 'blocked',
          remaining: 0,
          date,
          timeSlot,
          alternatives
        }
      };
    }

    // Filter confirmed for capacity checks
    const confirmedReservations = reservations.filter(r => {
      const slot = r.fields.timeSlot?.trim();
      const status = r.fields.status?.trim().toLowerCase();
      const slotDateTime = parseDateTime(normalizedDate, slot, timeZone);
      return (
        status === 'confirmed' &&
        slotDateTime &&
        !isPast(normalizedDate, slot, timeZone) &&
        slotDateTime <= cutoffDate
      );
    });

    const sameSlot = confirmedReservations.filter(r => r.fields.timeSlot?.trim() === normalizedTime);
    const confirmedCount = sameSlot.length;

    if (confirmedCount >= maxReservations) {
      const alternatives = findNextAvailableSlots(reservationTime, reservations);
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

    const { confirmationCode } = await createReservation(parsed, config);
    await sendConfirmationEmail({ type: 'reservation', confirmationCode, config });

    return {
      status: 201,
      body: {
        type: 'reservation.create', // <-- changed from .complete
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
