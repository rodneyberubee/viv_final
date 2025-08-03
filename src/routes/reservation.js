import Airtable from 'airtable';
import { parseDateTime, getCurrentDateTime, isPast } from '../utils/dateHelpers.js';
import { loadRestaurantConfig } from '../utils/loadConfig.js';
import { sendConfirmationEmail } from '../utils/sendConfirmationEmail.js';

const airtableClient = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY });

// Helper: Build consistent business hours error details
const buildOutsideHoursError = (date, openTime, closeTime, timeZone) => {
  const formattedOpen = openTime ? parseDateTime(date, openTime, timeZone).toFormat('hh:mm a') : null;
  const formattedClose = closeTime ? parseDateTime(date, closeTime, timeZone).toFormat('hh:mm a') : null;
  return { openTime: formattedOpen, closeTime: formattedClose };
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

  if (!openTime || !closeTime || openTime.toLowerCase() === 'closed' || closeTime.toLowerCase() === 'closed') {
    const err = new Error('outside_business_hours');
    err.details = buildOutsideHoursError(normalizedDate, openTime, closeTime, timeZone);
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
    err.details = buildOutsideHoursError(normalizedDate, openTime, closeTime, timeZone);
    throw err;
  }

  if (!name?.trim() || !contactInfo?.trim()) {
    throw new Error('missing_required_fields');
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
  if (isBlocked) throw new Error('blocked_slot');

  const confirmedReservations = sameSlotAll.filter(r => r.fields.status?.trim().toLowerCase() === 'confirmed');
  if (confirmedReservations.length >= maxReservations) throw new Error('slot_full');

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
    const hoursDetails = buildOutsideHoursError(normalizedDate, c
