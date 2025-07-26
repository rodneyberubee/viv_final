// /routes/account/createAccount.js
import Airtable from 'airtable';
import dotenv from 'dotenv';
import Stripe from 'stripe';
dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const createAccount = async (req, res) => {
  console.log('[DEBUG] createAccount called with body:', req.body);

  try {
    const {
      name,
      email,
      maxReservations,
      futureCutoff,
      timeZone,
      mondayOpen, mondayClose,
      tuesdayOpen, tuesdayClose,
      wednesdayOpen, wednesdayClose,
      thursdayOpen, thursdayClose,
      fridayOpen, fridayClose,
      saturdayOpen, saturdayClose,
      sundayOpen, sundayClose
    } = req.body;

    if (!name || !email) {
      console.error('[ERROR] Missing required fields');
      return res.status(400).json({ error: 'missing_required_fields' });
    }

    // Connect to Airtable
    if (!process.env.MASTER_BASE_ID || !process.env.AIRTABLE_API_KEY) {
      console.error('[ENV ERROR] Missing MASTER_BASE_ID or AIRTABLE_API_KEY');
      return res.status(500).json({ error: 'server_config_error' });
    }
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.MASTER_BASE_ID);

    // Only include fields Airtable expects (set status as 'pending' until Stripe payment succeeds)
    const fields = {
      name,
      email,
      status: 'pending', // <-- new field to track activation
      maxReservations: parseInt(maxReservations) || 10,
      futureCutoff: parseInt(futureCutoff) || 30,
      timeZone: timeZone || 'America/Los_Angeles',
      mondayOpen, mondayClose,
      tuesdayOpen, tuesdayClose,
      wednesdayOpen, wednesdayClose,
      thursdayOpen, thursdayClose,
      fridayOpen, fridayClose,
      saturdayOpen, saturdayClose,
      sundayOpen, sundayClose
    };

    console.log('[DEBUG] Creating Airtable record in table: tblSrsq6Tw4YYMWk2 with fields:', fields);
    const created = await base('tblSrsq6Tw4YYMWk2').create([{ fields }]);
    const createdId = created[0].id;
    console.log('[DEBUG] Created restaurantMap record (pending):', createdId);

    // Create a Stripe Checkout session for this new account
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: email,
      line_items: [
        {
          price: process.env.STRIPE_SUBSCRIPTION_PRICE_ID, // must be set in your Stripe dashboard
          quantity: 1,
        },
      ],
      success_url: `${process.env.FRONTEND_URL}/success?account=${createdId}`,
      cancel_url: `${process.env.FRONTEND_URL}/cancel?account=${createdId}`,
      metadata: {
        airtableRecordId: createdId,
      },
    });

    // Re-fetch the created record to get auto-generated fields
    const createdRecord = await base('tblSrsq6Tw4YYMWk2').find(createdId);
    const { restaurantId, slug, tableName } = createdRecord.fields;

    return res.status(201).json({
      message: 'account_created',
      restaurantId,
      slug,
      tableName,
      recordId: createdId,
      checkoutUrl: session.url, // <-- frontend will redirect here for payment
    });

  } catch (error) {
    console.error('[ERROR] Failed to create account:', error?.message || error);
    return res.status(500).json({ error: 'internal_server_error', details: error?.message || error });
  }
};
