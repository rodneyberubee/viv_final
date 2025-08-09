// /routes/stripe/createCheckoutSession.js
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

export const createStripeCheckoutSession = async (req, res) => {
  try {
    const { restaurantId, email } = req.body;

    if (!restaurantId || !email) {
      console.error('[ERROR] Missing restaurantId or email for checkout session');
      return res.status(400).json({ error: 'missing_required_fields' });
    }

    if (!process.env.STRIPE_SUBSCRIPTION_PRICE_ID) {
      console.error('[ENV ERROR] STRIPE_SUBSCRIPTION_PRICE_ID not set');
      return res.status(500).json({ error: 'server_config_error' });
    }

    // Create the checkout session
    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'mode': 'subscription',
        'line_items[0][price]': process.env.STRIPE_SUBSCRIPTION_PRICE_ID,
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

    console.log('[STRIPE] Checkout session created for restaurant:', restaurantId);

    return res.status(200).json({ url: stripeData.url });
  } catch (error) {
    console.error('[STRIPE] Failed to create checkout session:', error);
    return res.status(500).json({ error: 'failed_to_create_session', details: error.message });
  }
};
