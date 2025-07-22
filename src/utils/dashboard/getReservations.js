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

    const records = await base(config.tableName)
      .select({ sort: [{ field: 'date' }, { field: 'timeSlot' }] })
      .all();

    console.log(`[DEBUG] Fetched ${records.length} reservation(s) for ${restaurantId}`);

    const parsed = records.map(record => ({
      id: record.id,
      confirmationCode: record.fields.confirmationCode || '—',
      guestName: record.fields.guestName || '—',
      partySize: record.fields.partySize || 1,
      date: record.fields.date || '',
      timeSlot: record.fields.timeSlot || '',
      status: record.fields.status || 'pending'
    }));

    console.log('[DEBUG] Mapped reservations:', parsed);
    return parsed;

  } catch (error) {
    console.error(`[ERROR] getReservations failed for ${restaurantId}:`, error.message);
    return [];
  }
}
