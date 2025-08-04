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
        const excludedFields = ['confirmationCode', 'rawConfirmationCode', 'dateFormatted'];
        let filteredFields = Object.fromEntries(
          Object.entries(updatedFields).filter(([key]) => !excludedFields.includes(key))
        );

        // FORCE hidden to "1" no matter what when updating
        filteredFields.hidden = "1";
        filteredFields.restaurantId = restaurantId;

        if (!recordId) {
          filteredFields = {
            ...filteredFields,
            restaurantId,
            date: updatedFields.date || new Date().toISOString().split('T')[0],
          };
        }

        console.log('[DEBUG] Final fields sent to Airtable:', filteredFields);

        let result;
        if (!recordId) {
          result = await base(config.tableName).create(filteredFields);
          console.log('[DEBUG] Created new reservation:', result.fields);
        } else {
          const existingRecord = await base(config.tableName).find(recordId);
          if (existingRecord.fields.restaurantId !== restaurantId) {
            console.warn(`[WARN] Record does not belong to ${restaurantId}`);
            results.push({ success: false, recordId, error: 'Record does not belong to this restaurant' });
            continue;
          }
          result = await base(config.tableName).update(recordId, filteredFields);
          console.log('[DEBUG] Updated reservation fields returned:', result.fields);
        }

        // Check if Airtable actually wrote the "1"
        if (result.fields.hidden !== "1") {
          console.error(`[ERROR] Airtable did not update 'hidden' to "1" for record ${recordId}`);
        }

        results.push({ success: true, id: result.id });
      } catch (err) {
        console.error('[ERROR] Failed to update/create recordId:', recordId || '(new)', err.message);
        results.push({ success: false, recordId, error: err.message });
      }
    }
    return results;
  } catch (error) {
    console.error(`[ERROR] updateReservations failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}
