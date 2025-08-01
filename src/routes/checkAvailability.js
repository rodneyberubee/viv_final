import { loadRestaurantConfig } from '../utils/loadConfig.js';
import Airtable from 'airtable';
import { parseDateTime, isPast, getCurrentDateTime } from '../utils/dateHelpers.js';

export const checkAvailability = async (req) => {
  const { restaurantId } = req.params;
  const { date, timeSlot } = req.body;

  if (!date || !timeSlot) {
    const parsed = { date: date || null, timeSlot: timeSlot || null, restaurantId };
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
    const normalizedDate = date.trim();
    const normalizedTime = timeSlot.toString().trim();
    const currentTime = parseDateTime(normalizedDate, normalizedTime, timeZone);
    const now = getCurrentDateTime(timeZone).startOf('day');
    const cutoffDate = now.plus({ days: futureCutoff }).endOf('day');

    console.log('[DEBUG][checkAvailability] Incoming:', { date: normalizedDate, timeSlot: normalizedTime, restaurantId });
    console.log('[DEBUG][checkAvailability] Parsed DateTime:', currentTime?.toISO() || 'Invalid');
    console.log('[DEBUG][checkAvailability] Now:', now.toISO());
    console.log('[DEBUG][checkAvailability] Cutoff date:', cutoffDate.toISO());
    console.log('[DEBUG][checkAvailability] TimeZone used:', timeZone);

    if (!currentTime) {
      return { status: 400, body: { type: 'availability.check.error', error: 'invalid_date_or_time' } };
    }
    if (isPast(normalizedDate, normalizedTime, timeZone)) {
      return { status: 400, body: { type: 'availability.check.error', error: 'cannot_check_past' } };
    }
    if (currentTime > cutoffDate) {
      return { status: 400, body: { type: 'availability.check.error', error: 'outside_reservation_window' } };
    }

    // Query only for this restaurant + date
    const formula = `AND({restaurantId} = '${restaurantId}', {dateFormatted} = '${normalizedDate}')`;
    const allReservations = await airtable(tableName).select({ filterByFormula: formula }).all();

    // Helper: check if a time slot is available (ignores blocked)
    const isSlotAvailable = (time) => {
      const matching = allReservations.filter(r => r.fields.timeSlot?.trim() === time && r.fields.status?.trim().toLowerCase() !== 'blocked');
      const confirmedCount = matching.filter(r => r.fields.status?.trim().toLowerCase() === 'confirmed').length;
      return confirmedCount < maxReservations;
    };

    // Helper: find next available slots
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
          restaurantId,
          alternatives,
          remaining: 0
        }
      };
    }

    // Filter out blocked/past/out-of-window
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

    console.log('[DEBUG][checkAvailability] Total fetched reservations:', allReservations.length);
    console.log('[DEBUG][checkAvailability] Valid reservations after filtering:', validReservations.length);

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
          restaurantId,
          alternatives,
          remaining: 0
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
        restaurantId,
        remaining
      }
    };
  } catch (err) {
    console.error('[ERROR] Airtable checkAvailability failure', err);
    return { status: 500, body: { type: 'availability.check.error', error: 'airtable_query_failed' } };
  }
};
