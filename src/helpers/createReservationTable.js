// /helpers/createReservationTable.js
import fetch from 'node-fetch';

export const createReservationTable = async (baseId, newTableName) => {
  const token = process.env.AIRTABLE_API_KEY;

  // Define static schema for reservations table
  const fields = [
    { name: 'Name', type: 'singleLineText' },
    { name: 'Party Size', type: 'number' },
    { name: 'Contact Info', type: 'singleLineText' },
    { name: 'Date', type: 'date' },
    { name: 'Time Slot', type: 'singleLineText' },
    { name: 'Status', type: 'singleSelect', options: { choices: ['confirmed', 'cancelled', 'blocked'] } },
    { name: 'Confirmation Code', type: 'singleLineText' },
    { name: 'Created At', type: 'createdTime' }
  ];

  // Create the table
  const createRes = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
    method: 'POST',
    headers: { 
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: newTableName,
      fields
    })
  });

  const newTable = await createRes.json();
  if (!newTable.id) throw new Error('Failed to create table');
  return newTable.id; // This is the tableId
};
