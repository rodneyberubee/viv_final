import { Resend } from 'resend';
import { getAirtableRecordByConfirmation } from '../utils/airtableHelpers.js';

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendConfirmationEmail = async ({ type, confirmationCode, config }) => {
  try {
    const { baseId, tableName } = config;
    const record = await getAirtableRecordByConfirmation(baseId, tableName, confirmationCode);

    if (!record) {
      console.error('[EMAIL ERROR] No record found for confirmation:', confirmationCode);
      return;
    }

    const { name, contactInfo, date, timeSlot, partySize } = record.fields;

    if (!contactInfo?.email) {
      console.error('[EMAIL ERROR] No email address found in contactInfo:', contactInfo);
      return;
    }

    let subject, html;

    switch (type) {
      case 'reservation':
        subject = `Your Reservation is Confirmed`;
        html = `
          <p>Hi ${name},</p>
          <p>Your reservation is confirmed:</p>
          <ul>
            <li><strong>Date:</strong> ${date}</li>
            <li><strong>Time:</strong> ${timeSlot}</li>
            <li><strong>Party Size:</strong> ${partySize}</li>
            <li><strong>Confirmation Code:</strong> ${confirmationCode}</li>
          </ul>
          <p>Reply to this email if you need to change or cancel.</p>
          <p>– Viv, your AI reservationist</p>
        `;
        break;

      case 'change':
        subject = `Your Reservation Has Been Updated`;
        html = `
          <p>Hi ${name},</p>
          <p>Your reservation has been updated:</p>
          <ul>
            <li><strong>New Date:</strong> ${date}</li>
            <li><strong>New Time:</strong> ${timeSlot}</li>
            <li><strong>Party Size:</strong> ${partySize}</li>
            <li><strong>Confirmation Code:</strong> ${confirmationCode}</li>
          </ul>
          <p>If this looks incorrect, reply to fix it.</p>
          <p>– Viv</p>
        `;
        break;

      case 'cancel':
        subject = `Your Reservation Has Been Canceled`;
        html = `
          <p>Hi ${name},</p>
          <p>Your reservation has been successfully canceled.</p>
          <p>Confirmation Code: <strong>${confirmationCode}</strong></p>
          <p>We hope to see you again soon.</p>
          <p>– Viv</p>
        `;
        break;

      default:
        console.error('[EMAIL ERROR] Unknown type:', type);
        return;
    }

    await resend.emails.send({
      from: 'reservation@vivaitable.com',
      to: contactInfo.email,
      subject,
      html
    });

    console.log(`[EMAIL] ${type} email sent to ${contactInfo.email}`);
  } catch (err) {
    console.error('[EMAIL ERROR]', err);
  }
};
