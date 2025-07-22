import Airtable from 'airtable';
import dotenv from 'dotenv';
dotenv.config();

export function getAirtableBase(baseId) {
  console.log('[DEBUG] getAirtableBase called with baseId:', baseId);

  if (!process.env.AIRTABLE_API_KEY) {
    console.error('[ENV ERROR] Missing AIRTABLE_API_KEY');
    return null;
  }

  try {
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(baseId);
    return base;
  } catch (error) {
    console.error('[ERROR] Failed to create Airtable base instance:', error.message);
    return null;
  }
}
