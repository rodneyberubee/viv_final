// /routes/auth/login.js
import express from 'express';
import crypto from 'crypto';
import Airtable from 'airtable';
import dotenv from 'dotenv';
import { Resend } from 'resend';

dotenv.config();
const router = express.Router();

// Setup Airtable
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.MASTER_BASE_ID);

// Setup Resend
const resend = new Resend(process.env.RESEND_API_KEY);

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

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 min

    // Save token + expiry in Airtable
    await base('restaurantMap').update(records[0].id, {
      loginToken: token,
      loginTokenExpires: new Date(expiresAt).toISOString()
    });

    const loginUrl = `${process.env.FRONTEND_URL}/login?token=${token}`;

    // Send email using Resend
    await resend.emails.send({
      from: process.env.RESEND_FROM,
      to: email,
      subject: 'Your Viv Login Link',
      html: `<p>Click here to login: <a href="${loginUrl}">${loginUrl}</a></p>`
    });

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
    const expiresAt = new Date(record.fields.loginTokenExpires).getTime();
    if (Date.now() > expiresAt) {
      return res.status(400).json({ error: 'token_expired' });
    }

    // Clear token fields
    await base('restaurantMap').update(record.id, {
      loginToken: '',
      loginTokenExpires: ''
    });

    const session = {
      restaurantId: record.fields.restaurantId,
      email: record.fields.email
    };

    return res.status(200).json({ message: 'login_success', session });
  } catch (err) {
    console.error('[ERROR][login.verify]', err);
    return res.status(500).json({ error: 'internal_server_error' });
  }
});

export default router;
