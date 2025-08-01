import Airtable from 'airtable';
import { parseDateTime, isPast, getCurrentDateTime } from '../utils/dateHelpers.js';
import { loadRestaurantConfig } from '../utils/loadConfig.js';
import { sendConfirmationEmail } from '../utils/sendConfirmationEmail.js';

export const changeReservation = async (req) => {
  const { restaurantId } = req.params;
  if (!restaurantId) {
    console.error('[ERROR] restaurantId is missing from req.params');
    return {
      status: 400,
      body: { type: 'reservation.change.error', error: 'missing_restaurant_id' }
    };
  }

  const { confirmationCode, newDate, newTimeSlot } = req.body;

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

  const config = await loadRestaurantConfig(restaurantId);
  if (!config) {
    console.error('[ERROR][changeReservation] Config not found for:', restaurantId);
    return {
      status: 404,
      body: { type: 'reservation.change.error', error: 'config_not_found' }
    };
  }

  const { baseId, tableName, maxReservations, timeZone, futureCutoff } = config;
  const airtable = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(baseId);

  const targetDateTime = parseDateTime(normalizedDate, normalizedTime, timeZone);
  console.log('[DEBUG][changeReservation] Requested change to:', targetDateTime?.toISO() || 'Invalid');
  console.log('[DEBUG][changeReservation] Using timezone:', timeZone);

  if (isPast(normalizedDate, normalizedTime, timeZone)) {
    console.warn('[WARN][changeReservation] Attempt to change to a past date/time');
    return {
      status: 400,
      body: { type: 'reservation.change.error', error: 'cannot_change_to_past' }
    };
  }

  const now = getCurrentDateTime(timeZone).startOf('day');
  const cutoffDate = now.plus({ days: futureCutoff }).endOf('day');
  if (targetDateTime > cutoffDate) {
    console.warn('[WARN][changeReservation] Attempt to change beyond futureCutoff');
    return {
      status: 400,
      body: { type: 'reservation.change.error', error: 'outside_reservation_window' }
    };
  }

  try {
    // Fetch the reservation to update
    const match = await airtable(tableName)
      .select({
        filterByFormula: `AND({rawConfirmationCode} = '${normalizedCode}', {restaurantId} = '${restaurantId}')`,
      })
      .firstPage();

    if (match.length === 0) {
      console.warn('[WARN][changeReservation] No matching reservation for code:', normalizedCode);
      return {
        status: 404,
        body: { type: 'reservation.change.not_found', confirmationCode: normalizedCode }
      };
    }

    // Fetch all reservations for the target date
    const allForDate = await airtable(tableName)
      .select({
        filterByFormula: `AND({dateFormatted} = '${normalizedDate}', {restaurantId} = '${restaurantId}')`,
      })
      .all();

    // 🔹 Check if requested slot is explicitly blocked
    const sameSlotAll = allForDate.filter(r => r.fields.timeSlot?.trim() === normalizedTime);
    const isBlocked = sameSlotAll.some(r => r.fields.status?.trim().toLowerCase() === 'blocked');
    if (isBlocked) {
      console.warn('[WARN][changeReservation] Attempt to change to a blocked slot');
      return {
        status: 409,
        body: {
          type: 'reservation.unavailable',
          available: false,
          reason: 'blocked',
          date: normalizedDate,
          timeSlot: normalizedTime,
          alternatives: null,
          restaurantId
        }
      };
    }

    // 🔹 Filter out blocked, past, or beyond cutoff reservations (count ALL non-blocked as occupied)
    const validReservations = allForDate.filter(r => {
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

    console.log('[DEBUG][changeReservation] Total reservations fetched:', allForDate.length);
    console.log('[DEBUG][changeReservation] Valid reservations after filtering:', validReservations.length);

    const sameSlot = validReservations.filter(r => r.fields.timeSlot?.trim() === normalizedTime);
    const occupiedCount = sameSlot.filter(r => r.fields.status?.toLowerCase() !== 'blocked').length;

    if (occupiedCount >= maxReservations) {
      const findNextAvailableSlots = (target, maxSteps = 96) => {
        let before = null;
        let after = null;

        const isAvailable = (timeStr) => {
          const entries = validReservations.filter(r => r.fields.timeSlot?.trim() === timeStr);
          const occupied = entries.filter(r => r.fields.status?.toLowerCase() !== 'blocked').length;
          return occupied < maxReservations;
        };

        let forward = target;
        let backward = target;

        for (let i = 1; i <= maxSteps; i++) {
          forward = forward.plus({ minutes: 15 });
          if (!after && isAvailable(forward.toFormat('HH:mm'))) {
            after = forward.toFormat('HH:mm');
          }
          backward = backward.minus({ minutes: 15 });
          if (!before && isAvailable(backward.toFormat('HH:mm'))) {
            before = backward.toFormat('HH:mm');
          }
          if (before && after) break;
        }
        return { before, after };
      };

      const alternatives = findNextAvailableSlots(targetDateTime);
      return {
        status: 409,
        body: {
          type: 'reservation.unavailable',
          available: false,
          reason: 'full',
          remaining: Math.max(0, maxReservations - occupiedCount),
          date: normalizedDate,
          timeSlot: normalizedTime,
          alternatives,
          restaurantId
        }
      };
    }

    // Update reservation
    await airtable(tableName).update(match[0].id, {
      date: normalizedDate,
      timeSlot: normalizedTime,
      restaurantId
    });

    await sendConfirmationEmail({ type: 'change', confirmationCode: normalizedCode, config });

    return {
      status: 200,
      body: {
        type: 'reservation.changed',
        confirmationCode: normalizedCode,
        newDate: normalizedDate,
        newTimeSlot: normalizedTime,
        restaurantId
      }
    };
  } catch (err) {
    console.error('[ERROR][changeReservation] Unexpected failure:', err);
    return {
      status: 500,
      body: { type: 'reservation.change.error', error: 'internal_error' }
    };
  }
};
