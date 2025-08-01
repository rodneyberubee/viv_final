import express from 'express';
import crypto from 'crypto';
import Airtable from 'airtable';
import dotenv from 'dotenv';
import { Resend } from 'resend';
import jwt from 'jsonwebtoken';

dotenv.config();
const router = express.Router();

// Setup Airtable
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.MASTER_BASE_ID);

// Setup Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// Step 1: Request login (send magic link)
router.post('/', express.json(), async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'missing_email' });

  try {
    // Check if email exists in restaurantMap
    const records = await base('restaurantMap')
      .select({ filterByFormula: `{email} = '${String(email).replace(/'/g, "\\'")}'` })
      .firstPage();

    if (records.length === 0) {
      return res.status(404).json({ error: 'email_not_found' });
    }

    const record = records[0];
    const restaurantId = record.fields.restaurantId;
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes

    // Save token + expiry in Airtable
    await base('restaurantMap').update(record.id, {
      loginToken: token,
      loginTokenExpires: new Date(expiresAt).toISOString()
    });

    // Build link to the dynamic dashboard page
    const loginUrl = `${process.env.FRONTEND_URL}/dashboard/${restaurantId}?token=${token}`;

    // Send email using Resend
    await resend.emails.send({
      from: process.env.RESEND_FROM,
      to: email,
      subject: 'Your Viv Dashboard Login Link',
      html: `
        <p>Click below to securely access your Viv dashboard:</p>
        <p><a href="${loginUrl}" style="display:inline-block;padding:10px 15px;background:#007BFF;color:#fff;text-decoration:none;border-radius:5px;">Access Dashboard</a></p>
        <p>Or copy this link into your browser: ${loginUrl}</p>
      `
    });

    return res.status(200).json({ message: 'magic_link_sent' });
  } catch (err) {
    console.error('[ERROR][login.request]', err);
    return res.status(500).json({ error: 'internal_server_error' });
  }
});

// Backward compatibility alias for POST /api/auth/login/request
router.post('/request', (req, res, next) => {
  req.url = '/';
  next();
});

// Step 2: Verify token (issue JWT)
router.post('/verify', express.json(), async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'missing_token' });

  if (!process.env.JWT_SECRET) {
    console.error('[CONFIG ERROR] Missing JWT_SECRET in environment variables');
    return res.status(500).json({ error: 'server_config_error' });
  }

  try {
    const records = await base('restaurantMap')
      .select({ filterByFormula: `{loginToken} = '${String(token).replace(/'/g, "\\'")}'` })
      .firstPage();

    if (records.length === 0) {
      console.warn('[VERIFY] Invalid token attempt:', token);
      return res.status(400).json({ error: 'invalid_token' });
    }

    const record = records[0];
    const expiresAt = new Date(record.fields.loginTokenExpires).getTime();
    if (!expiresAt || Date.now() > expiresAt) {
      console.warn(`[VERIFY] Expired token for ${record.fields.email}`);
      return res.status(400).json({ error: 'token_expired' });
    }

    // Clear magic link (single-use)
    await base('restaurantMap').update(record.id, {
      loginToken: '',
      loginTokenExpires: ''
    });

    // Prepare JWT payload
    const payload = {
      restaurantId: record.fields.restaurantId,
      email: record.fields.email,
      name: record.fields.name || null
    };

    // Sign a JWT (valid for 1 day)
    const jwtToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' });

    console.log(`[AUTH] JWT issued for ${record.fields.restaurantId} (${record.fields.email})`);

    return res.status(200).json({ token: jwtToken });
  } catch (err) {
    console.error('[ERROR][login.verify]', err);
    return res.status(500).json({ error: 'internal_server_error' });
  }
});

// Step 3: Refresh JWT
router.post('/refresh', express.json(), (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing_token' });
  }

  const oldToken = authHeader.split(' ')[1];
  if (!process.env.JWT_SECRET) return res.status(500).json({ error: 'server_config_error' });

  try {
    const decoded = jwt.verify(oldToken, process.env.JWT_SECRET) as any;
    const { restaurantId, email, name } = decoded;
    const newToken = jwt.sign({ restaurantId, email, name }, process.env.JWT_SECRET, { expiresIn: '1d' });
    return res.status(200).json({ token: newToken });
  } catch (err) {
    console.error('[ERROR][auth.refresh]', err);
    return res.status(401).json({ error: 'invalid_or_expired_token' });
  }
});

export default router;
