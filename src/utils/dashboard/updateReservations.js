import { dashboardConfig } from './dashboardConfig.js';
import { getAirtableBase } from './airtableHelpers.js';

export async function updateReservations(restaurantId, updatesArray) {
  console.log('[DEBUG] updateReservations called with:', { restaurantId, updatesArray });

  try {
    const config = await dashboardConfig(restaurantId);
    if (!config) {
      console.warn('[WARN] No config found for restaurantId:', restaurantId);
      return { success: false, error: 'Invalid restaurant config' };
    }

    const base = getAirtableBase(config.baseId);
    if (!base) {
      console.error('[ERROR] Could not initialize Airtable base.');
      return { success: false, error: 'Airtable base not initialized' };
    }

    const results = [];

    for (const { recordId, updatedFields } of updatesArray) {
      try {
        // Exclude computed or read-only fields
        const excludedFields = ['confirmationCode', 'rawConfirmationCode', 'dateFormatted'];
        const filteredFields = Object.fromEntries(
          Object.entries(updatedFields).filter(([key]) => !excludedFields.includes(key))
        );

        const result = await base(config.tableName).update(recordId, filteredFields);
        console.log('[DEBUG] Reservation update result:', result.id);
        results.push({ success: true, id: result.id });
      } catch (err) {
        console.error('[ERROR] Failed to update recordId:', recordId, err.message);
        results.push({ success: false, recordId, error: err.message });
      }
    }

    return results;
  } catch (error) {
    console.error(`[ERROR] updateReservations failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}
