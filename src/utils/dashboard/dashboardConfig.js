import Airtable from 'airtable';
import dotenv from 'dotenv';
dotenv.config();

export const dashboardConfig = async (restaurantId) => {
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

    // Normalize critical fields
    const cleanRestaurantId = (fields.restaurantId || '').trim();
    const baseId = fields.baseId?.trim();
    const tableName = fields.tableName?.trim();

    if (!cleanRestaurantId || !baseId || !tableName) {
      console.error('[ERROR] dashboardConfig: Missing critical fields (restaurantId, baseId, tableName)');
      return null;
    }

    const config = {
      restaurantId: cleanRestaurantId,
      baseId,
      tableName,
      maxReservations: fields.maxReservations,
      cutoffTime: fields.cutoffTime,
      futureCutoff: fields.futureCutoff,
      name: fields.name,
      autonumber: fields.autonumber,
      slug: fields.slug,
      restaurantFormula: fields.restaurantFormula,
      timeZone: fields.timeZone,
      calibratedTime: fields.calibratedTime,
      mondayOpen: fields.mondayOpen,
      mondayClose: fields.mondayClose,
      tuesdayOpen: fields.tuesdayOpen,
      tuesdayClose: fields.tuesdayClose,
      wednesdayOpen: fields.wednesdayOpen,
      wednesdayClose: fields.wednesdayClose,
      thursdayOpen: fields.thursdayOpen,
      thursdayClose: fields.thursdayClose,
      fridayOpen: fields.fridayOpen,
      fridayClose: fields.fridayClose,
      saturdayOpen: fields.saturdayOpen,
      saturdayClose: fields.saturdayClose,
      sundayOpen: fields.sundayOpen,
      sundayClose: fields.sundayClose
    };

    console.log('[DEBUG] dashboardConfig resolved:', config);
    return config;

  } catch (err) {
    console.error('[ERROR] dashboardConfig failed:', err.message);
    return null;
  }
};
