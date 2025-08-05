// /routes/stripe/webhook.js
import express from 'express';
import Stripe from 'stripe';
import Airtable from 'airtable';
import dotenv from 'dotenv';
import { createReservationTable } from '../../helpers/createReservationTable.js';

dotenv.config();
const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('[STRIPE WEBHOOK] Signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.MASTER_BASE_ID);

    // Handle checkout completion
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      console.log('[STRIPE WEBHOOK] Checkout completed:', session.id);

      const restaurantId = session.metadata?.restaurantId;
      if (!restaurantId) {
        console.warn('[STRIPE WEBHOOK] Missing restaurantId in metadata.');
        return res.status(200).send('No action taken.');
      }

      try {
        const record = await base('restaurantMap').find(restaurantId);

        // 1. Create a new reservations table for this restaurant
        let newTableId;
        try {
          newTableId = await createReservationTable(
            process.env.MASTER_BASE_ID,
            `${restaurantId}_reservations`
          );
          console.log('[STRIPE WEBHOOK] Created new reservations table:', newTableId);
        } catch (err) {
          console.error('[STRIPE WEBHOOK] Failed to create reservations table:', err);
          return res.status(500).send('Failed to create reservations table');
        }

        // 2. Update restaurant record
        await base('restaurantMap').update(record.id, {
          status: 'active',
          stripeCustomerId: session.customer || '',
          subscriptionId: session.subscription || '',
          paymentDate: new Date().toISOString(),
          tableId: newTableId
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
        }
      } catch (err) {
        console.error('[STRIPE WEBHOOK] Failed to mark account expired:', err);
      }
    }

    res.status(200).send('Webhook received');
  }
);

export default router;
