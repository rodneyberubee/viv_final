import { loadRestaurantConfig } from '../../utils/loadConfig.js';
import { updateRecord } from '../../utils/airtableHelpers.js';

export const updateReservation = async (req, res) => {
  console.log('[DEBUG] updateReservation called');

  const { restaurantId } = req.params;
  if (!restaurantId) {
    console.error('[ERROR] restaurantId missing from req.params');
    return res.status(400).json({ error: 'Missing restaurantId in URL.' });
  }

  const { recordId, fields } = req.body;
  if (!recordId || !fields || typeof fields !== 'object') {
    console.error('[ERROR] Invalid payload. Must include recordId and fields object.');
    return res.status(400).json({ error: 'Invalid request. Must include recordId and fields.' });
  }

  console.log('[DEBUG] restaurantId:', restaurantId);
  console.log('[DEBUG] Incoming fields:', fields);

  const config = await loadRestaurantConfig(restaurantId);
  if (!config) {
    return res.status(404).json({ error: 'Restaurant config not found.' });
  }

  try {
    const updated = await updateRecord(config.baseId, config.tableName, recordId, fields);
    console.log('[DEBUG] Updated reservation:', updated?.id);
    return res.status(200).json({ success: true, updated });
  } catch (error) {
    console.error('[ERROR] Failed to update reservation:', error.message);
    return res.status(500).json({ error: 'Failed to update reservation.' });
  }
};

