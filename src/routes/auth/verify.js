import express from 'express';
import Airtable from 'airtable';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken'; // <-- Added for JWT signing
dotenv.config();

const router = express.Router();
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.MASTER_BASE_ID);

// Verify login token
router.post('/', express.json(), async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'missing_token' });

  if (!process.env.JWT_SECRET) {
    console.error('[ERROR] Missing JWT_SECRET in environment variables');
    return res.status(500).json({ error: 'server_config_error' });
  }

  try {
    // Look up the record with this token
    const records = await base('restaurantMap')
      .select({ filterByFormula: `{loginToken} = '${token}'` })
      .firstPage();

    if (records.length === 0) {
      return res.status(400).json({ error: 'invalid_token' });
    }

    const record = records[0];
    const expiresAt = new Date(record.fields.loginTokenExpires).getTime();
    if (!expiresAt || Date.now() > expiresAt) {
      return res.status(400).json({ error: 'token_expired' });
    }

    // Clear token fields (single-use)
    await base('restaurantMap').update(record.id, {
      loginToken: '',
      loginTokenExpires: ''
    });

    // Prepare payload for JWT
    const payload = {
      restaurantId: record.fields.restaurantId,
      email: record.fields.email,
      name: record.fields.name
    };

    let jwtToken;
    try {
      // Sign JWT with secret key (expires in 1 day)
      jwtToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' });
    } catch (jwtErr) {
      console.error('[ERROR][verify] Failed to sign JWT:', jwtErr);
      return res.status(500).json({ error: 'token_generation_failed' });
    }

    console.log(`[INFO] JWT issued for restaurant: ${record.fields.restaurantId} (${record.fields.email})`);

    // Return signed JWT to the client
    return res.status(200).json({ 
      message: 'login_success', 
      token: `Bearer ${jwtToken}` 
    });
  } catch (err) {
    console.error('[ERROR][verify]', err);
    return res.status(500).json({ error: 'internal_server_error' });
  }
});

export default router;
