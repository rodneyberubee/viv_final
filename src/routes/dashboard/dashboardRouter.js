import express from 'express';
import { getReservations } from '../../utils/dashboard/getReservations.js';
import { updateReservations } from '../../utils/dashboard/updateReservations.js';
import { dashboardConfig } from '../../utils/dashboard/dashboardConfig.js';
import { getAirtableBase } from '../../utils/dashboard/airtableHelpers.js';
import { requireAuth } from '../../../middleware/requireAuth.js'; // ✅ Auth middleware

export const dashboardRouter = express.Router();

// In-memory store for refresh flags
const refreshFlags = {}; // { restaurantId: 0 or 1 }

// Helper to set refresh flag (can be called by other modules)
export const setRefreshFlag = (restaurantId) => {
  refreshFlags[restaurantId] = 1;
  console.log(`[DEBUG] Refresh flag set for ${restaurantId}`);
};

// ✅ Protect all dashboard routes
dashboardRouter.use(requireAuth);

// Helper to enforce restaurantId match
const enforceRestaurantAccess = (req, res) => {
  const { restaurantId } = req.params;
  if (!restaurantId) {
    res.status(400).json({ error: 'Missing restaurantId in URL' });
    return null;
  }
  if (req.user.restaurantId !== restaurantId) {
    console.warn(`[AUTH] Forbidden access attempt by ${req.user.email} for ${restaurantId}`);
    res.status(403).json({ error: 'forbidden' });
    return null;
  }
  return restaurantId;
};

// ✅ GET /api/dashboard/:restaurantId/reservations
dashboardRouter.get('/:restaurantId/reservations', async (req, res) => {
  console.log('[DEBUG] dashboardRouter GET /reservations called');
  const restaurantId = enforceRestaurantAccess(req, res);
  if (!restaurantId) return;

  try {
    const reservations = await getReservations(restaurantId);
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ reservations, user: req.user });
  } catch (err) {
    console.error('[ERROR] Failed to get reservations:', err);
    return res.status(500).json({ error: 'Failed to fetch reservations' });
  }
});

// ✅ POST /api/dashboard/:restaurantId/updateReservation
dashboardRouter.post('/:restaurantId/updateReservation', async (req, res) => {
  console.log('[DEBUG] dashboardRouter POST /updateReservation called');
  const restaurantId = enforceRestaurantAccess(req, res);
  if (!restaurantId) return;

  const updates = req.body;
  if (!updates || !Array.isArray(updates)) {
    return res.status(400).json({ error: 'Invalid or missing update data' });
  }

  try {
    const result = await updateReservations(restaurantId, updates);
    setRefreshFlag(restaurantId); // <-- Trigger refresh flag
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ success: true, updated: result });
  } catch (err) {
    console.error('[ERROR] Failed to update reservations:', err);
    return res.status(500).json({ error: 'Failed to update reservations' });
  }
});

// ✅ GET /api/dashboard/:restaurantId/config
dashboardRouter.get('/:restaurantId/config', async (req, res) => {
  console.log('[DEBUG] dashboardRouter GET /config called');
  const restaurantId = enforceRestaurantAccess(req, res);
  if (!restaurantId) return;

  try {
    const config = await dashboardConfig(restaurantId);
    if (!config) {
      return res.status(404).json({ error: 'Config not found' });
    }
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ config, user: req.user });
  } catch (err) {
    console.error('[ERROR] Failed to load config:', err);
    return res.status(500).json({ error: 'Failed to fetch config' });
  }
});

// ✅ POST /api/dashboard/:restaurantId/updateConfig
dashboardRouter.post('/:restaurantId/updateConfig', async (req, res) => {
  console.log('[DEBUG] dashboardRouter POST /updateConfig called');
  const restaurantId = enforceRestaurantAccess(req, res);
  if (!restaurantId) return;

  const updates = req.body;

  try {
    const base = getAirtableBase(process.env.MASTER_BASE_ID);
    const formula = `{restaurantId} = "${restaurantId}"`;

    const records = await base('restaurantMap').select({ filterByFormula: formula }).firstPage();
    if (!records.length) {
      return res.status(404).json({ error: 'No matching config found' });
    }

    const result = await base('restaurantMap').update(records[0].id, updates);
    setRefreshFlag(restaurantId); // <-- Trigger refresh flag
    console.log('[DEBUG] Config update result ID:', result.id);
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ success: true, updated: result });
  } catch (err) {
    console.error('[ERROR] Failed to update config:', err);
    return res.status(500).json({ error: 'Failed to update config' });
  }
});

// ✅ GET /api/dashboard/:restaurantId/refreshFlag
dashboardRouter.get('/:restaurantId/refreshFlag', async (req, res) => {
  console.log('[DEBUG] dashboardRouter GET /refreshFlag called');
  const restaurantId = enforceRestaurantAccess(req, res);
  if (!restaurantId) return;

  const flag = refreshFlags[restaurantId] || 0;
  refreshFlags[restaurantId] = 0; // Reset after read
  return res.status(200).json({ refresh: flag });
});
