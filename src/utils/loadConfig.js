import Airtable from 'airtable';
import dotenv from 'dotenv';
dotenv.config();

export async function loadRestaurantConfig(restaurantId) {
  console.log(`[DEBUG] loadRestaurantConfig called with restaurantId: ${restaurantId}`);

  try {
    if (!process.env.MASTER_BASE_ID || !process.env.AIRTABLE_API_KEY) {
      console.error('[ENV ERROR] Missing environment variables: MASTER_BASE_ID or AIRTABLE_API_KEY');
      return null;
    }

    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.MASTER_BASE_ID);

    console.log(`[DEBUG] Using base ID: ${process.env.MASTER_BASE_ID}`);
    const formula = `{restaurantId} = "${restaurantId}"`;
    console.log(`[DEBUG] Querying table: restaurantMap with filterByFormula: ${formula}`);

    const records = await base('restaurantMap')
      .select({
        filterByFormula: formula
      })
      .all();

    console.log(`[DEBUG] Airtable returned ${records.length} record(s)`);

    if (records.length === 0) {
      console.warn(`[WARN] No records found for restaurantId: ${restaurantId}`);
      return null;
    }

    const record = records[0];
    console.log('[DEBUG] Raw record fields:', record.fields);

    const config = {
      restaurantId: record.fields.restaurantId,
      baseId: record.fields.baseId,
      tableName: record.fields.tableName,
      maxReservations: record.fields.maxReservations || 10,
      futureCutoff: record.fields.futureCutoff || 30,
      timezone: record.fields.timezone || 'America/Los_Angeles', // fallback for now
      calibratedTime: record.fields.calibratedTime || null // new DST-aware timestamp field
    };

    console.log('[DEBUG] Final config object:', config);
    return config;

  } catch (error) {
    console.error(`[ERROR] Failed to load config for restaurantId ${restaurantId}: ${error.message}`);
    return null;
  }
}
