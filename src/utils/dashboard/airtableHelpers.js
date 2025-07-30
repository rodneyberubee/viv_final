import Airtable from 'airtable';
import dotenv from 'dotenv';
dotenv.config();

export function getAirtableBase(baseId) {
  console.log('[DEBUG] getAirtableBase called with baseId:', baseId);

  if (!process.env.AIRTABLE_API_KEY) {
    console.error('[ENV ERROR] Missing AIRTABLE_API_KEY');
    return null; // or throw new Error('Missing AIRTABLE_API_KEY');
  }

  if (!baseId || typeof baseId !== 'string') {
    console.error('[ERROR] getAirtableBase: Invalid or missing baseId');
    return null; // or throw new Error('Invalid baseId');
  }

  try {
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(baseId.trim());
    console.log('[DEBUG] Airtable base initialized successfully');
    return base;
  } catch (error) {
    console.error('[ERROR] Failed to create Airtable base instance:', error.message);
    return null; // or throw new Error(`Failed to initialize Airtable base: ${error.message}`);
  }
}
