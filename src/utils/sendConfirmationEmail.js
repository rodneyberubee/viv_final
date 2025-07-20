import { Resend } from 'resend';
import loadRestaurantConfig from '../utils/loadRestaurantConfig.js';
import { getAirtableRecordByConfirmation } from '../utils/airtableHelpers.js'; // if modular

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendConfirmationEmail = async ({ type, confirmationCode }) => {
  try {
    const { baseId, tableName } = await loadRestaurantConfigFromCode(confirmationCode);
    const record = await getAirtableRecordByConfirmation(baseId, tableName, confirmationCode);

    if (!record) {
      console.error('[EMAIL ERROR] No record found for confirmation:', confirmationCode);
      return;
    }

    const { name, contactInfo, date, timeSlot, partySize } = record.fields;

    let subject, html;

    switch (type) {
      case 'reservation':
        subject = `Your Reservation is Confirmed`;
        html = buildReservationHTML({ name, date, timeSlot, partySize, confirmationCode });
        break;

      case 'change':
        subject = `Your Reservation Has Been Updated`;
        html = buildChangeHTML({ name, date, timeSlot, partySize, confirmationCode });
        break;

      case 'cancel':
        subject = `Your Reservation Has Been Canceled`;
        html = buildCancelHTML({ name, confirmationCode });
        break;

      default:
        console.error('[EMAIL ERROR] Unknown type:', type);
        return;
    }

    await resend.emails.send({
      from: 'viv@yourdomain.com',
      to: contactInfo.email,
      subject,
      html
    });

    console.log(`[EMAIL] ${type} email sent to ${contactInfo.email}`);
  } catch (err) {
    console.error('[EMAIL ERROR]', err);
  }
};
