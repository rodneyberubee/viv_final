// /routes/webhook/createCheckoutSession.js
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

// === Paddle checkout session handler ===
export const createCheckoutSession = async (req, res) => {
  try {
    const { restaurantId, email } = req.body;

    if (!restaurantId || !email) {
      console.error('[ERROR] Missing restaurantId or email for checkout session');
      return res.status(400).json({ error: 'missing_required_fields' });
    }

    if (!process.env.PADDLE_SUBSCRIPTION_PRICE_ID) {
      console.error('[ENV ERROR] PADDLE_SUBSCRIPTION_PRICE_ID not set');
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
        items: [
          {
            price_id: process.env.PADDLE_SUBSCRIPTION_PRICE_ID,
            quantity: 1,
          },
        ],
        customer: {
          email: email,
        },
        custom_data: {
          restaurantId: restaurantId,
        },
        checkout: {
          url: `${process.env.FRONTEND_URL}/onboarding/success`,
        },
        settings: {
          success_url: `${process.env.FRONTEND_URL}/onboarding/success?transaction_id={transaction_id}`,
          cancel_url: `${process.env.FRONTEND_URL}/onboarding/cancelled`,
        },
      }),
    });

    const paddleData = await paddleResponse.json();

    if (!paddleResponse.ok) {
      throw new Error(`Paddle API error: ${JSON.stringify(paddleData)}`);
    }

    console.log('[PADDLE] Checkout session created for restaurant:', restaurantId);

    return res.status(200).json({ url: paddleData.data.checkout.url });
  } catch (error) {
    console.error('[PADDLE] Failed to create checkout session:', error);
    return res.status(500).json({ error: 'failed_to_create_session', details: error.message });
  }
};

// === Stripe checkout session handler ===
export const createStripeCheckoutSession = async (req, res) => {
  try {
    const { restaurantId, email, mode } = req.body;

    if (!restaurantId || !email) {
      console.error('[ERROR] Missing restaurantId or email for checkout session');
      return res.status(400).json({ error: 'missing_required_fields' });
    }

    // Decide which Stripe lane to use
    const resolvedMode = (mode || process.env.MODE || 'live').toLowerCase();
    const isLive = resolvedMode === 'live';

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

    // Create the checkout session
    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'mode': 'subscription',
        'line_items[0][price]': stripePriceId,
        'line_items[0][quantity]': '1',
        'customer_email': email,
        'metadata[restaurantId]': restaurantId,
        'success_url': `${process.env.FRONTEND_URL}/onboarding/success?session_id={CHECKOUT_SESSION_ID}`,
        'cancel_url': `${process.env.FRONTEND_URL}/onboarding/cancelled`,
      }),
    });

    const stripeData = await stripeResponse.json();

    if (!stripeResponse.ok) {
      throw new Error(`Stripe API error: ${JSON.stringify(stripeData)}`);
    }

    console.log(`[STRIPE] Checkout session created for restaurant: ${restaurantId} in ${isLive ? 'LIVE' : 'TEST'} mode`);

    return res.status(200).json({ url: stripeData.url });
  } catch (error) {
    console.error('[STRIPE] Failed to create checkout session:', error);
    return res.status(500).json({ error: 'failed_to_create_session', details: error.message });
  }
};
