// /routes/auth/login.js
import express from 'express';
import crypto from 'crypto';
import Airtable from 'airtable';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

dotenv.config();
const router = express.Router();

// Setup Airtable
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.MASTER_BASE_ID);

// Email setup (configure SMTP in .env)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// Step 1: Request login (send magic link)
router.post('/request', express.json(), async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'missing_email' });

  try {
    // Check if email exists in restaurantMap
    const records = await base('restaurantMap')
      .select({ filterByFormula: `{email} = '${email}'` })
      .firstPage();

    if (records.length === 0) {
      return res.status(404).json({ error: 'email_not_found' });
    }

    const restaurantName = records[0].fields.name || 'Your Restaurant';
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 min

    // Save token + expiry in Airtable
    await base('restaurantMap').update(records[0].id, {
      loginToken: token,
      loginTokenExpires: new Date(expiresAt).toISOString()
    });

    const loginUrl = `${process.env.FRONTEND_URL}/login?token=${token}`;

    // Send email
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: email,
      subject: `Your Viv Login Link for ${restaurantName}`,
      text: `Click here to login: ${loginUrl}`,
      html: `<p>Click here to login: <a href="${loginUrl}">${loginUrl}</a></p>`
    });

    console.log(`[INFO] Magic link sent to ${email}`);
    return res.status(200).json({ message: 'magic_link_sent' });
  } catch (err) {
    console.error('[ERROR][login.request]', err);
    return res.status(500).json({ error: 'internal_server_error' });
  }
});

// Step 2: Verify token
router.post('/verify', express.json(), async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'missing_token' });

  try {
    const records = await base('restaurantMap')
      .select({ filterByFormula: `{loginToken} = '${token}'` })
      .firstPage();

    if (records.length === 0) {
      return res.status(400).json({ error: 'invalid_token' });
    }

    const record = records[0];
    const storedToken = record.fields.loginToken;
    const expiresAtRaw = record.fields.loginTokenExpires;
    const expiresAt = expiresAtRaw ? new Date(expiresAtRaw).getTime() : 0;

    if (!storedToken || !expiresAt || Date.now() > expiresAt) {
      return res.status(400).json({ error: 'token_expired' });
    }

    // Use timingSafeEqual for token comparison
    if (!crypto.timingSafeEqual(Buffer.from(token), Buffer.from(storedToken))) {
      return res.status(400).json({ error: 'invalid_token' });
    }

    // Success: Clear token and return session payload
    await base('restaurantMap').update(record.id, {
      loginToken: '',
      loginTokenExpires: ''
    });

    // Create a session object (could replace with JWT later)
    const session = {
      restaurantId: record.fields.restaurantId,
      email: record.fields.email
    };

    console.log(`[INFO] Login successful for ${record.fields.email}`);
    return res.status(200).json({ message: 'login_success', session });
  } catch (err) {
    console.error('[ERROR][login.verify]', err);
    return res.status(500).json({ error: 'internal_server_error' });
  }
});

export default router;
