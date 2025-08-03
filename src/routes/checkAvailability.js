import { loadRestaurantConfig } from '../utils/loadConfig.js';
import Airtable from 'airtable';
import { parseDateTime, isPast, getCurrentDateTime } from '../utils/dateHelpers.js';

// Helper: Consistent business hours error formatter
const buildOutsideHoursError = (date, openTime, closeTime, timeZone) => {
  const formattedOpen = openTime ? parseDateTime(date, openTime, timeZone).toFormat('hh:mm a') : null;
  const formattedClose = closeTime ? parseDateTime(date, closeTime, timeZone).toFormat('hh:mm a') : null;
  return { openTime: formattedOpen, closeTime: formattedClose };
};

export const checkAvailability = async (req) => {
  const { restaurantId } = req.params;
  const { date, timeSlot, rawDate, rawTimeSlot } = req.body;

  // Use normalized or fallback raw values
  const normalizedDate = typeof date === 'string' ? date.trim() : (rawDate || date);
  const normalizedTime = typeof timeSlot === 'string' ? timeSlot.toString().trim() : (rawTimeSlot || timeSlot);

  if (!normalizedDate || !normalizedTime) {
    const parsed = { date: normalizedDate || null, timeSlot: normalizedTime || null, restaurantId };
    return { status: 200, body: { type: 'availability.check.incomplete', parsed } };
  }

  const config = await loadRestaurantConfig(restaurantId);
  if (!config) {
    console.error('[ERROR] Restaurant config not found for:', restaurantId);
    return { status: 404, body: { type: 'availability.check.error', error: 'config_not_found' } };
  }

  const { baseId, tableName, maxReservations, timeZone, futureCutoff } = config;
  const airtable = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(baseId);

  try {
    const currentTime = parseDateTime(normalizedDate, normalizedTime, timeZone);
    const now = getCurrentDateTime(timeZone).startOf('day');
    const cutoffDate = now.plus({ days: futureCutoff }).endOf('day');

    if (!currentTime) {
      return { status: 400, body: { type: 'availability.check.error', error: 'invalid_date_or_time' } };
    }
    if (isPast(normalizedDate, normalizedTime, timeZone)) {
      return { status: 400, body: { type: 'availability.check.error', error: 'cannot_check_past' } };
    }
    if (currentTime > cutoffDate) {
      return { status: 400, body: { type: 'availability.check.error', error: 'outside_reservation_window' } };
    }

    // Business hours check
    const weekday = currentTime.toFormat('cccc').toLowerCase();
    const openKey = `${weekday}Open`;
    const closeKey = `${weekday}Close`;
    const openTime = config[openKey];
    const closeTime = config[closeKey];
    const hoursDetails = buildOutsideHoursError(normalizedDate, openTime, closeTime, timeZone);

    // If closed or missing hours
    if (!openTime || !closeTime || openTime.toLowerCase() === 'closed' || closeTime.toLowerCase() === 'closed') {
      return { 
        status: 400, 
        body: { 
          type: 'availability.check.error', 
          error: 'outside_business_hours', 
          ...hoursDetails
        } 
      };
    }

    let openDateTime = parseDateTime(normalizedDate, openTime, timeZone);
    let closeDateTime = parseDateTime(normalizedDate, closeTime, timeZone);

    // Handle overnight hours
    if (closeDateTime <= openDateTime) {
      closeDateTime = closeDateTime.plus({ days: 1 });
    }

    if (currentTime < openDateTime || currentTime > closeDateTime) {
      return { 
        status: 400, 
        body: { 
          type: 'availability.check.error', 
          error: 'outside_business_hours',
          ...hoursDetails
        } 
      };
    }

    // Query only for this restaurant + date
    const formula = `AND({restaurantId} = '${config.restaurantId}', {dateFormatted} = '${normalizedDate}')`;
    const allReservations = await airtable(tableName).select({ filterByFormula: formula }).all();

    // Check if time is within business hours
    const isWithinBusinessHours = (time) => {
      let slotDT = parseDateTime(normalizedDate, time, timeZone);
      if (closeDateTime <= openDateTime) {
        if (slotDT < openDateTime) slotDT = slotDT.plus({ days: 1 });
      }
      return slotDT >= openDateTime && slotDT <= closeDateTime;
    };

    const isSlotAvailable = (time) => {
      if (!isWithinBusinessHours(time)) return false;
      const matching = allReservations.filter(r => r.fields.timeSlot?.trim() === time && r.fields.status?.trim().toLowerCase() !== 'blocked');
      const confirmedCount = matching.filter(r => r.fields.status?.trim().toLowerCase() === 'confirmed').length;
      return confirmedCount < maxReservations;
    };

    const findNextAvailableSlots = (centerTime, maxSteps = 96) => {
      const results = { before: null, after: null };
      let forward = centerTime;
      let backward = centerTime;
      for (let i = 1; i <= maxSteps; i++) {
        forward = forward.plus({ minutes: 15 });
        const f = forward.toFormat('HH:mm');
        if (isSlotAvailable(f)) {
          results.after = f;
          break;
        }
      }
      for (let i = 1; i <= maxSteps; i++) {
        backward = backward.minus({ minutes: 15 });
        const b = backward.toFormat('HH:mm');
        if (isSlotAvailable(b)) {
          results.before = b;
          break;
        }
      }
      return results;
    };

    // Check if this exact slot is blocked
    const sameSlotAll = allReservations.filter(r => r.fields.timeSlot?.trim() === normalizedTime);
    const isBlocked = sameSlotAll.some(r => r.fields.status?.trim().toLowerCase() === 'blocked');
    if (isBlocked) {
      const alternatives = findNextAvailableSlots(currentTime, 96);
      return {
        status: 200,
        body: {
          type: 'availability.unavailable',
          available: false,
          reason: 'blocked',
          date: normalizedDate,
          timeSlot: normalizedTime,
          restaurantId: config.restaurantId,
          alternatives,
          remaining: 0,
          ...hoursDetails
        }
      };
    }

    const validReservations = allReservations.filter(r => {
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

    const matchingSlotReservations = validReservations.filter(r => r.fields.timeSlot?.trim() === normalizedTime);
    const confirmedCount = matchingSlotReservations.filter(r => (r.fields.status || '').trim().toLowerCase() === 'confirmed').length;
    const remaining = maxReservations - confirmedCount;

    if (remaining <= 0) {
      const alternatives = findNextAvailableSlots(currentTime, 96);
      return {
        status: 200,
        body: {
          type: 'availability.unavailable',
          available: false,
          reason: 'full',
          date: normalizedDate,
          timeSlot: normalizedTime,
          restaurantId: config.restaurantId,
          alternatives,
          remaining: 0,
          ...hoursDetails
        }
      };
    }

    return {
      status: 200,
      body: {
        type: 'availability.available',
        available: true,
        date: normalizedDate,
        timeSlot: normalizedTime,
        restaurantId: config.restaurantId,
        remaining,
        ...hoursDetails
      }
    };
  } catch (err) {
    console.error('[ERROR] Airtable checkAvailability failure', err);
    return { status: 500, body: { type: 'availability.check.error', error: 'airtable_query_failed' } };
  }
};
