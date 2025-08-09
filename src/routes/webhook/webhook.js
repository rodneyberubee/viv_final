// /routes/webhook/webhook.js
import express from 'express';
import Airtable from 'airtable';
import dotenv from 'dotenv';

dotenv.config();
const router = express.Router();

const TABLE = 'restaurantMap';

const getBase = () =>
  new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.MASTER_BASE_ID);

// Escape single quotes for Airtable formulas
const esc = (s = '') => String(s).replace(/'/g, "\\'");

// === Paddle webhook handler ===
export const webhookHandler = async (event) => {
  const base = getBase();

  if (event?.event_type === 'subscription.created') {
    const subscription = event.data;
    console.log('[PADDLE] subscription.created', { subId: subscription?.id });

    const restaurantId = subscription?.custom_data?.restaurantId;
    if (!restaurantId) {
      console.warn('[PADDLE] Missing restaurantId in custom_data');
      return;
    }

    try {
      // Look up by field value, not record ID
      const formula = `{restaurantId} = '${esc(restaurantId)}'`;
      const records = await base(TABLE).select({ filterByFormula: formula }).firstPage();
      console.log('[PADDLE] select length:', records.length);

      if (!records.length) {
        console.warn('[PADDLE] No record for restaurantId:', restaurantId);
        return;
      }

      await base(TABLE).update(records[0].id, {
        status: 'active',
        paddleCustomerId: subscription?.customer_id || '',
        subscriptionId: subscription?.id || '',
        paymentDate: new Date().toISOString(),
      });

      console.log('[PADDLE] Activated for restaurantId:', restaurantId, 'recId:', records[0].id);
    } catch (err) {
      console.error('[PADDLE] Airtable update error:', err);
    }
  }

  if (event?.event_type === 'subscription.cancelled') {
    const subscription = event.data;
    const paddleCustomerId = subscription?.customer_id;
    console.log('[PADDLE] subscription.cancelled', { paddleCustomerId });

    try {
      const formula = `{paddleCustomerId} = '${esc(paddleCustomerId)}'`;
      const records = await base(TABLE).select({ filterByFormula: formula }).firstPage();
      console.log('[PADDLE] select (cancel) length:', records.length);

      if (!records.length) {
        console.warn('[PADDLE] No matching record for customer:', paddleCustomerId);
        return;
      }

      await base(TABLE).update(records[0].id, {
        status: 'expired',
        restaurantId: '', // disable access but keep data
      });

      console.log('[PADDLE] Marked expired & cleared restaurantId for customer:', paddleCustomerId);
    } catch (err) {
      console.error('[PADDLE] Airtable expire error:', err);
    }
  }
};

// === Stripe webhook handler ===
export const stripeWebhookHandler = async (event) => {
  const baseId = process.env.MASTER_BASE_ID;
  const base = getBase();

  if (event?.type === 'checkout.session.completed') {
    const session = event?.data?.object;
    const restaurantId = session?.metadata?.restaurantId;

    console.log('[STRIPE] checkout.session.completed', {
      baseIdLast6: baseId?.slice(-6),
      sessionId: session?.id,
      restaurantId,
      customer: session?.customer,
      subscription: session?.subscription,
    });

    if (!restaurantId) {
      console.warn('[STRIPE] Missing restaurantId in metadata');
      return;
    }

    try {
      // Look up by restaurantId field
      const formula = `{restaurantId} = '${esc(restaurantId)}'`;
      console.log('[STRIPE] select formula:', formula);
      const records = await base(TABLE).select({ filterByFormula: formula }).firstPage();
      console.log('[STRIPE] records length:', records.length, records.map(r => r.id));

      if (!records.length) {
        console.warn('[STRIPE] No record for restaurantId:', restaurantId);
        return;
      }

      await base(TABLE).update(records[0].id, {
        status: 'active',
        stripeCustomerId: session?.customer || '',
        subscriptionId: session?.subscription || '',
        paymentDate: new Date().toISOString(),
      });

      console.log('[STRIPE] Activated account for:', restaurantId, 'recId:', records[0].id);
    } catch (err) {
      console.error('[STRIPE] Airtable update error:', err);
    }
  }

  if (event?.type === 'customer.subscription.deleted') {
    const subscription = event?.data?.object;
    const stripeCustomerId = subscription?.customer;

    console.log('[STRIPE] customer.subscription.deleted', {
      baseIdLast6: baseId?.slice(-6),
      subscriptionId: subscription?.id,
      stripeCustomerId,
    });

    if (!stripeCustomerId) {
      console.warn('[STRIPE] Missing stripeCustomerId on deletion event');
      return;
    }

    try {
      const formula = `{stripeCustomerId} = '${esc(stripeCustomerId)}'`;
      const records = await base(TABLE).select({ filterByFormula: formula }).firstPage();
      console.log('[STRIPE] records length (delete):', records.length, records.map(r => r.id));

      if (!records.length) {
        console.warn('[STRIPE] No record for stripeCustomerId:', stripeCustomerId);
        return;
      }

      await base(TABLE).update(records[0].id, {
        status: 'expired',
        restaurantId: '', // optional: disable access but keep data
      });

      console.log('[STRIPE] Marked expired for customer:', stripeCustomerId, 'recId:', records[0].id);
    } catch (err) {
      console.error('[STRIPE] Airtable expire error:', err);
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
        console.log('[WEBHOOK] Paddle event:', event.event_type);
        await webhookHandler(event);
      } else if (event?.type) {
        console.log('[WEBHOOK] Stripe event:', event.type);
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

// Quick probe: verify we can SELECT and UPDATE the row Airtable sees.
router.get('/_probe/:restaurantId', async (req, res) => {
  try {
    const baseId = process.env.MASTER_BASE_ID;
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(baseId);
    const esc = (s='') => String(s).replace(/'/g, "\\'");
    const restaurantId = req.params.restaurantId;

    const formula = `{restaurantId} = '${esc(restaurantId)}'`;
    const records = await base('restaurantMap').select({ filterByFormula: formula }).firstPage();

    if (!records.length) {
      return res.status(200).json({
        ok: false,
        reason: 'no_match',
        baseIdLast6: baseId?.slice(-6),
        table: 'restaurantMap',
        field: 'restaurantId',
        formula,
        records: 0
      });
    }

    const recId = records[0].id;

    // Try a no-op-ish update to prove write perms.
    const updated = await base('restaurantMap').update(recId, {
      status: 'active',
      stripeCustomerId: 'cus_probe',
      subscriptionId: 'sub_probe',
      paymentDate: new Date().toISOString()
    });

    return res.status(200).json({
      ok: true,
      baseIdLast6: baseId?.slice(-6),
      recId,
      wrote: {
        status: updated.fields.status,
        stripeCustomerId: updated.fields.stripeCustomerId,
        subscriptionId: updated.fields.subscriptionId,
        paymentDate: updated.fields.paymentDate
      }
    });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: 'error', message: e?.message, stack: e?.stack });
  }
});

export default router;
