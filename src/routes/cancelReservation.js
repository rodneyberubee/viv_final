import Airtable from 'airtable';
import { loadRestaurantConfig } from '../utils/loadConfig.js';
import { sendConfirmationEmail } from '../utils/sendConfirmationEmail.js';

export const cancelReservation = async (req) => {
  const { restaurantId } = req.params;
  const { confirmationCode } = req.body;

  if (!confirmationCode) {
    console.error('[ERROR] Missing confirmation code in body.');
    return {
      status: 400,
      body: {
        type: 'reservation.error',
        error: 'missing_confirmation_code',
        restaurantId
      }
    };
  }

  const config = await loadRestaurantConfig(restaurantId);
  if (!config) {
    console.error('[ERROR] No config found for restaurantId:', restaurantId);
    return {
      status: 404,
      body: {
        type: 'reservation.error',
        error: 'config_not_found',
        restaurantId
      }
    };
  }

  const { baseId, tableName } = config;
  const airtable = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(baseId);

  try {
    // 🔄 Add restaurantId to ensure only the correct restaurant's reservations are canceled
    const formula = `AND({rawConfirmationCode} = '${confirmationCode}', {restaurantId} = '${restaurantId}')`;

    const records = await airtable(tableName)
      .select({
        filterByFormula: formula,
        fields: ['name', 'date', 'timeSlot', 'status']
      })
      .all();

    if (records.length === 0) {
      console.warn('[WARN] No reservation found for confirmationCode:', confirmationCode);
      return {
        status: 404,
        body: {
          type: 'reservation.error',
          error: 'not_found',
          confirmationCode,
          restaurantId
        }
      };
    }

    const reservation = records[0];

    await airtable(tableName).destroy(reservation.id);

    // ✅ Trigger cancellation email
    await sendConfirmationEmail({
      type: 'cancel',
      confirmationCode,
      config
    });

    return {
      status: 200,
      body: {
        type: 'reservation.cancel', // <-- standardized for frontend broadcast
        confirmationCode,
        restaurantId,
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
      body: {
        type: 'reservation.error',
        error: 'internal_error',
        restaurantId
      }
    };
  }
};
