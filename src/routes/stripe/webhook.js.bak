// /routes/stripe/webhook.js
import express from 'express';
import Stripe from 'stripe';
import Airtable from 'airtable';
import dotenv from 'dotenv';
import { createReservationTable } from '../../helpers/createReservationTable.js'; // NEW: helper import

dotenv.config();
const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20'
});

// Raw body needed for Stripe signature verification
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('[STRIPE WEBHOOK] Signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle events
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      console.log('[STRIPE WEBHOOK] Checkout completed:', session.id);

      const customerEmail = session.customer_details?.email;
      const restaurantName = session.metadata?.restaurantName;

      if (!customerEmail || !restaurantName) {
        console.warn('[STRIPE WEBHOOK] Missing customer email or restaurant name in metadata.');
        return res.status(200).send('No action taken.');
      }

      // Update Airtable (mark account as paid/active & create table)
      try {
        const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
          .base(process.env.MASTER_BASE_ID);

        const records = await base('restaurantMap')
          .select({
            filterByFormula: `{email} = '${customerEmail}'`
          })
          .firstPage();

        if (records.length === 0) {
          console.warn('[STRIPE WEBHOOK] No matching account found for email:', customerEmail);
        } else {
          const recordId = records[0].id;
          const restaurantId = records[0].fields.restaurantId || restaurantName.toLowerCase().replace(/\s+/g, '');
          
          // 1. Create new reservations table
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

          // 2. Update the restaurantMap record
          await base('restaurantMap').update(recordId, {
            status: 'active',
            subscriptionId: session.subscription || '',
            paymentDate: new Date().toISOString(),
            tableId: newTableId
          });
          console.log('[STRIPE WEBHOOK] Updated account to active with tableId for:', customerEmail);
        }
      } catch (airtableErr) {
        console.error('[STRIPE WEBHOOK] Failed to update Airtable:', airtableErr);
      }
    }

    res.status(200).send('Webhook received');
  }
);

export default router;
