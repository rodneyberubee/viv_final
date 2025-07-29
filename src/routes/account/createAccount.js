// /routes/account/createAccount.js
import Airtable from 'airtable';
import dotenv from 'dotenv';
import { createReservationTable } from '../../helpers/createReservationTable.js'; // <-- NEW import
dotenv.config();

export const createAccount = async (req, res) => {
  console.log('[DEBUG] createAccount called with body:', req.body);

  try {
    const {
      name,
      email,
      maxReservations,
      futureCutoff,
      timeZone,
      mondayOpen, mondayClose,
      tuesdayOpen, tuesdayClose,
      wednesdayOpen, wednesdayClose,
      thursdayOpen, thursdayClose,
      fridayOpen, fridayClose,
      saturdayOpen, saturdayClose,
      sundayOpen, sundayClose
    } = req.body;

    if (!name || !email) {
      console.error('[ERROR] Missing required fields');
      return res.status(400).json({ error: 'missing_required_fields' });
    }

    // Connect to Airtable
    if (!process.env.MASTER_BASE_ID || !process.env.AIRTABLE_API_KEY) {
      console.error('[ENV ERROR] Missing MASTER_BASE_ID or AIRTABLE_API_KEY');
      return res.status(500).json({ error: 'server_config_error' });
    }
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.MASTER_BASE_ID);

    // Only include fields Airtable expects (set status as 'active')
    const fields = {
      name,
      email,
      status: 'active',
      maxReservations: parseInt(maxReservations) || 10,
      futureCutoff: parseInt(futureCutoff) || 30,
      timeZone: timeZone || 'America/Los_Angeles',
      mondayOpen, mondayClose,
      tuesdayOpen, tuesdayClose,
      wednesdayOpen, wednesdayClose,
      thursdayOpen, thursdayClose,
      fridayOpen, fridayClose,
      saturdayOpen, saturdayClose,
      sundayOpen, sundayClose
    };

    console.log('[DEBUG] Creating Airtable record in table: tblSrsq6Tw4YYMWk2 with fields:', fields);
    const created = await base('tblSrsq6Tw4YYMWk2').create([{ fields }]);
    const createdId = created[0].id;
    console.log('[DEBUG] Created restaurantMap record (active):', createdId);

    // === NEW: Create reservations table for this account ===
    const restaurantId = name.toLowerCase().replace(/\s+/g, ''); // generate slug-like ID
    let newTableId;
    try {
      newTableId = await createReservationTable(
        process.env.MASTER_BASE_ID,
        `${restaurantId}_reservations`
      );
      console.log('[DEBUG] Created reservations table for restaurant:', newTableId);
    } catch (err) {
      console.error('[ERROR] Failed to create reservations table:', err.message);
      return res.status(500).json({ error: 'failed_to_create_reservations_table', details: err.message });
    }

    // === Update restaurantMap record with tableId ===
    await base('tblSrsq6Tw4YYMWk2').update(createdId, {
      tableId: newTableId
    });
    console.log('[DEBUG] Updated restaurantMap record with tableId:', newTableId);

    return res.status(201).json({
      message: 'account_created',
      recordId: createdId,
      tableId: newTableId,
      restaurantId
    });

  } catch (error) {
    console.error('[ERROR] Failed to create account:', error?.message || error);
    return res.status(500).json({ error: 'internal_server_error', details: error?.message || error });
  }
};
