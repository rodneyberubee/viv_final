import { Resend } from 'resend';
import Airtable from 'airtable';

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendConfirmationEmail = async ({ type, confirmationCode, config }) => {
  try {
    const { baseId, tableName } = config;
    const airtable = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(baseId);

    const records = await airtable(tableName)
      .select({
        filterByFormula: `{rawConfirmationCode} = '${confirmationCode}'`,
        maxRecords: 1
      })
      .all();

    if (records.length === 0) {
      console.error('[EMAIL ERROR] No record found for confirmation:', confirmationCode);
      return;
    }

    const record = records[0];
    const { name, contactInfo, date, timeSlot, partySize } = record.fields;

    // ✅ Fix: support both object or string-based contactInfo
    const email =
      typeof contactInfo === 'string'
        ? contactInfo
        : contactInfo?.email;

    if (!email) {
      console.error('[EMAIL ERROR] No valid email address found in contactInfo:', contactInfo);
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
          <p>If you need to makes changes, please visit my site again with your confirmation code.</p>
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
      to: email,
      subject,
      html
    });

    console.log(`[EMAIL] ${type} email sent to ${email}`);
  } catch (err) {
    console.error('[EMAIL ERROR]', err);
  }
};
