import express from 'express';
import { getReservations } from '../../utils/dashboard/getReservations.js';
import { updateReservations } from '../../utils/dashboard/updateReservations.js';
import { dashboardConfig } from '../../utils/dashboard/dashboardConfig.js';
import { getAirtableBase } from '../../utils/dashboard/airtableHelpers.js';
import { requireAuth } from '../../../middleware/requireAuth.js'; // ✅ Fixed path (middleware is adjacent to src)

export const dashboardRouter = express.Router();

// ✅ Protect all dashboard routes
dashboardRouter.use(requireAuth);

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
    console.error('[ERROR] Failed to get reservations:', err);
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
    console.error('[ERROR] Failed to update reservations:', err);
    return res.status(500).json({ error: 'Failed to update reservations' });
  }
});

// ✅ GET /api/dashboard/:restaurantId/config
dashboardRouter.get('/:restaurantId/config', async (req, res) => {
  console.log('[DEBUG] dashboardRouter GET /config called');
  const { restaurantId } = req.params;

  if (!restaurantId) {
    return res.status(400).json({ error: 'Missing restaurantId in URL' });
  }

  try {
    const config = await dashboardConfig(restaurantId);
    if (!config) {
      return res.status(404).json({ error: 'Config not found' });
    }
    return res.status(200).json(config);
  } catch (err) {
    console.error('[ERROR] Failed to load config:', err);
    return res.status(500).json({ error: 'Failed to fetch config' });
  }
});

// ✅ POST /api/dashboard/:restaurantId/updateConfig
dashboardRouter.post('/:restaurantId/updateConfig', async (req, res) => {
  console.log('[DEBUG] dashboardRouter POST /updateConfig called');
  const { restaurantId } = req.params;
  const updates = req.body;

  if (!restaurantId) {
    return res.status(400).json({ error: 'Missing restaurantId in URL' });
  }

  try {
    const base = getAirtableBase(process.env.MASTER_BASE_ID);
    const formula = `{restaurantId} = "${restaurantId}"`;

    const records = await base('restaurantMap').select({ filterByFormula: formula }).firstPage();
    if (!records.length) {
      return res.status(404).json({ error: 'No matching config found' });
    }

    const result = await base('restaurantMap').update(records[0].id, updates);
    console.log('[DEBUG] Config update result ID:', result.id);

    return res.status(200).json({ success: true, updated: result });
  } catch (err) {
    console.error('[ERROR] Failed to update config:', err);
    return res.status(500).json({ error: 'Failed to update config' });
  }
});
