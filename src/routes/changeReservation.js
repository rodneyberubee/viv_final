import Airtable from 'airtable';
import dayjs from 'dayjs';
import { loadRestaurantConfig } from '../utils/loadConfig.js';
import { normalizeDateTime } from '../utils/normalizeDate.js';

export const changeReservation = async (req) => {
  console.log('[DEBUG][changeReservation] Route hit');

  const { restaurantId } = req.params;
  if (!restaurantId) {
    console.error('[ERROR] restaurantId is missing from req.body');
    return {
      status: 400,
      body: {
        type: 'reservation.change.error',
        error: 'missing_restaurant_id'
      }
    };
  }

  const { confirmationCode, newDate, newTimeSlot } = req.body;

  console.log('[DEBUG][changeReservation] Incoming Params:', {
    confirmationCode, newDate, newTimeSlot
  });

  const normalizedCode = confirmationCode?.trim();
  const normalizedDate = newDate?.trim();
  const normalizedTime = newTimeSlot?.trim();

  if (!normalizedCode || !normalizedDate || !normalizedTime) {
    console.error('[ERROR][changeReservation] One or more required fields missing');
    return {
      status: 400,
      body: {
        type: 'reservation.change.error',
        error: 'missing_required_fields',
        missing: [
          !normalizedCode && 'confirmationCode',
          !normalizedDate && 'newDate',
          !normalizedTime && 'newTimeSlot'
        ].filter(Boolean)
      }
    };
  }

  const restaurantMap = await loadRestaurantConfig(restaurantId);
  if (!restaurantMap) {
    console.error('[ERROR][changeReservation] Config not found for:', restaurantId);
    return {
      status: 404,
      body: {
        type: 'reservation.change.error',
        error: 'config_not_found'
      }
    };
  }

  const { base_id, table_name, max_reservations, timezone } = restaurantMap;
  console.log('[DEBUG][changeReservation] Loaded config:', restaurantMap);

  const airtable = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(base_id);

  try {
    const match = await airtable(table_name)
      .select({
        filterByFormula: `{rawConfirmationCode} = '${normalizedCode}'`,
      })
      .firstPage();

    if (match.length === 0) {
      console.warn('[WARN][changeReservation] No matching reservation for code:', normalizedCode);
      return {
        status: 404,
        body: {
          type: 'reservation.change.not_found',
          confirmationCode: normalizedCode
        }
      };
    }

    const allForDate = await airtable(table_name)
      .select({
        filterByFormula: `{dateFormatted} = '${normalizedDate}'`,
      })
      .all();

    const sameSlot = allForDate.filter(r => r.fields.timeSlot?.trim() === normalizedTime);
    const isBlocked = sameSlot.some(r => r.fields.status?.toLowerCase() === 'blocked');
    const confirmedCount = sameSlot.filter(r => r.fields.status?.toLowerCase() === 'confirmed').length;

    if (isBlocked || confirmedCount >= max_reservations) {
      const centerTime = normalizeDateTime(normalizedDate, normalizedTime, timezone);
      if (!centerTime) {
        return {
          status: 400,
          body: {
            type: 'reservation.change.error',
            error: 'invalid_datetime_format'
          }
        };
      }

      const findNextAvailableSlots = (target, maxSteps = 96) => {
        let before = null;
        let after = null;

        const isAvailable = (timeStr) => {
          const entries = allForDate.filter(r => r.fields.timeSlot?.trim() === timeStr);
          const blocked = entries.some(r => r.fields.status?.toLowerCase() === 'blocked');
          const confirmed = entries.filter(r => r.fields.status?.toLowerCase() === 'confirmed').length;
          return !blocked && confirmed < max_reservations;
        };

        let forward = target.clone();
        let backward = target.clone();

        for (let i = 1; i <= maxSteps; i++) {
          forward = forward.add(15, 'minute');
          if (!after && isAvailable(forward.format('HH:mm'))) {
            after = forward.format('HH:mm');
          }

          backward = backward.subtract(15, 'minute');
          if (!before && isAvailable(backward.format('HH:mm'))) {
            before = backward.format('HH:mm');
          }

          if (before && after) break;
        }

        return { before, after };
      };

      const alternatives = findNextAvailableSlots(centerTime);

      return {
        status: 409,
        body: {
          type: 'reservation.unavailable',
          available: false,
          reason: isBlocked ? 'blocked' : 'full',
          remaining: Math.max(0, max_reservations - confirmedCount),
          date: normalizedDate,
          timeSlot: normalizedTime,
          alternatives
        }
      };
    }

    await airtable(table_name).update(match[0].id, {
      date: normalizedDate,
      timeSlot: normalizedTime,
    });

    console.log('[DEBUG][changeReservation] Reservation updated successfully');
    return {
      status: 200,
      body: {
        type: 'reservation.changed',
        confirmationCode: normalizedCode,
        newDate: normalizedDate,
        newTimeSlot: normalizedTime
      }
    };

  } catch (err) {
    console.error('[ERROR][changeReservation] Unexpected failure:', err);
    return {
      status: 500,
      body: {
        type: 'reservation.change.error',
        error: 'internal_error'
      }
    };
  }
};
