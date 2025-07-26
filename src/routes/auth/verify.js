// /routes/auth/verify.js
import express from 'express';
import Airtable from 'airtable';
import dotenv from 'dotenv';
dotenv.config();

const router = express.Router();
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.MASTER_BASE_ID);

// Verify login token
router.post('/', express.json(), async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'missing_token' });

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

    // Return restaurant session data (could also issue a signed JWT)
    const session = {
      restaurantId: record.fields.restaurantId,
      email: record.fields.email,
      name: record.fields.name
    };

    return res.status(200).json({ message: 'login_success', session });
  } catch (err) {
    console.error('[ERROR][verify]', err);
    return res.status(500).json({ error: 'internal_server_error' });
  }
});

export default router;
