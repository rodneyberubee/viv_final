import { getDashboardConfig } from './dashboardConfig.js';
import { getAirtableBase } from './airtableHelpers.js';

export async function updateReservation(restaurantId, recordId, updatedFields) {
  console.log('[DEBUG] updateReservation called with:', { restaurantId, recordId, updatedFields });

  try {
    const config = await getDashboardConfig(restaurantId);
    if (!config) {
      console.warn('[WARN] No config found for restaurantId:', restaurantId);
      return { success: false, error: 'Invalid restaurant config' };
    }

    const base = getAirtableBase(config.baseId);
    if (!base) {
      console.error('[ERROR] Could not initialize Airtable base.');
      return { success: false, error: 'Airtable base not initialized' };
    }

    const result = await base(config.tableName).update(recordId, updatedFields);
    console.log('[DEBUG] Reservation update result:', result.id);

    return { success: true, updatedRecord: result };
  } catch (error) {
    console.error(`[ERROR] updateReservation failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}
