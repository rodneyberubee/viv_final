import Airtable from 'airtable';
import { loadRestaurantConfig } from '../utils/loadConfig.js';

export const cancelReservation = async (req) => {
  console.log('[DEBUG][cancelReservation] called');

  const { restaurantId } = req.params;
  console.log('[DEBUG] restaurantId:', restaurantId);

  const { confirmationCode } = req.body;
  console.log('[DEBUG] confirmationCode:', confirmationCode);

  if (!confirmationCode) {
    console.error('[ERROR] Missing confirmation code in body.');
    return {
      status: 400,
      body: {
        type: 'reservation.cancel.error',
        error: 'missing_confirmation_code'
      }
    };
  }

  const config = await loadRestaurantConfig(restaurantId);
  if (!config) {
    console.error('[ERROR] No config found for restaurantId:', restaurantId);
    return {
      status: 404,
      body: {
        type: 'reservation.cancel.error',
        error: 'config_not_found'
      }
    };
  }

  const { baseId, tableName } = config;
  console.log('[DEBUG] Loaded config:', config);

  const airtable = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(baseId);

  try {
    const formula = `{rawConfirmationCode} = '${confirmationCode}'`;
    console.log('[DEBUG] Airtable filter formula:', formula);

    const records = await airtable(tableName)
      .select({
        filterByFormula: formula,
        fields: ['name', 'date', 'timeSlot', 'status']
      })
      .all();

    console.log('[DEBUG] Matching records found:', records.length);

    if (records.length === 0) {
      console.warn('[WARN] No reservation found for confirmationCode:', confirmationCode);
      return {
        status: 404,
        body: {
          type: 'reservation.cancel.not_found',
          confirmationCode
        }
      };
    }

    const reservation = records[0];
    console.log('[DEBUG] Reservation details:', reservation.fields);

    await airtable(tableName).destroy(reservation.id);
    console.log('[DEBUG] Deleted record ID:', reservation.id);

    return {
      status: 200,
      body: {
        type: 'reservation.cancelled', // ✅ Standardized type
        confirmationCode,
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
        type: 'reservation.cancel.error',
        error: 'internal_error'
      }
    };
  }
};
