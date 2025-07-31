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
      body: {
        type: 'reservation.change.error',
        error: 'missing_restaurant_id'
      }
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
      body: {
        type: 'reservation.change.error',
        error: 'config_not_found'
      }
    };
  }

  const { baseId, tableName, maxReservations, timeZone, futureCutoff } = config;
  const airtable = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(baseId);

  // Parse target date/time with enforced normalization for debugging
  const targetDateTime = parseDateTime(normalizedDate, normalizedTime, timeZone);
  console.log('[DEBUG][changeReservation] Requested change to:', targetDateTime?.toISO() || 'Invalid');
  console.log('[DEBUG][changeReservation] Using timezone:', timeZone);

  // ✅ Guardrail: Prevent changing to a past date/time
  if (isPast(normalizedDate, normalizedTime, timeZone)) {
    console.warn('[WARN][changeReservation] Attempt to change to a past date/time');
    return {
      status: 400,
      body: {
        type: 'reservation.change.error',
        error: 'cannot_change_to_past'
      }
    };
  }

  // ✅ Guardrail: Prevent changing to a date beyond futureCutoff
  const now = getCurrentDateTime(timeZone).startOf('day'); 
  const cutoffDate = now.plus({ days: futureCutoff }).endOf('day');
  if (targetDateTime > cutoffDate) {
    console.warn('[WARN][changeReservation] Attempt to change beyond futureCutoff');
    return {
      status: 400,
      body: {
        type: 'reservation.change.error',
        error: 'outside_reservation_window'
      }
    };
  }

  try {
    // 🔄 Filter by confirmationCode **and** restaurantId
    const match = await airtable(tableName)
      .select({
        filterByFormula: `AND({rawConfirmationCode} = '${normalizedCode}', {restaurantId} = '${restaurantId}')`,
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

    // 🔄 Filter by date **and** restaurantId
    const allForDate = await airtable(tableName)
      .select({
        filterByFormula: `AND({dateFormatted} = '${normalizedDate}', {restaurantId} = '${restaurantId}')`,
      })
      .all();

    // 🔹 PRE-FILTER: remove blocked/past/future-cutoff
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
    const isBlocked = sameSlot.some(r => r.fields.status?.toLowerCase() === 'blocked');
    const confirmedCount = sameSlot.filter(r => r.fields.status?.toLowerCase() === 'confirmed').length;

    if (isBlocked || confirmedCount >= maxReservations) {
      if (!targetDateTime) {
        return {
          status: 400,
          body: {
            type: 'reservation.change.error',
            error: 'invalid_date_or_time'
          }
        };
      }

      const findNextAvailableSlots = (target, maxSteps = 96) => {
        let before = null;
        let after = null;

        const isAvailable = (timeStr) => {
          const entries = validReservations.filter(r => r.fields.timeSlot?.trim() === timeStr);
          const confirmed = entries.filter(r => r.fields.status?.toLowerCase() === 'confirmed').length;
          return confirmed < maxReservations;
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
          reason: isBlocked ? 'blocked' : 'full',
          remaining: Math.max(0, maxReservations - confirmedCount),
          date: normalizedDate,
          timeSlot: normalizedTime,
          alternatives,
          restaurantId // <-- include in response
        }
      };
    }

    // 🔄 Update with new date/time AND ensure restaurantId is written
    await airtable(tableName).update(match[0].id, {
      date: normalizedDate,
      timeSlot: normalizedTime,
      restaurantId // <-- ensure it’s on the record
    });

    // ✅ Trigger confirmation email for update
    await sendConfirmationEmail({
      type: 'change',
      confirmationCode: normalizedCode,
      config
    });

    return {
      status: 200,
      body: {
        type: 'reservation.changed',
        confirmationCode: normalizedCode,
        newDate: normalizedDate,
        newTimeSlot: normalizedTime,
        restaurantId // <-- include for context
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
