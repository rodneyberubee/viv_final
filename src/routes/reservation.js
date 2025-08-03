import Airtable from 'airtable';
import { parseDateTime, getCurrentDateTime, isPast } from '../utils/dateHelpers.js';
import { loadRestaurantConfig } from '../utils/loadConfig.js';
import { sendConfirmationEmail } from '../utils/sendConfirmationEmail.js';

const airtableClient = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY });

// Helper: Build consistent business hours error details
const buildOutsideHoursError = (date, openTime, closeTime, timeZone) => {
  try {
    const formattedOpen =
      openTime && openTime.toLowerCase() !== 'closed'
        ? parseDateTime(date, openTime, timeZone).toFormat('hh:mm a')
        : null;
    const formattedClose =
      closeTime && closeTime.toLowerCase() !== 'closed'
        ? parseDateTime(date, closeTime, timeZone).toFormat('hh:mm a')
        : null;
    return { openTime: formattedOpen, closeTime: formattedClose };
  } catch {
    return { openTime: null, closeTime: null };
  }
};

export const createReservation = async (parsed, config) => {
  let { name, partySize, contactInfo, date, timeSlot, rawDate, rawTimeSlot } = parsed;
  const { baseId, tableName, maxReservations, futureCutoff, timeZone } = config;

  const restaurantId = config.restaurantId;

  // Normalize with fallback to raw values
  const normalizedDate = typeof date === 'string' ? date.trim() : (rawDate || date);
  const normalizedTime = typeof timeSlot === 'string' ? timeSlot.toString().trim() : (rawTimeSlot || timeSlot);

  if (!normalizedDate || !normalizedTime) throw new Error('invalid_date_or_time');

  const reservationTime = parseDateTime(normalizedDate, normalizedTime, timeZone);
  const now = getCurrentDateTime(timeZone).startOf('day');
  const cutoffDate = now.plus({ days: futureCutoff }).endOf('day');

  if (!reservationTime) throw new Error('invalid_date_or_time');
  if (isPast(normalizedDate, normalizedTime, timeZone)) throw new Error('cannot_book_in_past');
  if (reservationTime > cutoffDate) throw new Error('outside_reservation_window');

  // Business hours validation (strong enforcement)
  const weekday = reservationTime.toFormat('cccc').toLowerCase();
  const openKey = `${weekday}Open`;
  const closeKey = `${weekday}Close`;
  const openTime = config[openKey];
  const closeTime = config[closeKey];
  const hoursDetails = buildOutsideHoursError(normalizedDate, openTime, closeTime, timeZone);

  if (!openTime || !closeTime || openTime.toLowerCase() === 'closed' || closeTime.toLowerCase() === 'closed') {
    const err = new Error('outside_business_hours');
    err.details = hoursDetails;
    throw err;
  }

  let openDateTime = parseDateTime(normalizedDate, openTime, timeZone);
  let closeDateTime = parseDateTime(normalizedDate, closeTime, timeZone);

  // Handle overnight hours (close after midnight)
  if (closeDateTime <= openDateTime) {
    closeDateTime = closeDateTime.plus({ days: 1 });
  }

  if (reservationTime < openDateTime || reservationTime > closeDateTime) {
    const err = new Error('outside_business_hours');
    err.details = hoursDetails;
    throw err;
  }

  if (!name?.trim() || !contactInfo?.trim()) {
    const err = new Error('missing_required_fields');
    err.details = hoursDetails;
    throw err;
  }

  const base = airtableClient.base(baseId);

  const reservations = await base(tableName)
    .select({
      filterByFormula: `AND({dateFormatted} = '${normalizedDate}', {restaurantId} = '${restaurantId}')`,
      fields: ['status', 'timeSlot']
    })
    .all();

  const sameSlotAll = reservations.filter(r => r.fields.timeSlot?.trim() === normalizedTime);
  const isBlocked = sameSlotAll.some(r => r.fields.status?.trim().toLowerCase() === 'blocked');
  if (isBlocked) {
    const err = new Error('blocked_slot');
    err.details = hoursDetails;
    throw err;
  }

  const confirmedReservations = sameSlotAll.filter(r => r.fields.status?.trim().toLowerCase() === 'confirmed');
  if (confirmedReservations.length >= maxReservations) {
    const err = new Error('slot_full');
    err.details = hoursDetails;
    throw err;
  }

  const confirmationCode = Math.random().toString(36).substr(2, 9);
  const fields = {
    name,
    partySize,
    contactInfo,
    date: normalizedDate,
    timeSlot: normalizedTime,
    restaurantId,
    rawConfirmationCode: confirmationCode,
    status: 'confirmed'
  };

  await base(tableName).create([{ fields }]);
  return { confirmationCode, ...hoursDetails };
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

  try {
    const config = await loadRestaurantConfig(restaurantId);
    if (!config) {
      return { status: 404, body: { type: 'reservation.error', error: 'config_not_found' } };
    }

    const { baseId, tableName, maxReservations, futureCutoff, timeZone } = config;
    const base = airtableClient.base(baseId);

    const { name, partySize, contactInfo, date, timeSlot, rawDate, rawTimeSlot } = parsed;
    const normalizedDate = typeof date === 'string' ? date.trim() : (rawDate || date);
    const normalizedTime = typeof timeSlot === 'string' ? timeSlot.toString().trim() : (rawTimeSlot || timeSlot);

    const weekday = normalizedDate ? parseDateTime(normalizedDate, normalizedTime || '00:00', timeZone).toFormat('cccc').toLowerCase() : 'monday';
    const openKey = `${weekday}Open`;
    const closeKey = `${weekday}Close`;
    const hoursDetails = buildOutsideHoursError(normalizedDate, config[openKey], config[closeKey], timeZone);

    // Missing fields? Include hours in response
    const missing = [];
    if (!name) missing.push('name');
    if (!partySize) missing.push('partySize');
    if (!contactInfo) missing.push('contactInfo');
    if (!date && !rawDate) missing.push('date');
    if (!timeSlot && !rawTimeSlot) missing.push('timeSlot');
    if (missing.length > 0) {
      return { status: 400, body: { type: 'reservation.error', error: 'missing_required_fields', missing, ...hoursDetails } };
    }

    if (!normalizedDate || !normalizedTime) {
      return { status: 400, body: { type: 'reservation.error', error: 'invalid_date_or_time', ...hoursDetails } };
    }

    const now = getCurrentDateTime(timeZone).startOf('day');
    const cutoffDate = now.plus({ days: futureCutoff }).endOf('day');
    const reservationTime = parseDateTime(normalizedDate, normalizedTime, timeZone);

    if (!reservationTime) {
      return { status: 400, body: { type: 'reservation.error', error: 'invalid_date_or_time', ...hoursDetails } };
    }
    if (isPast(normalizedDate, normalizedTime, timeZone)) {
      return { status: 400, body: { type: 'reservation.error', error: 'cannot_book_in_past', ...hoursDetails } };
    }
    if (reservationTime > cutoffDate) {
      return { status: 400, body: { type: 'reservation.error', error: 'outside_reservation_window', ...hoursDetails } };
    }

    let openDateTime = parseDateTime(normalizedDate, config[openKey], timeZone);
    let closeDateTime = parseDateTime(normalizedDate, config[closeKey], timeZone);
    if (closeDateTime <= openDateTime) closeDateTime = closeDateTime.plus({ days: 1 });

    if (reservationTime < openDateTime || reservationTime > closeDateTime) {
      return { status: 400, body: { type: 'reservation.error', error: 'outside_business_hours', ...hoursDetails } };
    }

    const reservations = await base(tableName)
      .select({
        filterByFormula: `AND({dateFormatted} = '${normalizedDate}', {restaurantId} = '${restaurantId}')`,
        fields: ['status', 'timeSlot', 'date']
      })
      .all();

    const isWithinBusinessHours = (time) => {
      let slotDT = parseDateTime(normalizedDate, time, timeZone);
      if (closeDateTime <= openDateTime) {
        if (slotDT < openDateTime) slotDT = slotDT.plus({ days: 1 });
      }
      return slotDT >= openDateTime && slotDT <= closeDateTime;
    };

    const isSlotAvailable = (time, list) => {
      if (!isWithinBusinessHours(time)) return false;
      const matching = list.filter(r => r.fields.timeSlot?.trim() === time && r.fields.status?.trim().toLowerCase() !== 'blocked');
      const confirmed = matching.filter(r => r.fields.status?.trim().toLowerCase() === 'confirmed');
      return confirmed.length < maxReservations;
    };

    const findNextAvailableSlots = (centerTime, allReservations, maxSteps = 96) => {
      let before = null;
      let after = null;
      let forward = centerTime;
      let backward = centerTime;

      for (let i = 1; i <= maxSteps; i++) {
        forward = forward.plus({ minutes: 15 });
        const forwardTime = forward.toFormat('HH:mm');
        if (isSlotAvailable(forwardTime, allReservations)) {
          after = forwardTime;
          break;
        }
      }
      for (let i = 1; i <= maxSteps; i++) {
        backward = backward.minus({ minutes: 15 });
        const backwardTime = backward.toFormat('HH:mm');
        if (isSlotAvailable(backwardTime, allReservations)) {
          before = backwardTime;
          break;
        }
      }
      return { before, after };
    };

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
          date: normalizedDate,
          timeSlot: normalizedTime,
          alternatives,
          ...hoursDetails
        }
      };
    }

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
          date: normalizedDate,
          timeSlot: normalizedTime,
          alternatives,
          ...hoursDetails
        }
      };
    }

    const { confirmationCode, openTime, closeTime } = await createReservation(parsed, { ...config, restaurantId });
    await sendConfirmationEmail({ type: 'reservation', confirmationCode, config });

    return {
      status: 201,
      body: {
        type: 'reservation.complete',
        confirmationCode,
        name: parsed.name,
        partySize: parsed.partySize,
        timeSlot: parsed.timeSlot,
        date: parsed.date,
        openTime,
        closeTime
      }
    };
  } catch (err) {
    console.error('[ROUTE][reservation] Error caught:', err);
    const extra = err.details ? { openTime: err.details.openTime, closeTime: err.details.closeTime } : {};
    return { status: 500, body: { type: 'reservation.error', error: err.message || 'internal_server_error', ...extra } };
  }
};
