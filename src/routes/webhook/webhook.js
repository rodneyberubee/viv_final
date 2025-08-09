// /routes/webhook/webhook.js
import express from 'express';
import Airtable from 'airtable';
import dotenv from 'dotenv';

dotenv.config();
const router = express.Router();

const getBase = () =>
  new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.MASTER_BASE_ID);

// escape single quotes for Airtable formulas
const esc = (s = '') => String(s).replace(/'/g, "\\'");

// === Paddle webhook handler ===
export const webhookHandler = async (event) => {
  const base = getBase();

  if (event.event_type === 'subscription.created') {
    const subscription = event.data;
    console.log('[PADDLE WEBHOOK] Subscription created:', subscription?.id);

    const restaurantId = subscription?.custom_data?.restaurantId;
    if (!restaurantId) {
      console.warn('[PADDLE WEBHOOK] Missing restaurantId in custom_data.');
      return;
    }

    try {
      // FIX: look up by field value, not record ID
      const records = await base('restaurantMap')
        .select({ filterByFormula: `{restaurantId} = '${esc(restaurantId)}'` })
        .firstPage();

      if (!records.length) {
        console.warn('[PADDLE WEBHOOK] No record for restaurantId:', restaurantId);
        return;
      }

      await base('restaurantMap').update(records[0].id, {
        status: 'active',
        paddleCustomerId: subscription.customer_id || '',
        subscriptionId: subscription.id || '',
        paymentDate: new Date().toISOString(),
      });

      console.log('[PADDLE WEBHOOK] Updated account to active for:', restaurantId);
    } catch (airtableErr) {
      console.error('[PADDLE WEBHOOK] Failed to update Airtable:', airtableErr);
    }
  }

  if (event.event_type === 'subscription.cancelled') {
    const subscription = event.data;
    const paddleCustomerId = subscription?.customer_id;

    try {
      const records = await base('restaurantMap')
        .select({ filterByFormula: `{paddleCustomerId} = '${esc(paddleCustomerId)}'` })
        .firstPage();

      if (records.length > 0) {
        await base('restaurantMap').update(records[0].id, {
          status: 'expired',
          restaurantId: '', // disable access but keep data
        });
        console.log('[PADDLE WEBHOOK] Marked expired & cleared restaurantId for customer:', paddleCustomerId);
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
  const base = getBase();

  if (event.type === 'checkout.session.completed') {
    const session = event?.data?.object;
    const restaurantId = session?.metadata?.restaurantId;

    console.log('[STRIPE WEBHOOK] checkout.session.completed payload:', {
      sessionId: session?.id,
      restaurantId,
      customer: session?.customer,
      subscription: session?.subscription,
    });

    if (!restaurantId) {
      console.warn('[STRIPE WEBHOOK] Missing restaurantId in metadata.');
      return;
    }

    try {
      // Look up by restaurantId field
      const records = await base('restaurantMap')
        .select({ filterByFormula: `{restaurantId} = '${esc(restaurantId)}'` })
        .firstPage();

      if (!records.length) {
        console.warn('[STRIPE WEBHOOK] No record for restaurantId:', restaurantId);
        return;
      }

      await base('restaurantMap').update(records[0].id, {
        status: 'active',
        stripeCustomerId: session.customer || '',
        subscriptionId: session.subscription || '',
        paymentDate: new Date().toISOString(),
      });

      console.log('[STRIPE WEBHOOK] Activated account for:', restaurantId, 'recId:', records[0].id);
    } catch (airtableErr) {
      console.error('[STRIPE WEBHOOK] Failed to update Airtable:', airtableErr);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event?.data?.object;
    const stripeCustomerId = subscription?.customer;

    console.log('[STRIPE WEBHOOK] customer.subscription.deleted payload:', {
      subscriptionId: subscription?.id,
      stripeCustomerId,
    });

    if (!stripeCustomerId) {
      console.warn('[STRIPE WEBHOOK] Missing stripeCustomerId on deletion event.');
      return;
    }

    try {
      const records = await base('restaurantMap')
        .select({ filterByFormula: `{stripeCustomerId} = '${esc(stripeCustomerId)}'` })
        .firstPage();

      if (!records.length) {
        console.warn('[STRIPE WEBHOOK] No record for stripeCustomerId:', stripeCustomerId);
        return;
      }

      await base('restaurantMap').update(records[0].id, {
        status: 'expired',
        restaurantId: '', // optional: disable access but keep data
      });

      console.log('[STRIPE WEBHOOK] Marked expired for customer:', stripeCustomerId, 'recId:', records[0].id);
    } catch (err) {
      console.error('[STRIPE WEBHOOK] Failed to mark account expired:', err);
    }
  }
};

// === Combined webhook endpoint that detects provider ===
router.post(
  '/webhook', // keep as-is to preserve /api/webhook/webhook
  express.json(),
  async (req, res) => {
    try {
      const event = req.body;

      if (event?.event_type) {
        console.log('[WEBHOOK] Received Paddle event:', event.event_type);
        await webhookHandler(event);
      } else if (event?.type) {
        console.log('[WEBHOOK] Received Stripe event:', event.type);
        await stripeWebhookHandler(event);
      } else {
        console.warn('[WEBHOOK] Unknown webhook format received');
      }

      res.status(200).json({ message: 'Webhook processed successfully' });
    } catch (err) {
      console.error('[WEBHOOK] Processing failed:', err?.message || err);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
);

export default router;
