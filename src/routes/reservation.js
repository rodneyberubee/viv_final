import Airtable from 'airtable';
import dayjs from 'dayjs';
import { loadRestaurantConfig } from '../utils/loadConfig.js';

const airtableClient = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY });

export const createReservation = async (parsed, config) => {
  const { name, partySize, contactInfo, date, timeSlot } = parsed;
  const { baseId, tableName } = config;

  const base = airtableClient.base(baseId);
  const confirmationCode = Math.random().toString(36).substr(2, 9);

  const fields = {
    name,
    partySize,
    contactInfo,
    date,
    timeSlot,
    rawConfirmationCode: confirmationCode,
    status: 'confirmed'
  };

  console.log('[DEBUG] Writing to Airtable:', fields);
  await base(tableName).create([{ fields }]);
  return { confirmationCode };
};

export const reservation = async (req, res, autoRespond = true) => {
  const { restaurantId } = req.params;
  console.log('[DEBUG] restaurantId from req.body:', restaurantId);
  console.log('[DEBUG] Full req.body:', req.body);

  let parsed = req.body;

  if (typeof parsed.userMessage === 'string') {
    try {
      const fallback = JSON.parse(parsed.userMessage);
      parsed = { ...fallback, restaurantId: parsed.restaurantId, route: parsed.route };
    } catch (e) {
      const error = {
        type: 'reservation.error',
        error: 'invalid_json_in_userMessage'
      };
      return autoRespond ? res.status(400).json(error) : { status: 400, body: error };
    }
  }

  const { name, partySize, contactInfo, date, timeSlot } = parsed;

  const missing = [];
  if (!name) missing.push('name');
  if (!partySize) missing.push('partySize');
  if (!contactInfo) missing.push('contactInfo');
  if (!date) missing.push('date');
  if (!timeSlot) missing.push('timeSlot');

  if (missing.length > 0) {
    const error = {
      type: 'reservation.error',
      error: 'missing_required_fields',
      missing
    };
    console.warn('[DEBUG] Missing required field(s):', missing);
    return autoRespond ? res.status(400).json(error) : { status: 400, body: error };
  }

  try {
    const config = await loadRestaurantConfig(restaurantId);
    if (!config) {
      const error = {
        type: 'reservation.error',
        error: 'config_not_found'
      };
      console.error('[DEBUG] No config found for restaurantId:', restaurantId);
      return autoRespond ? res.status(404).json(error) : { status: 404, body: error };
    }

    const { baseId, tableName, maxReservations, futureCutoff } = config;
    const base = airtableClient.base(baseId);

    const now = dayjs();
    const reservationTime = dayjs(`${date}T${timeSlot}`);

    if (reservationTime.isAfter(now.add(futureCutoff, 'day'))) {
      const error = {
        type: 'reservation.error',
        error: 'outside_reservation_window'
      };
      return autoRespond ? res.status(400).json(error) : { status: 400, body: error };
    }

    if (reservationTime.isBefore(now)) {
      const error = {
        type: 'reservation.error',
        error: 'time_already_passed'
      };
      return autoRespond ? res.status(400).json(error) : { status: 400, body: error };
    }

    const normalizedDate = date.trim();
    const normalizedTime = timeSlot.toString().trim();

    const reservations = await base(tableName)
      .select({
        filterByFormula: `{dateFormatted} = '${normalizedDate}'`,
        fields: ['status', 'timeSlot']
      })
      .all();

    const sameSlot = reservations.filter(r => r.fields.timeSlot?.trim() === normalizedTime);
    const blocked = sameSlot.filter(r => r.fields.status?.trim().toLowerCase() === 'blocked');
    const confirmedCount = sameSlot.filter(r => r.fields.status?.trim().toLowerCase() === 'confirmed');

    const isSlotAvailable = (time) => {
      const matching = reservations.filter(r => r.fields.timeSlot?.trim() === time);
      const isBlocked = matching.some(r => r.fields.status?.trim().toLowerCase() === 'blocked');
      const confirmed = matching.filter(r => r.fields.status?.trim().toLowerCase() === 'confirmed');
      return !isBlocked && confirmed.length < maxReservations;
    };

    const findNextAvailableSlots = (centerTime, maxSteps = 96) => {
      const results = [];
      let forward = centerTime;
      let backward = centerTime;

      for (let i = 1; i <= maxSteps; i++) {
        forward = forward.add(15, 'minute');
        if (isSlotAvailable(forward.format('HH:mm'))) {
          results.push(forward.format('HH:mm'));
          break;
        }
      }

      for (let i = 1; i <= maxSteps; i++) {
        backward = backward.subtract(15, 'minute');
        if (isSlotAvailable(backward.format('HH:mm'))) {
          results.push(backward.format('HH:mm'));
          break;
        }
      }

      return [...new Set(results)];
    };

    if (blocked.length > 0 || confirmedCount.length >= maxReservations) {
      const payload = {
        type: 'reservation.error',
        error: blocked.length > 0 ? 'time_blocked' : 'slot_full',
        alternatives: findNextAvailableSlots(reservationTime)
      };
      return autoRespond ? res.status(409).json(payload) : { status: 409, body: payload };
    }

    const { confirmationCode } = await createReservation(parsed, config);

    const payload = {
      type: 'reservation.complete',
      confirmationCode,
      name: parsed.name,
      partySize: parsed.partySize,
      timeSlot: parsed.timeSlot,
      date: parsed.date
    };

    return autoRespond ? res.status(201).json(payload) : { status: 201, body: payload };
  } catch (err) {
    console.error('[ROUTE][reservation] Error caught:', err);
    const error = {
      type: 'reservation.error',
      error: 'internal_server_error'
    };
    return autoRespond ? res.status(500).json(error) : { status: 500, body: error };
  }
};
