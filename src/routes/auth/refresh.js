// routes/auth/refresh.js
import express from 'express';
import jwt from 'jsonwebtoken';
import Airtable from 'airtable';
import dotenv from 'dotenv';
dotenv.config();

const router = express.Router();
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.MASTER_BASE_ID);

router.post('/', express.json(), async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('[REFRESH] Missing or malformed Authorization header');
    return res.status(401).json({ error: 'missing_token' });
  }

  const token = authHeader.split(' ')[1];
  try {
    // Decode even if expired
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
    console.log('[REFRESH] Decoded token for:', decoded.email, 'restaurantId:', decoded.restaurantId);

    // Ensure required fields
    if (!decoded.restaurantId || !decoded.email) {
      console.warn('[REFRESH] Token missing restaurantId or email');
      return res.status(401).json({ error: 'invalid_token' });
    }

    // Verify user still exists in Airtable
    const records = await base('restaurantMap')
      .select({ filterByFormula: `{restaurantId} = '${decoded.restaurantId}'` })
      .firstPage();

    if (records.length === 0) {
      console.warn('[REFRESH] No matching restaurant found for:', decoded.restaurantId);
      return res.status(401).json({ error: 'user_not_found' });
    }

    // Build new token payload
    const payload = {
      restaurantId: decoded.restaurantId,
      email: decoded.email,
      name: decoded.name || null
    };

    // Sign new JWT with 1-day expiration
    const newToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' });
    console.log('[REFRESH] New JWT issued for:', decoded.restaurantId);

    return res.json({ token: newToken });
  } catch (err) {
    console.error('[REFRESH ERROR] Failed to refresh token:', err.message);
    return res.status(401).json({ error: 'invalid_token' });
  }
});

export default router;
