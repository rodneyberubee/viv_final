import { loadRestaurantConfig } from '../utils/loadConfig.js';
import Airtable from 'airtable';
import dayjs from 'dayjs';

export const checkAvailability = async (req) => {
  console.log('[DEBUG] checkAvailability called');

  const { restaurantId } = req.params;
  const { date, timeSlot } = req.body;

  console.log('[DEBUG] Input:', { restaurantId, date, timeSlot });

  if (!date || !timeSlot) {
    console.error('[ERROR] Missing required fields');
    return {
      status: 400,
      body: {
        type: 'availability.check.error',
        error: 'missing_required_fields'
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

  const { baseId, tableName, maxReservations, calibratedTime } = config;
  console.log('[DEBUG] Loaded config:', config);

  const airtable = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(baseId);

  try {
    const normalizedDate = date.trim();
    const normalizedTime = timeSlot.toString().trim();
    const formula = `{dateFormatted} = '${normalizedDate}'`;

    const allReservations = await airtable(tableName)
      .select({ filterByFormula: formula })
      .all();

    console.log(`[DEBUG] Pulled ${allReservations.length} reservations for date: ${normalizedDate}`);

    const isSlotAvailable = (time) => {
      const matching = allReservations.filter(r => r.fields.timeSlot?.trim() === time);
      const isBlocked = matching.some(r => r.fields.status?.trim().toLowerCase() === 'blocked');
      const confirmedCount = matching.filter(r => r.fields.status?.trim().toLowerCase() === 'confirmed').length;
      return !isBlocked && confirmedCount < maxReservations;
    };

    const findNextAvailableSlots = (centerTime, maxSteps = 96) => {
      const results = { before: null, after: null };
      let forward = centerTime.clone();
      let backward = centerTime.clone();

      for (let i = 1; i <= maxSteps; i++) {
        forward = forward.add(15, 'minute');
        const f = forward.format('HH:mm');
        if (isSlotAvailable(f)) {
          results.after = f;
          break;
        }
      }

      for (let i = 1; i <= maxSteps; i++) {
        backward = backward.subtract(15, 'minute');
        const b = backward.format('HH:mm');
        if (isSlotAvailable(b)) {
          results.before = b;
          break;
        }
      }

      return results;
    };

    const matchingSlotReservations = allReservations.filter(r => {
      const rawTime = r.fields?.timeSlot?.toString().trim();
      return rawTime === normalizedTime;
    });

    const isBlocked = matchingSlotReservations.some(r => {
      const status = (r.fields.status || '').trim().toLowerCase();
      return status === 'blocked';
    });

    const confirmedCount = matchingSlotReservations.filter(r => {
      const status = (r.fields.status || '').trim().toLowerCase();
      return status === 'confirmed';
    }).length;

    const remaining = maxReservations - confirmedCount;

    // Use calibrated time for accurate reference
    const now = calibratedTime ? dayjs(calibratedTime) : dayjs();
    const currentTime = dayjs(`${normalizedDate}T${normalizedTime}`);

    if (isBlocked || remaining <= 0 || currentTime.isBefore(now)) {
      const alternatives = findNextAvailableSlots(currentTime, 96);

      return {
        status: 200,
        body: {
          type: 'availability.unavailable',
          available: false,
          reason: isBlocked ? 'blocked' : (currentTime.isBefore(now) ? 'time_passed' : 'full'),
          date: normalizedDate,
          timeSlot: normalizedTime,
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
