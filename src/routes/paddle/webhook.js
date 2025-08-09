// /routes/stripe/webhook.js
import express from 'express';
import Airtable from 'airtable';
import dotenv from 'dotenv';

dotenv.config();
const router = express.Router();

// === Extracted reusable webhook handler ===
export const stripeWebhookHandler = async (event) => {
  const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.MASTER_BASE_ID);

  // Handle checkout session completion (payment completed)
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('[STRIPE WEBHOOK] Checkout session completed:', session.id);

    const restaurantId = session.metadata?.restaurantId;
    if (!restaurantId) {
      console.warn('[STRIPE WEBHOOK] Missing restaurantId in metadata.');
      return;
    }

    try {
      const record = await base('restaurantMap').find(restaurantId);

      // Update restaurant record to active
      await base('restaurantMap').update(record.id, {
        status: 'active',
        stripeCustomerId: session.customer || '',
        subscriptionId: session.subscription || '',
        paymentDate: new Date().toISOString()
      });
      console.log('[STRIPE WEBHOOK] Updated account to active for:', restaurantId);
    } catch (airtableErr) {
      console.error('[STRIPE WEBHOOK] Failed to update Airtable:', airtableErr);
    }
  }

  // Handle subscription cancellations
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const stripeCustomerId = subscription.customer;

    try {
      const records = await base('restaurantMap')
        .select({ filterByFormula: `{stripeCustomerId} = '${stripeCustomerId}'` })
        .firstPage();

      if (records.length > 0) {
        await base('restaurantMap').update(records[0].id, { 
          status: 'expired',
          restaurantId: '' // Clear restaurantId to disable access but keep data
        });
        console.log('[STRIPE WEBHOOK] Marked account expired and cleared restaurantId for customer:', stripeCustomerId);
      } else {
        console.warn('[STRIPE WEBHOOK] No matching record found for customer:', stripeCustomerId);
      }
    } catch (err) {
      console.error('[STRIPE WEBHOOK] Failed to mark account expired:', err);
    }
  }
};

// === Live webhook endpoint (Stripe calls this) ===
router.post(
  '/webhook',
  express.json(),
  async (req, res) => {
    try {
      const event = req.body;
      console.log('[STRIPE WEBHOOK] Received event:', event.type);
      
      await stripeWebhookHandler(event);
      res.status(200).json({ message: 'Webhook processed successfully' });
    } catch (err) {
      console.error('[STRIPE WEBHOOK] Processing failed:', err.message);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
);

export default router;
