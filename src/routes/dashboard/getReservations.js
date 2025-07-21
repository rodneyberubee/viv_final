import { loadRestaurantConfig } from '../../utils/loadConfig.js';
import { fetchRecords } from '../../utils/airtableHelpers.js';

export const getReservation = async (req, res) => {
  console.log('[DEBUG] getReservation called');

  const { restaurantId } = req.params;
  if (!restaurantId) {
    console.error('[ERROR] restaurantId missing from req.params');
    return res.status(400).json({ error: 'Missing restaurantId in URL.' });
  }

  console.log('[DEBUG] restaurantId:', restaurantId);

  const config = await loadRestaurantConfig(restaurantId);
  if (!config) {
    return res.status(404).json({ error: 'Restaurant config not found.' });
  }

  try {
    const records = await fetchRecords(config.baseId, config.tableName);
    const reservations = records.map((record) => ({
      id: record.id,
      ...record.fields,
    }));

    console.log('[DEBUG] Airtable result:', reservations.length, 'records');
    return res.status(200).json({ reservations });
  } catch (error) {
    console.error('[ERROR] Failed to fetch reservations:', error.message);
    return res.status(500).json({ error: 'Failed to fetch reservations.' });
  }
};

