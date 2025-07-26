import Airtable from 'airtable';
import dotenv from 'dotenv';
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

    // Generate slug & restaurantId
    const slug = name.toLowerCase().replace(/\s+/g, '') + Date.now().toString().slice(-4);
    const restaurantId = slug;

    // Connect to Airtable
    if (!process.env.MASTER_BASE_ID || !process.env.AIRTABLE_API_KEY) {
      console.error('[ENV ERROR] Missing MASTER_BASE_ID or AIRTABLE_API_KEY');
      return res.status(500).json({ error: 'server_config_error' });
    }
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.MASTER_BASE_ID);

    // Create tableName for new restaurant
    const tableName = `tbl_${restaurantId}`;

    // Insert into restaurantMap
    const fields = {
      name,
      email,
      restaurantId,
      slug,
      tableName,
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

    console.log('[DEBUG] Creating Airtable record with fields:', fields);
    const created = await base('restaurantMap').create([{ fields }]);
    console.log('[DEBUG] Created restaurantMap record:', created[0].id);

    // OPTIONAL: Clone template table
    try {
      console.log('[DEBUG] Attempting to clone template table');
      const templateTable = 'templateReservations'; // existing template table in MASTER_BASE
      const templateRecords = await base(templateTable).select().all();

      if (templateRecords.length > 0) {
        await Promise.all(
          templateRecords.map(record =>
            base(tableName).create([
              { fields: { ...record.fields } }
            ])
          )
        );
        console.log(`[DEBUG] Cloned ${templateRecords.length} template rows into ${tableName}`);
      } else {
        console.warn('[WARN] Template table is empty; skipping cloning.');
      }
    } catch (cloneErr) {
      console.error('[ERROR] Failed to clone template table:', cloneErr.message);
    }

    return res.status(201).json({
      message: 'account_created',
      restaurantId,
      slug,
      tableName,
      recordId: created[0].id
    });

  } catch (error) {
    console.error('[ERROR] Failed to create account:', error);
    return res.status(500).json({ error: 'internal_server_error' });
  }
};
