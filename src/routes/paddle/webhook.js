// /routes/paddle/webhook.js
import express from 'express';
import Airtable from 'airtable';
import dotenv from 'dotenv';

dotenv.config();
const router = express.Router();

// === Extracted reusable webhook handler ===
export const webhookHandler = async (event) => {
  const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.MASTER_BASE_ID);

  // Handle subscription creation (payment completed)
  if (event.event_type === 'subscription.created') {
    const subscription = event.data;
    console.log('[PADDLE WEBHOOK] Subscription created:', subscription.id);

    const restaurantId = subscription.custom_data?.restaurantId;
    if (!restaurantId) {
      console.warn('[PADDLE WEBHOOK] Missing restaurantId in custom_data.');
      return;
    }

    try {
      const record = await base('restaurantMap').find(restaurantId);

      // Update restaurant record to active
      await base('restaurantMap').update(record.id, {
        status: 'active',
        paddleCustomerId: subscription.customer_id || '',
        subscriptionId: subscription.id || '',
        paymentDate: new Date().toISOString()
      });
      console.log('[PADDLE WEBHOOK] Updated account to active for:', restaurantId);
    } catch (airtableErr) {
      console.error('[PADDLE WEBHOOK] Failed to update Airtable:', airtableErr);
    }
  }

  // Handle subscription cancellations
  if (event.event_type === 'subscription.cancelled') {
    const subscription = event.data;
    const paddleCustomerId = subscription.customer_id;

    try {
      const records = await base('restaurantMap')
        .select({ filterByFormula: `{paddleCustomerId} = '${paddleCustomerId}'` })
        .firstPage();

      if (records.length > 0) {
        await base('restaurantMap').update(records[0].id, { 
          status: 'expired',
          restaurantId: '' // Clear restaurantId to disable access but keep data
        });
        console.log('[PADDLE WEBHOOK] Marked account expired and cleared restaurantId for customer:', paddleCustomerId);
      } else {
        console.warn('[PADDLE WEBHOOK] No matching record found for customer:', paddleCustomerId);
      }
    } catch (err) {
      console.error('[PADDLE WEBHOOK] Failed to mark account expired:', err);
    }
  }
};

// === Live webhook endpoint (Paddle calls this) ===
router.post(
  '/webhook',
  express.json(),
  async (req, res) => {
    try {
      const event = req.body;
      console.log('[PADDLE WEBHOOK] Received event:', event.event_type);
      
      await webhookHandler(event);
      res.status(200).json({ message: 'Webhook processed successfully' });
    } catch (err) {
      console.error('[PADDLE WEBHOOK] Processing failed:', err.message);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
);

export default router;
