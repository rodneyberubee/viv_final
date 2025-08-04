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
        // Exclude computed or read-only fields (but keep `hidden`)
        const excludedFields = ['confirmationCode', 'rawConfirmationCode', 'dateFormatted'];

        let filteredFields = Object.fromEntries(
          Object.entries(updatedFields).filter(
            ([key, val]) =>
              !excludedFields.includes(key) &&
              val !== '' &&
              val !== null &&
              val !== undefined
          )
        );

        // Ensure `hidden` is a proper boolean if provided
        if (updatedFields.hasOwnProperty('hidden')) {
          filteredFields.hidden =
            updatedFields.hidden === true || updatedFields.hidden === 'true';
        }

        // Always enforce restaurantId
        filteredFields.restaurantId = restaurantId;

        // If creating a new record, enforce at least restaurantId and date (preserve hidden if present)
        if (!recordId) {
          filteredFields = {
            restaurantId,
            date: updatedFields.date || new Date().toISOString().split('T')[0],
            ...(updatedFields.hasOwnProperty('hidden') && { hidden: filteredFields.hidden }),
          };
        }

        console.log('[DEBUG] Payload to Airtable:', filteredFields);

        let result;
        if (!recordId) {
          // CREATE new record
          result = await base(config.tableName).create(filteredFields);
          console.log('[DEBUG] Created new reservation:', result.id);
        } else {
          // Validate ownership
          const existingRecord = await base(config.tableName).find(recordId);
          if (existingRecord.fields.restaurantId !== restaurantId) {
            console.warn(`[WARN] Attempted to update a record that does not belong to ${restaurantId}`);
            results.push({ success: false, recordId, error: 'Record does not belong to this restaurant' });
            continue;
          }

          // UPDATE existing record
          result = await base(config.tableName).update(recordId, filteredFields);
          console.log('[DEBUG] Updated reservation:', result.id);
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
