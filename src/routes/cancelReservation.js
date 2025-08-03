import Airtable from 'airtable';
import { loadRestaurantConfig } from '../utils/loadConfig.js';
import { sendConfirmationEmail } from '../utils/sendConfirmationEmail.js';
import { BroadcastChannel } from 'broadcast-channel'; // NEW

// Helper: Broadcast updates to dashboard
const broadcastReservationUpdate = async (type, restaurantId) => {
  try {
    const bc = new BroadcastChannel('reservations');
    await bc.postMessage({ type, restaurantId, timestamp: Date.now() });
    await bc.close();
  } catch (err) {
    console.error('[Broadcast] Failed to send update:', err);
  }
};

export const cancelReservation = async (req) => {
  const { restaurantId } = req.params;
  let confirmationCode =
    typeof req.body.confirmationCode === 'string'
      ? req.body.confirmationCode.trim()
      : req.body.confirmationCode || null;

  if (confirmationCode) confirmationCode = confirmationCode.toLowerCase();

  if (!confirmationCode) {
    console.error('[ERROR] Missing confirmation code in body.');
    return {
      status: 400,
      body: { type: 'reservation.error', error: 'missing_confirmation_code', restaurantId }
    };
  }

  const config = await loadRestaurantConfig(restaurantId);
  if (!config) {
    console.error('[ERROR] No config found for restaurantId:', restaurantId);
    return {
      status: 404,
      body: { type: 'reservation.error', error: 'config_not_found', restaurantId }
    };
  }

  const { baseId, tableName } = config;
  const airtable = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(baseId);

  try {
    // Strict lookup: confirmationCode + restaurantId
    const formula = `AND(LOWER({rawConfirmationCode}) = '${confirmationCode}', {restaurantId} = '${restaurantId}')`;
    const records = await airtable(tableName)
      .select({ filterByFormula: formula, fields: ['name', 'date', 'timeSlot', 'status'] })
      .all();

    if (records.length === 0) {
      console.warn('[WARN] No reservation found for confirmationCode:', confirmationCode);
      return {
        status: 404,
        body: { type: 'reservation.error', error: 'not_found', confirmationCode, restaurantId }
      };
    }

    const reservation = records[0];
    const currentStatus = reservation.fields.status?.trim().toLowerCase();

    // Guard against re-canceling or deleting blocked reservations
    if (currentStatus === 'canceled') {
      console.warn('[WARN] Attempted to cancel an already canceled reservation:', confirmationCode);
      return {
        status: 409,
        body: { type: 'reservation.error', error: 'already_canceled', confirmationCode, restaurantId }
      };
    }

    if (currentStatus === 'blocked') {
      console.warn('[WARN] Attempted to cancel a blocked slot:', confirmationCode);
      return {
        status: 409,
        body: { type: 'reservation.error', error: 'cannot_cancel_blocked_slot', confirmationCode, restaurantId }
      };
    }

    // Soft cancel: mark as canceled instead of deleting
    await airtable(tableName).update(reservation.id, { status: 'canceled' });

    await sendConfirmationEmail({ type: 'cancel', confirmationCode, config }).catch(err =>
      console.error('[WARN] Failed to send cancellation email:', err)
    );

    await broadcastReservationUpdate('reservation.cancel', restaurantId); // notify dashboards

    return {
      status: 200,
      body: {
        type: 'reservation.cancel',
        confirmationCode,
        restaurantId: config.restaurantId,
        canceledReservation: {
          name: reservation.fields.name,
          date: reservation.fields.date,
          timeSlot: reservation.fields.timeSlot
        }
      }
    };
  } catch (err) {
    console.error('[ERROR][cancelReservation]', err);
    return {
      status: 500,
      body: { type: 'reservation.error', error: 'internal_error', restaurantId }
    };
  }
};
