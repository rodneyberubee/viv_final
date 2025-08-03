import Airtable from 'airtable';
import { parseDateTime, isPast, getCurrentDateTime } from '../utils/dateHelpers.js';
import { loadRestaurantConfig } from '../utils/loadConfig.js';
import { sendConfirmationEmail } from '../utils/sendConfirmationEmail.js';

// Helper: Consistent business hours error formatter
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

export const changeReservation = async (req) => {
  const { restaurantId } = req.params;
  if (!restaurantId) {
    console.error('[ERROR] restaurantId is missing from req.params');
    return { status: 400, body: { type: 'reservation.error', error: 'missing_restaurant_id' } };
  }

  const { confirmationCode, newDate, newTimeSlot, rawDate, rawTimeSlot, name } = req.body;
  let normalizedCode = typeof confirmationCode === 'string' ? confirmationCode.trim() : confirmationCode;
  const normalizedDate = typeof newDate === 'string' ? newDate.trim() : (rawDate || newDate);
  const normalizedTime = typeof newTimeSlot === 'string' ? newTimeSlot.trim() : (rawTimeSlot || newTimeSlot);

  const isLikelyConfirmationCode = (val) => typeof val === 'string' && /^[a-zA-Z0-9]{6,12}$/.test(val);
  if (!normalizedCode && isLikelyConfirmationCode(name)) {
    normalizedCode = name;
    console.log('[DEBUG][changeReservation] Using name as confirmationCode fallback:', normalizedCode);
  }

  if (!normalizedCode || !normalizedDate || !normalizedTime) {
    console.error('[ERROR][changeReservation] One or more required fields missing');
    const missingBody = {
      type: 'reservation.error',
      error: 'missing_required_fields',
      missing: [
        !normalizedCode && 'confirmationCode',
        !normalizedDate && 'newDate',
        !normalizedTime && 'newTimeSlot'
      ].filter(Boolean)
    };
    console.log('[DEBUG][changeReservation] Returning:', JSON.stringify(missingBody, null, 2));
    return { status: 400, body: missingBody };
  }

  const config = await loadRestaurantConfig(restaurantId);
  if (!config) {
    console.error('[ERROR][changeReservation] Config not found for:', restaurantId);
    const body = { type: 'reservation.error', error: 'config_not_found' };
    console.log('[DEBUG][changeReservation] Returning:', JSON.stringify(body, null, 2));
    return { status: 404, body };
  }

  const { baseId, tableName, maxReservations, timeZone, futureCutoff } = config;
  const airtable = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(baseId);

  const targetDateTime = parseDateTime(normalizedDate, normalizedTime, timeZone);
  const weekday = targetDateTime?.toFormat('cccc').toLowerCase() || 'monday';
  const openKey = `${weekday}Open`;
  const closeKey = `${weekday}Close`;
  const openTime = config[openKey];
  const closeTime = config[closeKey];
  const hoursDetails = buildOutsideHoursError(normalizedDate, openTime, closeTime, timeZone);

  if (!targetDateTime) {
    const body = { type: 'reservation.error', error: 'invalid_date_or_time', ...hoursDetails };
    console.log('[DEBUG][changeReservation] Returning:', JSON.stringify(body, null, 2));
    return { status: 400, body };
  }
  if (isPast(normalizedDate, normalizedTime, timeZone)) {
    const body = { type: 'reservation.error', error: 'cannot_change_to_past', ...hoursDetails };
    console.log('[DEBUG][changeReservation] Returning:', JSON.stringify(body, null, 2));
    return { status: 400, body };
  }

  const now = getCurrentDateTime(timeZone).startOf('day');
  const cutoffDate = now.plus({ days: futureCutoff }).endOf('day');
  if (targetDateTime > cutoffDate) {
    const body = { type: 'reservation.error', error: 'outside_reservation_window', ...hoursDetails };
    console.log('[DEBUG][changeReservation] Returning:', JSON.stringify(body, null, 2));
    return { status: 400, body };
  }

  if (!openTime || !closeTime || openTime.toLowerCase() === 'closed' || closeTime.toLowerCase() === 'closed') {
    const body = { type: 'reservation.error', error: 'outside_business_hours', ...hoursDetails };
    console.log('[DEBUG][changeReservation] Returning:', JSON.stringify(body, null, 2));
    return { status: 400, body };
  }

  let openDateTime = parseDateTime(normalizedDate, openTime, timeZone);
  let closeDateTime = parseDateTime(normalizedDate, closeTime, timeZone);
  if (closeDateTime <= openDateTime) closeDateTime = closeDateTime.plus({ days: 1 });

  if (targetDateTime < openDateTime || targetDateTime > closeDateTime) {
    const body = { type: 'reservation.error', error: 'outside_business_hours', ...hoursDetails };
    console.log('[DEBUG][changeReservation] Returning:', JSON.stringify(body, null, 2));
    return { status: 400, body };
  }

  try {
    const match = await airtable(tableName)
      .select({ filterByFormula: `AND({rawConfirmationCode} = '${normalizedCode}', {restaurantId} = '${restaurantId}')` })
      .firstPage();

    if (match.length === 0) {
      const body = { type: 'reservation.error', error: 'not_found', confirmationCode: normalizedCode, ...hoursDetails };
      console.log('[DEBUG][changeReservation] Returning:', JSON.stringify(body, null, 2));
      return { status: 404, body };
    }

    const allForDate = await airtable(tableName)
      .select({ filterByFormula: `AND({dateFormatted} = '${normalizedDate}', {restaurantId} = '${restaurantId}')` })
      .all();

    const isWithinBusinessHours = (time) => {
      let slotDT = parseDateTime(normalizedDate, time, timeZone);
      if (closeDateTime <= openDateTime && slotDT < openDateTime) slotDT = slotDT.plus({ days: 1 });
      return slotDT >= openDateTime && slotDT <= closeDateTime;
    };

    const isSlotAvailable = (time) => {
      if (!isWithinBusinessHours(time)) return false;
      const matching = allForDate.filter(r => r.fields.timeSlot?.trim() === time && r.fields.status?.trim().toLowerCase() !== 'blocked');
      const confirmed = matching.filter(r => r.fields.status?.trim().toLowerCase() === 'confirmed');
      return confirmed.length < maxReservations;
    };

    const findNextAvailableSlots = (centerTime, maxSteps = 96) => {
      let before = null, after = null, forward = centerTime, backward = centerTime;
      for (let i = 1; i <= maxSteps; i++) {
        forward = forward.plus({ minutes: 15 });
        if (isSlotAvailable(forward.toFormat('HH:mm'))) { after = forward.toFormat('HH:mm'); break; }
      }
      for (let i = 1; i <= maxSteps; i++) {
        backward = backward.minus({ minutes: 15 });
        if (isSlotAvailable(backward.toFormat('HH:mm'))) { before = backward.toFormat('HH:mm'); break; }
      }
      return { before, after };
    };

    const sameSlotAll = allForDate.filter(r => r.fields.timeSlot?.trim() === normalizedTime);
    const isBlocked = sameSlotAll.some(r => r.fields.status?.trim().toLowerCase() === 'blocked');
    if (isBlocked) {
      const body = { type: 'reservation.unavailable', available: false, reason: 'blocked', date: normalizedDate, timeSlot: normalizedTime, remaining: 0, alternatives: findNextAvailableSlots(targetDateTime), ...hoursDetails };
      console.log('[DEBUG][changeReservation] Returning:', JSON.stringify(body, null, 2));
      return { status: 409, body };
    }

    const confirmedReservations = sameSlotAll.filter(r => r.fields.status?.trim().toLowerCase() === 'confirmed');
    if (confirmedReservations.length >= maxReservations) {
      const body = { type: 'reservation.unavailable', available: false, reason: 'full', date: normalizedDate, timeSlot: normalizedTime, remaining: 0, alternatives: findNextAvailableSlots(targetDateTime), ...hoursDetails };
      console.log('[DEBUG][changeReservation] Returning:', JSON.stringify(body, null, 2));
      return { status: 409, body };
    }

    await airtable(tableName).update(match[0].id, { date: normalizedDate, timeSlot: normalizedTime, restaurantId: config.restaurantId });
    await sendConfirmationEmail({ type: 'change', confirmationCode: normalizedCode, config });

    const successBody = { type: 'reservation.change', confirmationCode: normalizedCode, newDate: normalizedDate, newTimeSlot: normalizedTime, restaurantId: config.restaurantId, ...hoursDetails };
    console.log('[DEBUG][changeReservation] Returning:', JSON.stringify(successBody, null, 2));
    return { status: 200, body: successBody };
  } catch (err) {
    console.error('[ERROR][changeReservation] Unexpected failure:', err);
    const body = { type: 'reservation.error', error: 'internal_error', ...hoursDetails };
    console.log('[DEBUG][changeReservation] Returning:', JSON.stringify(body, null, 2));
    return { status: 500, body };
  }
};
