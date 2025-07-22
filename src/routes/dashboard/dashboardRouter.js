import express from 'express';
import { getReservations } from '../../utils/dashboard/getReservations.js';
import { updateReservations } from '../../utils/dashboard/updateReservations.js';
import { dashboardConfig } from '../../utils/dashboard/dashboardConfig.js';

export const dashboardRouter = express.Router();

// ✅ GET /api/dashboard/:restaurantId/reservations
dashboardRouter.get('/:restaurantId/reservations', async (req, res) => {
  console.log('[DEBUG] dashboardRouter GET /reservations called');

  const { restaurantId } = req.params;
  if (!restaurantId) {
    console.error('[ERROR] Missing restaurantId in URL');
    return res.status(400).json({ error: 'Missing restaurantId in URL' });
  }

  try {
    const reservations = await getReservations(restaurantId);
    return res.status(200).json({ reservations });
  } catch (err) {
    console.error('[ERROR] Failed to get reservations:', err.message);
    return res.status(500).json({ error: 'Failed to fetch reservations' });
  }
});

// ✅ POST /api/dashboard/:restaurantId/updateReservation
dashboardRouter.post('/:restaurantId/updateReservation', async (req, res) => {
  console.log('[DEBUG] dashboardRouter POST /updateReservation called');

  const { restaurantId } = req.params;
  const updates = req.body;

  if (!restaurantId) {
    return res.status(400).json({ error: 'Missing restaurantId in URL' });
  }

  if (!updates || !Array.isArray(updates)) {
    return res.status(400).json({ error: 'Invalid or missing update data' });
  }

  try {
    const result = await updateReservations(restaurantId, updates);
    return res.status(200).json({ success: true, updated: result });
  } catch (err) {
    console.error('[ERROR] Failed to update reservations:', err.message);
    return res.status(500).json({ error: 'Failed to update reservations' });
  }
});
