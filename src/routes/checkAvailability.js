import { loadRestaurantConfig } from '../utils/loadConfig.js';
import Airtable from 'airtable';
import { parseDateTime, isPast, getCurrentDateTime } from '../utils/dateHelpers.js'; // ✅ Added getCurrentDateTime for clearer logs

export const checkAvailability = async (req) => {
  const { restaurantId } = req.params;
  const { date, timeSlot } = req.body;

  if (!date || !timeSlot) {
    const parsed = {
      date: date || null,
      timeSlot: timeSlot || null,
      restaurantId // <-- include for context
    };

    return {
      status: 200,
      body: {
        type: 'availability.check.incomplete',
        parsed
      }
    };
  }

  const config = await loadRestaurantConfig(restaurantId);
  if (!config) {
    console.error('[ERROR] Restaurant config not found for:', restaurantId);
    return {
      status: 404,
      body: {
        type: 'availability.check.error',
        error: 'config_not_found'
      }
    };
  }

  const { baseId, tableName, maxReservations, timeZone, futureCutoff } = config;
  const airtable = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(baseId);

  try {
    const normalizedDate = date.trim();
    const normalizedTime = timeSlot.toString().trim();
    const currentTime = parseDateTime(normalizedDate, normalizedTime, timeZone);
    const now = getCurrentDateTime(timeZone).startOf('day'); // Start of today in restaurant's timezone
    const cutoffDate = now.plus({ days: futureCutoff }).endOf('day'); // Future cutoff at end of day

    // Debugging: log what Luxon is parsing
    console.log('[DEBUG][checkAvailability] Incoming:', { date: normalizedDate, timeSlot: normalizedTime, restaurantId });
    console.log('[DEBUG][checkAvailability] Parsed DateTime (restaurant zone):', currentTime?.toISO() || 'Invalid');
    console.log('[DEBUG][checkAvailability] Now (restaurant zone):', now.toISO());
    console.log('[DEBUG][checkAvailability] Cutoff date (end of day):', cutoffDate.toISO());
    console.log('[DEBUG][checkAvailability] TimeZone used:', timeZone);

    // ✅ Guard against invalid date/time parsing
    if (!currentTime) {
      return {
        status: 400,
        body: {
          type: 'availability.check.error',
          error: 'invalid_date_or_time'
        }
      };
    }

    // ✅ Guardrail: Prevent checking past times
    if (isPast(normalizedDate, normalizedTime, timeZone)) {
      console.warn('[WARN][checkAvailability] Attempted to check a past time slot');
      return {
        status: 400,
        body: {
          type: 'availability.check.error',
          error: 'cannot_check_past'
        }
      };
    }

    // ✅ Guardrail: Prevent checking beyond the allowed future cutoff
    if (currentTime > cutoffDate) {
      console.warn('[WARN][checkAvailability] Attempted to check beyond futureCutoff');
      return {
        status: 400,
        body: {
          type: 'availability.check.error',
          error: 'outside_reservation_window'
        }
      };
    }

    // 🔄 Updated formula to also filter by restaurantId
    const formula = `AND({restaurantId} = '${restaurantId}', {dateFormatted} = '${normalizedDate}')`;
    const allReservations = await airtable(tableName)
      .select({ filterByFormula: formula })
      .all();

    const isSlotAvailable = (time) => {
      const matching = allReservations.filter(r => r.fields.timeSlot?.trim() === time);
      const isBlocked = matching.some(r => r.fields.status?.trim().toLowerCase() === 'blocked');
      const confirmedCount = matching.filter(r => r.fields.status?.trim().toLowerCase() === 'confirmed').length;
      return !isBlocked && confirmedCount < maxReservations;
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

    const matchingSlotReservations = allReservations.filter(r => r.fields.timeSlot?.trim() === normalizedTime);
    const isBlocked = matchingSlotReservations.some(r => (r.fields.status || '').trim().toLowerCase() === 'blocked');
    const confirmedCount = matchingSlotReservations.filter(r => (r.fields.status || '').trim().toLowerCase() === 'confirmed').length;

    const remaining = maxReservations - confirmedCount;

    if (isBlocked || remaining <= 0) {
      const alternatives = findNextAvailableSlots(currentTime, 96);

      return {
        status: 200,
        body: {
          type: 'availability.unavailable',
          available: false,
          reason: isBlocked ? 'blocked' : 'full',
          date: normalizedDate,
          timeSlot: normalizedTime,
          restaurantId, // <-- add context
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
        restaurantId, // <-- add context
        remaining
      }
    };

  } catch (err) {
    console.error('[ERROR] Airtable checkAvailability failure', err);
    return {
      status: 500,
      body: {
        type: 'availability.check.error',
        error: 'airtable_query_failed'
      }
    };
  }
};
