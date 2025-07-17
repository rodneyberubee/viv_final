import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Normalize a reservation date and time into UTC based on restaurant's timezone.
 * Ensures parsed date is valid and future-biased if needed.
 *
 * @param {string} date - ISO or YYYY-MM-DD format
 * @param {string} timeSlot - HH:mm (24-hour) format
 * @param {string} timezone - IANA timezone (e.g., America/Los_Angeles)
 * @returns {dayjs.Dayjs|null} UTC datetime object or null on failure
 */
export const normalizeDateTime = (date, timeSlot, timezone) => {
  try {
    const localTime = dayjs.tz(`${date} ${timeSlot}`, 'YYYY-MM-DD HH:mm', timezone);
    if (!localTime.isValid()) {
      console.error('[ERROR] Invalid datetime format for:', date, timeSlot);
      return null;
    }

    const now = dayjs().tz(timezone);
    let finalTime = localTime;

    if (finalTime.isBefore(now, 'minute')) {
      finalTime = finalTime.year(now.year() + 1);
    }

    return finalTime.utc();
  } catch (err) {
    console.error('[ERROR] normalizeDateTime failed:', err);
    return null;
  }
};
