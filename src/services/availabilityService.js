import dayjs from 'dayjs';

export async function isSlotAvailable({ base, tableName, date, timeSlot, maxReservations }) {
  const records = await base(tableName)
    .select({
      filterByFormula: `AND({date} = '${date}', {timeSlot} = '${timeSlot}')`
    })
    .all();

  const blocked = records.some(record => {
    const status = record.fields.status?.toLowerCase();
    return status === 'blocked' || status === 'unavailable';
  });

  if (blocked) {
    return false;
  }

  const activeReservations = records.filter(record => {
    const status = record.fields.status?.toLowerCase();
    return status !== 'cancelled' && status !== 'blocked';
  });

  return activeReservations.length < maxReservations;
}
