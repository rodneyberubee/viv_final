import Airtable from 'airtable';
import dayjs from 'dayjs';
import { loadRestaurantConfig } from '../utils/loadConfig.js';

export const changeReservation = async (req, res) => {
  console.log('[DEBUG][changeReservation] Route hit');

  const { restaurantId } = req.params;
  if (!restaurantId) {
    console.error('[ERROR] restaurantId is missing from req.body');
    return res.status(400).json({
      type: 'reservation.change.error',
      error: 'missing_restaurant_id'
    });
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
    return res.status(400).json({
      type: 'reservation.change.error',
      error: 'missing_required_fields'
    });
  }

  const config = await loadRestaurantConfig(restaurantId);
  if (!config) {
    console.error('[ERROR][changeReservation] Config not found for:', restaurantId);
    return res.status(404).json({
      type: 'reservation.change.error',
      error: 'config_not_found'
    });
  }

  const { baseId, tableName, maxReservations } = config;
  console.log('[DEBUG][changeReservation] Loaded config:', config);

  const airtable = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(baseId);

  try {
    const match = await airtable(tableName)
      .select({
        filterByFormula: `{rawConfirmationCode} = '${normalizedCode}'`,
      })
      .firstPage();

    if (match.length === 0) {
      console.warn('[WARN][changeReservation] No matching reservation for code:', normalizedCode);
      return res.status(404).json({
        type: 'reservation.change.not_found',
        confirmationCode: normalizedCode
      });
    }

    const allForDate = await airtable(tableName)
      .select({
        filterByFormula: `{dateFormatted} = '${normalizedDate}'`,
      })
      .all();

    const sameSlot = allForDate.filter(r => r.fields.timeSlot?.trim() === normalizedTime);
    const isBlocked = sameSlot.some(r => r.fields.status?.toLowerCase() === 'blocked');
    const confirmedCount = sameSlot.filter(r => r.fields.status?.toLowerCase() === 'confirmed').length;

    if (isBlocked || confirmedCount >= maxReservations) {
      const centerTime = dayjs(`${normalizedDate}T${normalizedTime}`);

      const findNextAvailableSlots = (target, maxSteps = 96) => {
        const results = new Set();
        let forward = target.clone();
        let backward = target.clone();

        const isAvailable = (timeStr) => {
          const entries = allForDate.filter(r => r.fields.timeSlot?.trim() === timeStr);
          const blocked = entries.some(r => r.fields.status?.toLowerCase() === 'blocked');
          const confirmed = entries.filter(r => r.fields.status?.toLowerCase() === 'confirmed').length;
          return !blocked && confirmed < maxReservations;
        };

        for (let i = 1; i <= maxSteps; i++) {
          forward = forward.add(15, 'minute');
          backward = backward.subtract(15, 'minute');

          const forwardStr = forward.format('HH:mm');
          const backwardStr = backward.format('HH:mm');

          if (isAvailable(forwardStr)) results.add(forwardStr);
          if (isAvailable(backwardStr)) results.add(backwardStr);

          if (results.size >= 2) break;
        }

        return Array.from(results);
      };

      const alternatives = findNextAvailableSlots(centerTime);

      return res.status(409).json({
        type: 'reservation.change.unavailable',
        error: isBlocked ? 'blocked' : 'full',
        alternatives,
        date: normalizedDate,
        timeSlot: normalizedTime
      });
    }

    await airtable(tableName).update(match[0].id, {
      date: normalizedDate,
      timeSlot: normalizedTime,
    });

    console.log('[DEBUG][changeReservation] Reservation updated successfully');
    return res.status(200).json({
      type: 'reservation.change.success',
      confirmationCode: normalizedCode,
      newDate: normalizedDate,
      newTimeSlot: normalizedTime
    });

  } catch (err) {
    console.error('[ERROR][changeReservation] Unexpected failure:', err);
    return res.status(500).json({
      type: 'reservation.change.error',
      error: 'internal_error'
    });
  }
};
