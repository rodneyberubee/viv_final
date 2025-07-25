import { DateTime } from 'luxon';

/**
 * Parse date + time into a Luxon DateTime object.
 */
export const parseDateTime = (date, time, timeZone = 'UTC') => {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone: timeZone });
  return dt.isValid ? dt : null;
};

/**
 * Parse a date from various formats and normalize to YYYY-MM-DD.
 */
export const parseFlexibleDate = (rawDate, year = DateTime.now().year, timeZone = 'UTC') => {
  if (!rawDate || typeof rawDate !== 'string') return null;
  const formats = ['yyyy-MM-dd', 'd MMMM', 'MMMM d', 'd MMM', 'MMM d'];
  for (const fmt of formats) {
    const dt = DateTime.fromFormat(rawDate, fmt, { zone: timeZone });
    if (dt.isValid) return dt.set({ year }).toFormat('yyyy-MM-dd');
  }
  return null;
};

/**
 * Parse a time from multiple input formats and normalize to HH:mm.
 */
export const parseFlexibleTime = (rawTime, timeZone = 'UTC') => {
  if (!rawTime || typeof rawTime !== 'string') return null;
  const cleaned = rawTime.trim().toUpperCase().replace(/\./g, '').replace(/\s+/g, '');
  const withSpace = cleaned.replace(/(AM|PM)/, ' $1');
  const formats = ['h:mm a', 'h a', 'H:mm', 'H', 'HH:mm'];
  for (const fmt of formats) {
    const dt = DateTime.fromFormat(withSpace, fmt, { zone: timeZone });
    if (dt.isValid) return dt.toFormat('HH:mm');
  }
  return null;
};

/**
 * Get the current DateTime in a given zone.
 */
export const getCurrentDateTime = (timeZone = 'UTC') => DateTime.now().setZone(timeZone);

/**
 * Determine if a given date+time is in the past relative to now in the same zone.
 */
export const isPast = (date, time, timeZone = 'UTC') => {
  const now = getCurrentDateTime(timeZone);
  const dt = parseDateTime(date, time, timeZone);
  return dt && dt < now;
};

/**
 * Format DateTime for display or storage.
 */
export const formatDateTime = (dt, format = 'yyyy-MM-dd HH:mm') => {
  return dt && dt.isValid ? dt.toFormat(format) : null;
};
