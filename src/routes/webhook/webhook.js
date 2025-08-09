// /routes/webhook/webhook.js
import express from 'express';
import Airtable from 'airtable';
import dotenv from 'dotenv';
import Stripe from 'stripe';

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
    const recId = subscription?.custom_data?.airtableRecordId;        // ✅ prefer recordId
    const restaurantId = subscription?.custom_data?.restaurantId;      // fallback (legacy)

    console.log('[PADDLE] subscription.created', {
      subId: subscription?.id,
      recId,
      restaurantIdFallback: !!restaurantId
    });

    try {
      let rec = null;

      if (recId && /^rec[a-zA-Z0-9]{14,}$/.test(recId)) {
        // ✅ direct fetch by recordId
        rec = await base(TABLE).find(recId);
      } else if (restaurantId) {
        // legacy fallback by field
        const formula = `{restaurantId} = '${esc(restaurantId)}'`;
        const records = await base(TABLE).select({ filterByFormula: formula }).firstPage();
        rec = records[0];
      } else {
        console.warn('[PADDLE] Missing airtableRecordId/restaurantId in custom_data');
        return;
      }

      if (!rec) {
        console.warn('[PADDLE] No Airtable record found.');
        return;
      }

      const nowDateOnly = new Date().toISOString().slice(0, 10);

      await base(TABLE).update(rec.id, {
        status: 'active',
        paddleCustomerId: subscription?.customer_id || '',
        subscriptionId: subscription?.id || '',
        paymentDate: nowDateOnly,
      });

      console.log('[PADDLE] Activated recId:', rec.id);
    } catch (err) {
      console.error('[PADDLE] Airtable update error:', err);
    }
  }

  if (event?.event_type === 'subscription.cancelled') {
    const subscription = event.data;
    const recId = subscription?.custom_data?.airtableRecordId;        // ✅ prefer recordId
    const paddleCustomerId = subscription?.customer_id;

    console.log('[PADDLE] subscription.cancelled', { recId, paddleCustomerId });

    try {
      let rec = null;

      if (recId && /^rec[a-zA-Z0-9]{14,}$/.test(recId)) {
        rec = await base(TABLE).find(recId);
      } else if (paddleCustomerId) {
        const formula = `{paddleCustomerId} = '${esc(paddleCustomerId)}'`;
        const records = await base(TABLE).select({ filterByFormula: formula }).firstPage();
        rec = records[0];
      }

      if (!rec) {
        console.warn('[PADDLE] No matching record for cancellation.');
        return;
      }

      await base(TABLE).update(rec.id, {
        status: 'expired',
        restaurantId: '', // optional: disable access but keep data
      });

      console.log('[PADDLE] Marked expired recId:', rec.id);
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
    const md = session?.metadata || {};
    const recId = md.airtableRecordId;                       // ✅ preferred
    const restaurantId = md.restaurantId;                    // legacy fallback

    console.log('[STRIPE] checkout.session.completed', {
      baseIdLast6: baseId?.slice(-6),
      sessionId: session?.id,
      recId,
      restaurantIdFallback: restaurantId,
      customer: session?.customer,
      subscription: session?.subscription,
      mode: event.livemode ? 'live' : 'test',
      eventId: event.id
    });

    try {
      let rec = null;

      if (recId && /^rec[a-zA-Z0-9]{14,}$/.test(recId)) {
        // ✅ direct fetch by recordId
        rec = await base(TABLE).find(recId);
      } else if (restaurantId) {
        // legacy fallback by field
        const formula = `{restaurantId} = '${esc(restaurantId)}'`;
        const records = await base(TABLE).select({ filterByFormula: formula }).firstPage();
        rec = records[0];
      } else {
        console.warn('[STRIPE] Missing airtableRecordId/restaurantId in metadata');
        return;
      }

      if (!rec) {
        console.warn('[STRIPE] No Airtable record found for session.');
        return;
      }

      const nowDateOnly = new Date().toISOString().slice(0, 10);

      await base(TABLE).update(rec.id, {
        status: 'active',
        stripeCustomerId: session?.customer || '',
        subscriptionId: session?.subscription || '',
        paymentDate: nowDateOnly,
        env: event.livemode ? 'live' : 'test',
        lastStripeEventId: event.id
      });

      console.log('[STRIPE] Activated recId:', rec.id);
    } catch (err) {
      console.error('[STRIPE] Airtable update error:', err);
    }
  }

  if (event?.type === 'customer.subscription.deleted') {
    const subscription = event?.data?.object;
    const mdSub = subscription?.metadata || {};
    const recIdFromMd = mdSub.airtableRecordId;              // ✅ preferred
    const stripeCustomerId = subscription?.customer;          // fallback

    console.log('[STRIPE] customer.subscription.deleted', {
      baseIdLast6: baseId?.slice(-6),
      subscriptionId: subscription?.id,
      recIdFromMd,
      stripeCustomerId,
      mode: event.livemode ? 'live' : 'test',
      eventId: event.id
    });

    try {
      let rec = null;

      if (recIdFromMd && /^rec[a-zA-Z0-9]{14,}$/.test(recIdFromMd)) {
        rec = await base(TABLE).find(recIdFromMd);
      } else if (stripeCustomerId) {
        // legacy fallback by customer id field
        const formula = `{stripeCustomerId} = '${esc(stripeCustomerId)}'`;
        const records = await base(TABLE).select({ filterByFormula: formula }).firstPage();
        rec = records[0];
      }

      if (!rec) {
        console.warn('[STRIPE] No record found for subscription deletion.');
        return;
      }

      await base(TABLE).update(rec.id, {
        status: 'expired',
        restaurantId: '', // optional
        env: event.livemode ? 'live' : 'test',
        lastStripeEventId: event.id
      });

      console.log('[STRIPE] Marked expired recId:', rec.id);
    } catch (err) {
      console.error('[STRIPE] Airtable expire error:', err);
    }
  }
};

// === NEW: verify Stripe event with either (live or test) secret ===
const verifyStripeEvent = (rawBody, signature) => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY_TEST || process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2024-06-20'
  });

  const candidates = [
    process.env.STRIPE_WEBHOOK_SECRET,        // live
    process.env.STRIPE_WEBHOOK_SECRET_TEST,   // test
  ].filter(Boolean);

  for (const secret of candidates) {
    try {
      return stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (_) {}
  }
  return null;
};

// === Combined webhook endpoint that detects provider ===
router.post(
  '/', // ✅ final path becomes /api/webhook (no double /webhook)
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      const sig = req.headers['stripe-signature'];

      // If Stripe signature header exists, treat as Stripe
      if (sig) {
        const event = verifyStripeEvent(req.body, sig);
        if (!event) {
          console.warn('[WEBHOOK] Stripe signature verification failed');
          return res.status(400).send('Invalid Stripe signature');
        }
        console.log('[WEBHOOK] Stripe event:', event.type, 'mode=', event.livemode ? 'live' : 'test');
        await stripeWebhookHandler(event);
        return res.status(200).json({ message: 'Stripe webhook processed' });
      }

      // Otherwise, try to parse as Paddle JSON
      const text = req.body?.toString?.('utf8') || '';
      const parsed = text ? JSON.parse(text) : {};
      if (parsed?.event_type) {
        console.log('[WEBHOOK] Paddle event:', parsed.event_type);
        await webhookHandler(parsed);
        return res.status(200).json({ message: 'Paddle webhook processed' });
      }

      console.warn('[WEBHOOK] Unknown webhook format received');
      return res.status(200).json({ message: 'No-op' });
    } catch (err) {
      console.error('[WEBHOOK] Processing failed:', err?.message || err);
      return res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
);

// Quick probe remains legacy-by-field; keep as-is or add an id-based variant if you want.
router.get('/_probe/:restaurantId', async (req, res) => {
  try {
    const baseId = process.env.MASTER_BASE_ID;
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(baseId);
    const escLocal = (s='') => String(s).replace(/'/g, "\\'");
    const restaurantId = req.params.restaurantId;

    const formula = `{restaurantId} = '${escLocal(restaurantId)}'`;
    const records = await base(TABLE).select({ filterByFormula: formula }).firstPage();

    if (!records.length) {
      return res.status(200).json({
        ok: false,
        reason: 'no_match',
        baseIdLast6: baseId?.slice(-6),
        table: TABLE,
        field: 'restaurantId',
        formula,
        records: 0
      });
    }

    const recId = records[0].id;
    const nowDateOnly = new Date().toISOString().slice(0, 10);

    const updated = await base(TABLE).update(recId, {
      status: 'active',
      stripeCustomerId: 'cus_probe',
      subscriptionId: 'sub_probe',
      paymentDate: nowDateOnly
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
