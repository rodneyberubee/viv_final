import { getDashboardConfig } from './dashboardConfig.js';
import { getAirtableBase } from './airtableHelpers.js';

export async function getReservations(restaurantId) {
  console.log('[DEBUG] getReservations called with restaurantId:', restaurantId);

  try {
    const config = await getDashboardConfig(restaurantId);
    if (!config) {
      console.warn('[WARN] No config found for restaurantId:', restaurantId);
      return [];
    }

    const base = getAirtableBase(config.baseId);
    if (!base) {
      console.error('[ERROR] Could not initialize Airtable base.');
      return [];
    }

    const records = await base(config.tableName)
      .select({ sort: [{ field: 'date' }, { field: 'timeSlot' }] })
      .all();

    console.log(`[DEBUG] Fetched ${records.length} reservation(s) for ${restaurantId}`);

    return records.map(record => ({
      id: record.id,
      ...record.fields
    }));
  } catch (error) {
    console.error(`[ERROR] getReservations failed for ${restaurantId}:`, error.message);
    return [];
  }
}
