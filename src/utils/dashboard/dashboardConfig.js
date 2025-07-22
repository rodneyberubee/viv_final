import Airtable from 'airtable';
import dotenv from 'dotenv';
dotenv.config();

export async function dashboardConfig(restaurantId) {
  console.log('[DEBUG] dashboardConfig called with restaurantId:', restaurantId);

  if (!restaurantId) {
    console.error('[ERROR] dashboardConfig: Missing restaurantId');
    return null;
  }

  if (!process.env.MASTER_BASE_ID || !process.env.AIRTABLE_API_KEY) {
    console.error('[ENV ERROR] Missing environment variables: MASTER_BASE_ID or AIRTABLE_API_KEY');
    return null;
  }

  try {
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.MASTER_BASE_ID);
    const formula = `{restaurantId} = "${restaurantId}"`;

    console.log('[DEBUG] Querying restaurantMap with formula:', formula);

    const records = await base('restaurantMap')
      .select({ filterByFormula: formula })
      .all();

    if (records.length === 0) {
      console.warn('[WARN] dashboardConfig: No config found for', restaurantId);
      return null;
    }

    const fields = records[0].fields;
    const config = {
      restaurantId: fields.restaurantId,
      baseId: fields.baseId,
      tableName: fields.tableName,
    };

    console.log('[DEBUG] dashboardConfig resolved:', config);
    return config;

  } catch (err) {
    console.error('[ERROR] dashboardConfig failed:', err.message);
    return null;
  }
}
