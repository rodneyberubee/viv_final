import express from 'express';
import { getReservations } from '../../utils/dashboard/getReservations.js';
import { updateReservations } from '../../utils/dashboard/updateReservations.js';
import { dashboardConfig } from '../../utils/dashboard/dashboardConfig.js';
import { getAirtableBase } from '../../utils/dashboard/airtableHelpers.js';
import { requireAuth } from '../../../middleware/requireAuth.js';
import { DateTime } from 'luxon';

export const dashboardRouter = express.Router();

const refreshFlags = {}; // { restaurantId: 0 or 1 }
export const setRefreshFlag = (restaurantId) => {
  refreshFlags[restaurantId] = 1;
  console.log(`[DEBUG] Refresh flag set for ${restaurantId}`);
};

const enforceRestaurantAccess = (req, res) => {
  const { restaurantId } = req.params;
  if (!restaurantId) {
    res.status(400).json({ error: 'Missing restaurantId in URL' });
    return null;
  }
  if (restaurantId === 'mollyscafe1') {
    return restaurantId; // public demo
  }
  if (req.user?.restaurantId !== restaurantId) {
    console.warn(`[AUTH] Forbidden access attempt by ${req.user?.email || 'unknown'} for ${restaurantId}`);
    res.status(403).json({ error: 'forbidden' });
    return null;
  }
  return restaurantId;
};

const normalizeTime = (value) => {
  if (!value || typeof value !== 'string') return null;
  let dt = DateTime.fromFormat(value.trim(), 'H:mm');
  if (!dt.isValid) dt = DateTime.fromFormat(value.trim(), 'h:mm a');
  if (!dt.isValid) return null;
  return dt.toFormat('HH:mm');
};

// Middleware for per-route auth
const authIfNotPublic = async (req, res, next) => {
  if (req.params.restaurantId === 'mollyscafe1') {
    console.log('[AUTH] Public demo access granted for mollyscafe1');
    return next();
  }
  return requireAuth(req, res, next);
};

// GET reservations
dashboardRouter.get('/:restaurantId/reservations', authIfNotPublic, async (req, res) => {
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

// POST updateReservation
dashboardRouter.post('/:restaurantId/updateReservation', authIfNotPublic, async (req, res) => {
  const restaurantId = enforceRestaurantAccess(req, res);
  if (!restaurantId) return;
  const updates = req.body;
  if (!updates || !Array.isArray(updates)) {
    return res.status(400).json({ error: 'Invalid or missing update data' });
  }
  try {
    const result = await updateReservations(restaurantId, updates);
    setRefreshFlag(restaurantId);
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ success: true, updated: result });
  } catch (err) {
    console.error('[ERROR] Failed to update reservations:', err);
    return res.status(500).json({ error: 'Failed to update reservations' });
  }
});

// GET config
dashboardRouter.get('/:restaurantId/config', authIfNotPublic, async (req, res) => {
  const restaurantId = enforceRestaurantAccess(req, res);
  if (!restaurantId) return;
  try {
    const config = await dashboardConfig(restaurantId);
    if (!config) return res.status(404).json({ error: 'Config not found' });
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ config, user: req.user });
  } catch (err) {
    console.error('[ERROR] Failed to load config:', err);
    return res.status(500).json({ error: 'Failed to fetch config' });
  }
});

// POST updateConfig
dashboardRouter.post('/:restaurantId/updateConfig', authIfNotPublic, async (req, res) => {
  const restaurantId = enforceRestaurantAccess(req, res);
  if (!restaurantId) return;
  const updates = req.body;
  try {
    const base = getAirtableBase(process.env.MASTER_BASE_ID);
    const formula = `{restaurantId} = "${restaurantId}"`;
    const records = await base('restaurantMap').select({ filterByFormula: formula }).firstPage();
    if (!records.length) return res.status(404).json({ error: 'No matching config found' });

    const allowedFields = [
      'baseId', 'tableName', 'maxReservations', 'cutoffTime', 'futureCutoff',
      'name', 'timeZone',
      'mondayOpen', 'mondayClose', 'tuesdayOpen', 'tuesdayClose',
      'wednesdayOpen', 'wednesdayClose', 'thursdayOpen', 'thursdayClose',
      'fridayOpen', 'fridayClose', 'saturdayOpen', 'saturdayClose',
      'sundayOpen', 'sundayClose'
    ];
    const numericFields = ['maxReservations', 'futureCutoff', 'cutoffTime'];
    const timeFields = [
      'mondayOpen', 'mondayClose', 'tuesdayOpen', 'tuesdayClose',
      'wednesdayOpen', 'wednesdayClose', 'thursdayOpen', 'thursdayClose',
      'fridayOpen', 'fridayClose', 'saturdayOpen', 'saturdayClose',
      'sundayOpen', 'sundayClose'
    ];

    const sanitizedUpdates = {};
    const droppedFields = [];
    for (const key in updates) {
      if (allowedFields.includes(key)) {
        let value = updates[key];
        if (numericFields.includes(key)) {
          const parsed = parseInt(value, 10);
          if (!isNaN(parsed)) value = parsed;
          else continue;
        }
        if (timeFields.includes(key)) {
          const normalized = normalizeTime(value);
          if (normalized) value = normalized;
          else continue;
        }
        sanitizedUpdates[key] = value;
      } else {
        droppedFields.push(key);
      }
    }

    if (!Object.keys(sanitizedUpdates).length) {
      return res.status(400).json({ error: 'No valid fields to update', droppedFields });
    }

    const result = await base('restaurantMap').update(records[0].id, sanitizedUpdates);
    setRefreshFlag(restaurantId);
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ success: true, updated: result, droppedFields });
  } catch (err) {
    console.error('[ERROR] Failed to update config:', err);
    return res.status(500).json({ error: 'Failed to update config' });
  }
});

// GET refreshFlag
dashboardRouter.get('/:restaurantId/refreshFlag', authIfNotPublic, async (req, res) => {
  const restaurantId = enforceRestaurantAccess(req, res);
  if (!restaurantId) return;
  const flag = refreshFlags[restaurantId] || 0;
  refreshFlags[restaurantId] = 0;
  return res.status(200).json({ refresh: flag });
});
