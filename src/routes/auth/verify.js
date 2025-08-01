import express from 'express';
import Airtable from 'airtable';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

dotenv.config();

const router = express.Router();
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.MASTER_BASE_ID);

router.post('/', express.json(), async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'missing_token' });

  if (!process.env.JWT_SECRET) {
    console.error('[CONFIG ERROR] Missing JWT_SECRET in environment variables');
    return res.status(500).json({ error: 'server_config_error' });
  }

  try {
    // Escape token for Airtable
    const records = await base('restaurantMap')
      .select({ filterByFormula: `{loginToken} = '${String(token).replace(/'/g, "\\'")}'` })
      .firstPage();

    if (records.length === 0) {
      console.warn('[VERIFY] Invalid token attempt:', token);
      return res.status(400).json({ error: 'invalid_token' });
    }

    const record = records[0];
    const expiresAt = new Date(record.fields.loginTokenExpires).getTime();
    const now = Date.now();

    console.log(`[DEBUG] Now: ${now}, ExpiresAt: ${expiresAt}, Diff: ${expiresAt - now}ms`);

    if (!expiresAt || now > expiresAt) {
      console.warn(`[VERIFY] Expired token for ${record.fields.email}`);
      return res.status(400).json({ error: 'token_expired' });
    }

    // Invalidate the token (single-use)
    await base('restaurantMap').update(record.id, { loginToken: '', loginTokenExpires: '' });

    // Prepare JWT payload
    const payload = {
      restaurantId: record.fields.restaurantId,
      email: record.fields.email,
      name: record.fields.name || null
    };
    if (!payload.restaurantId || !payload.email) {
      console.error('[JWT ERROR] Missing required fields for payload');
      return res.status(500).json({ error: 'token_generation_failed' });
    }

    // Sign JWT (valid 1 day)
    let jwtToken;
    try {
      jwtToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' });
    } catch (jwtErr) {
      console.error('[JWT ERROR] Failed to sign token:', jwtErr);
      return res.status(500).json({ error: 'token_generation_failed' });
    }

    console.log(`[AUTH] JWT issued for ${payload.restaurantId} (${payload.email})`);

    return res.status(200).json({ token: jwtToken });
  } catch (err) {
    console.error('[ERROR][verify]', err);
    return res.status(500).json({ error: 'internal_server_error' });
  }
});

export default router;
