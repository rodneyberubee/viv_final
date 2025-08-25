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
        // Only exclude true formula/display fields. Keep shotgun for everything else.
        const excludedFields = ['confirmationCode', 'dateFormatted'];
        let filteredFields = Object.fromEntries(
          Object.entries(updatedFields).filter(([key]) => !excludedFields.includes(key))
        );

        // Tolerate dashboard typo -> map to preferred key without breaking existing data.
        if ('conatactInfo' in filteredFields && !('contactInfo' in filteredFields)) {
          filteredFields.contactInfo = filteredFields.conatactInfo;
          delete filteredFields.conatactInfo;
        }

        // Normalize partySize for Airtable (convert to number or null). Leave other time-like text fields as-is.
        if (Object.prototype.hasOwnProperty.call(filteredFields, 'partySize')) {
          const v = filteredFields.partySize;
          filteredFields.partySize =
            v === '' || v === undefined ? null : (parseInt(v, 10) || null);
        }

        // Always tag with routing key; no auto-defaults for date/time fields.
        filteredFields.restaurantId = restaurantId;

        // Remove auto "today" default on create to keep full manual control.
        // If creating without a recordId, just send what the dashboard provided.
        // (Previously this block injected a default date—intentionally removed.)
        // if (!recordId) {
        //   filteredFields = {
        //     ...filteredFields,
        //     restaurantId,
        //     date: updatedFields.date || new Date().toISOString().split('T')[0],
        //   };
        // }

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
