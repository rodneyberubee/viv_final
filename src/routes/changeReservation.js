import Airtable from 'airtable';
import { parseDateTime, isPast, getCurrentDateTime } from '../utils/dateHelpers.js';
import { loadRestaurantConfig } from '../utils/loadConfig.js';
import { sendConfirmationEmail } from '../utils/sendConfirmationEmail.js';

export const changeReservation = async (req) => {
  const { restaurantId } = req.params;
  if (!restaurantId) {
    console.error('[ERROR] restaurantId is missing from req.params');
    return { status: 400, body: { type: 'reservation.error', error: 'missing_restaurant_id' } };
  }

  // Added support for raw fallbacks
  const { confirmationCode, newDate, newTimeSlot, rawDate, rawTimeSlot } = req.body;
  const normalizedCode = typeof confirmationCode === 'string' ? confirmationCode.trim() : confirmationCode;
  const normalizedDate = typeof newDate === 'string' ? newDate.trim() : (rawDate || newDate);
  const normalizedTime = typeof newTimeSlot === 'string' ? newTimeSlot.trim() : (rawTimeSlot || newTimeSlot);

  if (!normalizedCode || !normalizedDate || !normalizedTime) {
    console.error('[ERROR][changeReservation] One or more required fields missing');
    return {
      status: 400,
      body: {
        type: 'reservation.error',
        error: 'missing_required_fields',
        missing: [
          !normalizedCode && 'confirmationCode',
          !normalizedDate && 'newDate',
          !normalizedTime && 'newTimeSlot'
        ].filter(Boolean)
      }
    };
  }

  const config = await loadRestaurantConfig(restaurantId);
  if (!config) {
    console.error('[ERROR][changeReservation] Config not found for:', restaurantId);
    return { status: 404, body: { type: 'reservation.error', error: 'config_not_found' } };
  }

  const { baseId, tableName, maxReservations, timeZone, futureCutoff } = config;
  const airtable = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(baseId);

  const targetDateTime = parseDateTime(normalizedDate, normalizedTime, timeZone);
  if (!targetDateTime) {
    return { status: 400, body: { type: 'reservation.error', error: 'invalid_date_or_time' } };
  }
  if (isPast(normalizedDate, normalizedTime, timeZone)) {
    return { status: 400, body: { type: 'reservation.error', error: 'cannot_change_to_past' } };
  }

  const now = getCurrentDateTime(timeZone).startOf('day');
  const cutoffDate = now.plus({ days: futureCutoff }).endOf('day');
  if (targetDateTime > cutoffDate) {
    return { status: 400, body: { type: 'reservation.error', error: 'outside_reservation_window' } };
  }

  // Business hours validation (strong enforcement)
  const weekday = targetDateTime.toFormat('cccc').toLowerCase();
  const openKey = `${weekday}Open`;
  const closeKey = `${weekday}Close`;
  const openTime = config[openKey];
  const closeTime = config[closeKey];

  if (!openTime || !closeTime || openTime.toLowerCase() === 'closed' || closeTime.toLowerCase() === 'closed') {
    return { status: 400, body: { type: 'reservation.error', error: 'outside_business_hours' } };
  }

  let openDateTime = parseDateTime(normalizedDate, openTime, timeZone);
  let closeDateTime = parseDateTime(normalizedDate, closeTime, timeZone);

  // Handle overnight hours (close after midnight)
  if (closeDateTime <= openDateTime) {
    closeDateTime = closeDateTime.plus({ days: 1 });
  }

  if (targetDateTime < openDateTime || targetDateTime > closeDateTime) {
    return { status: 400, body: { type: 'reservation.error', error: 'outside_business_hours' } };
  }

  try {
    // Lookup reservation by code
    const match = await airtable(tableName)
      .select({
        filterByFormula: `AND({rawConfirmationCode} = '${normalizedCode}', {restaurantId} = '${restaurantId}')`,
      })
      .firstPage();

    if (match.length === 0) {
      return {
        status: 404,
        body: { type: 'reservation.error', error: 'not_found', confirmationCode: normalizedCode }
      };
    }

    // Re-pull all reservations for target date
    const allForDate = await airtable(tableName)
      .select({
        filterByFormula: `AND({dateFormatted} = '${normalizedDate}', {restaurantId} = '${restaurantId}')`,
      })
      .all();

    const isWithinBusinessHours = (time) => {
      let slotDT = parseDateTime(normalizedDate, time, timeZone);
      if (closeDateTime <= openDateTime) {
        if (slotDT < openDateTime) slotDT = slotDT.plus({ days: 1 });
      }
      return slotDT >= openDateTime && slotDT <= closeDateTime;
    };

    const isSlotAvailable = (time) => {
      if (!isWithinBusinessHours(time)) return false;
      const matching = allForDate.filter(r => r.fields.timeSlot?.trim() === time && r.fields.status?.trim().toLowerCase() !== 'blocked');
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
        const forwardTime = forward.toFormat('HH:mm');
        if (isSlotAvailable(forwardTime)) {
          after = forwardTime;
          break;
        }
      }
      for (let i = 1; i <= maxSteps; i++) {
        backward = backward.minus({ minutes: 15 });
        const backwardTime = backward.toFormat('HH:mm');
        if (isSlotAvailable(backwardTime)) {
          before = backwardTime;
          break;
        }
      }
      return { before, after };
    };

    // Check for block
    const sameSlotAll = allForDate.filter(r => r.fields.timeSlot?.trim() === normalizedTime);
    const isBlocked = sameSlotAll.some(r => r.fields.status?.trim().toLowerCase() === 'blocked');
    if (isBlocked) {
      const alternatives = findNextAvailableSlots(targetDateTime);
      return {
        status: 409,
        body: {
          type: 'reservation.unavailable',
          available: false,
          reason: 'blocked',
          date: normalizedDate,
          timeSlot: normalizedTime,
          remaining: 0,
          alternatives
        }
      };
    }

    // Capacity check
    const confirmedReservations = sameSlotAll.filter(r => r.fields.status?.trim().toLowerCase() === 'confirmed');
    if (confirmedReservations.length >= maxReservations) {
      const alternatives = findNextAvailableSlots(targetDateTime);
      return {
        status: 409,
        body: {
          type: 'reservation.unavailable',
          available: false,
          reason: 'full',
          date: normalizedDate,
          timeSlot: normalizedTime,
          remaining: 0,
          alternatives
        }
      };
    }

    // Perform update with enforced restaurantId
    await airtable(tableName).update(match[0].id, {
      date: normalizedDate,
      timeSlot: normalizedTime,
      restaurantId: config.restaurantId
    });

    await sendConfirmationEmail({ type: 'change', confirmationCode: normalizedCode, config });

    return {
      status: 200,
      body: {
        type: 'reservation.change',
        confirmationCode: normalizedCode,
        newDate: normalizedDate,
        newTimeSlot: normalizedTime,
        restaurantId: config.restaurantId
      }
    };
  } catch (err) {
    console.error('[ERROR][changeReservation] Unexpected failure:', err);
    return { status: 500, body: { type: 'reservation.error', error: 'internal_error' } };
  }
};
