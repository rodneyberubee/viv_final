import express from 'express';
import { getReservations } from '../../utils/getReservations.js';
import { updateReservations } from '../../utils/updateReservations.js';
import { loadConfig } from '../../utils/loadConfig.js';

export const dashboardRouter = express.Router();

dashboardRouter.get('/:restaurantId', async (req, res) => {
  console.log('[DEBUG] GET /api/dashboard/:restaurantId called');
  const { restaurantId } = req.params;

  if (!restaurantId) {
    console.error('[ERROR] Missing restaurantId in req.params');
    return res.status(400).json({ error: 'Missing restaurantId in URL.' });
  }

  try {
    const config = await loadConfig(restaurantId);
    if (!config) {
      return res.status(404).json({ error: 'Restaurant config not found.' });
    }

    const reservations = await getReservations(config);
    return res.status(200).json({ config, reservations });
  } catch (error) {
    console.error('[ERROR] Failed to fetch dashboard data:', error);
    return res.status(500).json({ error: 'Failed to load dashboard data.' });
  }
});

dashboardRouter.post('/:restaurantId', async (req, res) => {
  console.log('[DEBUG] POST /api/dashboard/:restaurantId called');
  const { restaurantId } = req.params;
  const updatePayload = req.body;

  if (!restaurantId) {
    console.error('[ERROR] Missing restaurantId in req.params');
    return res.status(400).json({ error: 'Missing restaurantId in URL.' });
  }

  try {
    const config = await loadConfig(restaurantId);
    if (!config) {
      return res.status(404).json({ error: 'Restaurant config not found.' });
    }

    const result = await updateReservations(config, updatePayload);
    return res.status(200).json({ success: true, result });
  } catch (error) {
    console.error('[ERROR] Failed to update dashboard data:', error);
    return res.status(500).json({ error: 'Failed to update dashboard data.' });
  }
});

