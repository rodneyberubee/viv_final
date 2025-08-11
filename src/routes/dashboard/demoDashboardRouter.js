// routes/dashboard/demoDashboardRouter.js
import express from 'express';
import { DateTime } from 'luxon';
import { getReservations } from '../../utils/dashboard/getReservations.js';
import { updateReservations } from '../../utils/dashboard/updateReservations.js';
import { dashboardConfig } from '../../utils/dashboard/dashboardConfig.js';
import { getAirtableBase } from '../../utils/dashboard/airtableHelpers.js';

export const demoDashboardRouter = express.Router();

// In-memory refresh flags (keyed by restaurantId)
const refreshFlags = {};

// ---- helpers ----
const ALLOWLIST = new Set(['mollyscafe1']);

const enforceDemoAccess = (req, res) => {
  const { restaurantId } = req.params;

  if (!restaurantId) {
    console.error('[ERROR] Missing restaurantId in URL.');
    res.status(400).json({ error: 'Missing restaurantId in URL.' });
    return null;
  }

  if (!ALLOWLIST.has(restaurantId)) {
    console.warn('[WARN] Demo access forbidden for restaurantId:', restaurantId);
    res.status(403).json({ error: 'forbidden' });
    return null;
  }

  // Guard against body including restaurantId (stateless contract)
  if (req.body && typeof req.body === 'object' && 'restaurantId' in req.body) {
    console.warn('[WARN] Dropping restaurantId from body to preserve statelessness');
    delete req.body.restaurantId;
  }

  return restaurantId;
};

const setRefreshFlag = (restaurantId) => {
  refreshFlags[restaurantId] = 1;
  console.log('[DEBUG] [demo] refresh flag set for', restaurantId);
};

// Normalize time input to 24-hour HH:mm
const normalizeTime = (value) => {
  if (!value || typeof value !== 'string') return null;
  let dt = DateTime.fromFormat(value.trim(), 'H:mm');
  if (!dt.isValid) dt = DateTime.fromFormat(value.trim(), 'h:mm a');
  if (!dt.isValid) return null;
  return dt.toFormat('HH:mm');
};

// ---- routes ----

// GET /api/demo-dashboard/:restaurantId/reservations
demoDashboardRouter.get('/:restaurantId/reservations', async (req, res) => {
  console.log('[DEBUG] [demo] GET /reservations called');
  const restaurantId = enforceDemoAccess(req, res);
  if (!restaurantId) return;

  try {
    const reservations = await getReservations(restaurantId);
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ reservations });
  } catch (err) {
    console.error('[ERROR] [demo] Failed to get reservations:', err);
    return res.status(500).json({ error: 'Failed to fetch reservations' });
  }
});

// POST /api/demo-dashboard/:restaurantId/updateReservation
demoDashboardRouter.post('/:restaurantId/updateReservation', async (req, res) => {
  console.log('[DEBUG] [demo] POST /updateReservation called');
  const restaurantId = enforceDemoAccess(req, res);
  if (!restaurantId) return;

  const updates = req.body;
  if (!updates || !Array.isArray(updates)) {
    return res.status(400).json({ error: 'Invalid or missing update data (array expected)' });
  }

  try {
    const result = await updateReservations(restaurantId, updates);
    setRefreshFlag(restaurantId);
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ success: true, updated: result });
  } catch (err) {
    console.error('[ERROR] [demo] Failed to update reservations:', err);
    return res.status(500).json({ error: 'Failed to update reservations' });
  }
});

// GET /api/demo-dashboard/:restaurantId/config
demoDashboardRouter.get('/:restaurantId/config', async (req, res) => {
  console.log('[DEBUG] [demo] GET /config called');
  const restaurantId = enforceDemoAccess(req, res);
  if (!restaurantId) return;

  try {
    const config = await dashboardConfig(restaurantId);
    if (!config) return res.status(404).json({ error: 'Config not found' });
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ config });
  } catch (err) {
    console.error('[ERROR] [demo] Failed to load config:', err);
    return res.status(500).json({ error: 'Failed to fetch config' });
  }
});

// POST /api/demo-dashboard/:restaurantId/updateConfig
demoDashboardRouter.post('/:restaurantId/updateConfig', async (req, res) => {
  console.log('[DEBUG] [demo] POST /updateConfig called');
  const restaurantId = enforceDemoAccess(req, res);
  if (!restaurantId) return;

  const updates = req.body || {};

  try {
    const base = getAirtableBase(process.env.MASTER_BASE_ID);
    const formula = `{restaurantId} = "${restaurantId}"`;
    const records = await base('restaurantMap').select({ filterByFormula: formula }).firstPage();

    if (!records.length) {
      return res.status(404).json({ error: 'No matching config found' });
    }

    // Only allow editable Airtable fields (exclude computed)
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
      if (!allowedFields.includes(key)) {
        droppedFields.push(key);
        continue;
      }
      let value = updates[key];

      if (numericFields.includes(key)) {
        const parsed = parseInt(value, 10);
        if (isNaN(parsed)) {
          console.warn('[WARN] [demo] Skipping invalid number for', key, value);
          continue;
        }
        value = parsed;
      }

      if (timeFields.includes(key)) {
        const normalized = normalizeTime(value);
        if (!normalized) {
          console.warn('[WARN] [demo] Skipping invalid time for', key, value);
          continue;
        }
        value = normalized;
      }

      sanitizedUpdates[key] = value;
    }

    if (Object.keys(sanitizedUpdates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update', droppedFields });
    }

    console.log('[DEBUG] [demo] Sanitized updates:', sanitizedUpdates);

    const result = await base('restaurantMap').update(records[0].id, sanitizedUpdates);
    setRefreshFlag(restaurantId);
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ success: true, updated: result, droppedFields });
  } catch (err) {
    console.error('[ERROR] [demo] Failed to update config:', err);
    return res.status(500).json({ error: 'Failed to update config' });
  }
});

// GET /api/demo-dashboard/:restaurantId/refreshFlag
demoDashboardRouter.get('/:restaurantId/refreshFlag', (req, res) => {
  console.log('[DEBUG] [demo] GET /refreshFlag called');
  const restaurantId = enforceDemoAccess(req, res);
  if (!restaurantId) return;

  const flag = refreshFlags[restaurantId] || 0;
  refreshFlags[restaurantId] = 0; // reset after read
  return res.status(200).json({ refresh: flag });
});
