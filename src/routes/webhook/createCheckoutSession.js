// /routes/webhook/createCheckoutSession.js
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

// === Paddle checkout session handler ===
export const createCheckoutSession = async (req, res) => {
  try {
    // Accept either new recordId param or legacy restaurantId field value
    const { restaurantRecordId, restaurantId: legacyRestaurantId, email } = req.body;

    const joinId = restaurantRecordId || legacyRestaurantId; // prefer Airtable recordId (rec...)
    if (!joinId || !email) {
      console.error('[ERROR] Missing recordId (or restaurantId) or email for checkout session');
      return res.status(400).json({ error: 'missing_required_fields' });
    }

    if (!process.env.PADDLE_SUBSCRIPTION_PRICE_ID) {
      console.error('[ENV ERROR] PADDLE_SUBSCRIPTION_PRICE_ID not set');
      return res.status(500).json({ error: 'server_config_error' });
    }
    if (!process.env.FRONTEND_URL) {
      console.error('[ENV ERROR] FRONTEND_URL not set');
      return res.status(500).json({ error: 'server_config_error' });
    }

    // Create the checkout session
    const paddleResponse = await fetch('https://api.paddle.com/transactions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.PADDLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [{ price_id: process.env.PADDLE_SUBSCRIPTION_PRICE_ID, quantity: 1 }],
        customer: { email },
        // ✅ send Airtable recordId as the canonical key; keep legacy for backwards compat (optional)
        custom_data: {
          airtableRecordId: joinId,
          restaurantId: legacyRestaurantId || undefined
        },
        checkout: { url: `${process.env.FRONTEND_URL}/onboarding/success` },
        settings: {
          success_url: `${process.env.FRONTEND_URL}/onboarding/success?transaction_id={transaction_id}`,
          cancel_url: `${process.env.FRONTEND_URL}/onboarding/cancelled`,
        },
      }),
    });

    const paddleData = await paddleResponse.json();
    if (!paddleResponse.ok) {
      console.error('[PADDLE] API error body:', paddleData);
      throw new Error(`Paddle API error: ${paddleResponse.status}`);
    }

    console.log('[PADDLE] Checkout session created for recId:', joinId);
    return res.status(200).json({ url: paddleData?.data?.checkout?.url });
  } catch (error) {
    console.error('[PADDLE] Failed to create checkout session:', error);
    return res.status(500).json({ error: 'failed_to_create_session', details: error.message });
  }
};

// === Stripe checkout session handler ===
export const createStripeCheckoutSession = async (req, res) => {
  try {
    // Accept either new recordId param or legacy restaurantId field value
    const { restaurantRecordId, restaurantId: legacyRestaurantId, email, mode } = req.body;

    const joinId = restaurantRecordId || legacyRestaurantId; // prefer Airtable recordId (rec...)
    if (!joinId || !email) {
      console.error('[ERROR] Missing recordId (or restaurantId) or email for checkout session');
      return res.status(400).json({ error: 'missing_required_fields' });
    }

    // Decide which Stripe lane to use
    const resolvedMode = (mode || process.env.MODE || 'live').toLowerCase();
    const isLive = resolvedMode === 'live';
    console.log(`[STRIPE] create-checkout-session resolvedMode=${resolvedMode} joinId=${joinId}`);

    const stripeSecretKey = isLive
      ? process.env.STRIPE_SECRET_KEY
      : process.env.STRIPE_SECRET_KEY_TEST;

    const stripePriceId = isLive
      ? process.env.STRIPE_SUBSCRIPTION_PRICE_ID
      : process.env.STRIPE_SUBSCRIPTION_PRICE_ID_TEST;

    if (!stripeSecretKey) {
      console.error(`[ENV ERROR] Missing ${isLive ? 'STRIPE_SECRET_KEY' : 'STRIPE_SECRET_KEY_TEST'}`);
      return res.status(500).json({ error: 'server_config_error', details: 'missing_stripe_secret' });
    }
    if (!stripePriceId) {
      console.error(`[ENV ERROR] Missing ${isLive ? 'STRIPE_SUBSCRIPTION_PRICE_ID' : 'STRIPE_SUBSCRIPTION_PRICE_ID_TEST'}`);
      return res.status(500).json({ error: 'server_config_error', details: 'missing_stripe_price' });
    }
    if (!process.env.FRONTEND_URL) {
      console.error('[ENV ERROR] FRONTEND_URL not set');
      return res.status(500).json({ error: 'server_config_error', details: 'missing_frontend_url' });
    }

    // ✅ Create the Checkout Session (not a Payment Link)
    // Store Airtable recordId as the canonical join key in metadata
    const params = new URLSearchParams({
      'mode': 'subscription',
      'line_items[0][price]': stripePriceId,
      'line_items[0][quantity]': '1',
      'customer_email': email,

      // ✅ Canonical join keys in Stripe
      'metadata[airtableRecordId]': joinId,
      'client_reference_id': joinId,

      // Ensure subscription webhooks (created/updated/deleted) also carry the key
      'subscription_data[metadata][airtableRecordId]': joinId,

      // Optional: also include legacy field for a while if you want dual support
      ...(legacyRestaurantId ? { 'metadata[restaurantId]': legacyRestaurantId } : {}),

      'success_url': `${process.env.FRONTEND_URL}/onboarding/success?session_id={CHECKOUT_SESSION_ID}`,
      'cancel_url': `${process.env.FRONTEND_URL}/onboarding/cancelled`,
    });

    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });

    const stripeData = await stripeResponse.json();
    if (!stripeResponse.ok) {
      console.error('[STRIPE] API error body:', stripeData);
      throw new Error(`Stripe API error: ${stripeResponse.status}`);
    }

    console.log(`[STRIPE] Checkout session created for recId: ${joinId} in ${isLive ? 'LIVE' : 'TEST'} mode`);
    console.log('[STRIPE] Checkout URL:', stripeData.url, 'sessionId:', stripeData.id);

    // Return the URL so the frontend redirects to THIS (not a Payment Link)
    return res.status(200).json({ url: stripeData.url, sessionId: stripeData.id, mode: resolvedMode });
  } catch (error) {
    console.error('[STRIPE] Failed to create checkout session:', error);
    return res.status(500).json({ error: 'failed_to_create_session', details: error.message });
  }
};
