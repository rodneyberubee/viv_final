import Airtable from 'airtable';
import dotenv from 'dotenv';
dotenv.config();

export function getAirtableBase(baseId) {
  if (!process.env.AIRTABLE_API_KEY) {
    console.error('[ENV ERROR] Missing AIRTABLE_API_KEY');
    return null;
  }

  console.log(`[DEBUG] Creating Airtable base instance for baseId: ${baseId}`);
  return new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(baseId);
}

export async function fetchRecords(baseId, tableName, filterFormula = '') {
  console.log(`[DEBUG] fetchRecords called with baseId: ${baseId}, table: ${tableName}, filter: ${filterFormula}`);

  try {
    const base = getAirtableBase(baseId);
    if (!base) {
      console.error('[ERROR] Base instance could not be created.');
      return [];
    }

    const selectOptions = filterFormula
      ? { filterByFormula: filterFormula }
      : {};

    const records = await base(tableName).select(selectOptions).all();
    console.log(`[DEBUG] Retrieved ${records.length} record(s) from ${tableName}`);
    return records;
  } catch (error) {
    console.error(`[ERROR] Failed to fetch records from ${tableName}: ${error.message}`);
    return [];
  }
}

