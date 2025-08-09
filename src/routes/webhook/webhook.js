// /routes/webhook/webhook.js
import express from 'express';
import Airtable from 'airtable';
import dotenv from 'dotenv';

dotenv.config();
const router = express.Router();

// === Paddle webhook handler ===
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

// === Stripe webhook handler ===
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
      const records = await base('restaurantMap')
        .select({ filterByFormula: `{restaurantId} = '${restaurantId}'` })
        .firstPage();

      if (!records.length) {
        console.warn('[STRIPE WEBHOOK] No record for restaurantId:', restaurantId);
        return;
      }

      await base('restaurantMap').update(records[0].id, {
        status: 'active',
        stripeCustomerId: session.customer || '',
        subscriptionId: session.subscription || '',
        paymentDate: new Date().toISOString()
      });
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

// === Combined webhook endpoint that detects provider ===
router.post(
  '/webhook',
  express.json(),
  async (req, res) => {
    try {
      const event = req.body;
      
      // Detect provider and route accordingly
      if (event.event_type) {
        // Paddle webhook (has event_type)
        console.log('[WEBHOOK] Received Paddle event:', event.event_type);
        await webhookHandler(event);
      } else if (event.type) {
        // Stripe webhook (has type)
        console.log('[WEBHOOK] Received Stripe event:', event.type);
        await stripeWebhookHandler(event);
      } else {
        console.warn('[WEBHOOK] Unknown webhook format received');
      }
      
      res.status(200).json({ message: 'Webhook processed successfully' });
    } catch (err) {
      console.error('[WEBHOOK] Processing failed:', err.message);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
);

export default router;
