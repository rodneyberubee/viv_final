import { dashboardConfig } from './dashboardConfig.js';
import { getAirtableBase } from './airtableHelpers.js';

export async function getReservations(restaurantId) {
  console.log('[DEBUG] getReservations called with restaurantId:', restaurantId);

  try {
    const config = await dashboardConfig(restaurantId);
    if (!config) {
      console.warn('[WARN] No config found for restaurantId:', restaurantId);
      return [];
    }

    const base = getAirtableBase(config.baseId);
    if (!base) {
      console.error('[ERROR] Could not initialize Airtable base.');
      return [];
    }

    const filterByFormula = `{restaurantId} = '${restaurantId}'`;

    const records = await base(config.tableName)
      .select({
        filterByFormula,
        sort: [{ field: 'date' }, { field: 'timeSlot' }]
      })
      .all();

    console.log(`[DEBUG] Fetched ${records.length} reservation(s) for ${restaurantId}`);

    const parsed = records.map(record => {
      const fields = record.fields;

      return {
        id: record.id,
        date: fields.date || '',
        timeSlot: fields.timeSlot || '',
        name: fields.name || '—',
        partySize: fields.partySize || 1,
        contactInfo: fields.contactInfo || '',
        status: fields.status || 'pending',
        notes: fields.notes || '',
        confirmationCode: fields.confirmationCode || '—',
        rawConfirmationCode: fields.rawConfirmationCode || '',
        dateFormatted: fields.dateFormatted || ''
      };
    });

    console.log('[DEBUG] Mapped reservations:', parsed);
    return parsed;

  } catch (error) {
    console.error(`[ERROR] getReservations failed for ${restaurantId}:`, error.message);
    return [];
  }
}
