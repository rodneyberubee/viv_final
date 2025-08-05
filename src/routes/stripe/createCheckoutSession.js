// /routes/stripe/createCheckoutSession.js
import Stripe from 'stripe';
import dotenv from 'dotenv';
dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

export const createCheckoutSession = async (req, res) => {
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
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: process.env.STRIPE_SUBSCRIPTION_PRICE_ID,
          quantity: 1,
        },
      ],
      customer_email: email,
      success_url: `${process.env.FRONTEND_URL}/onboarding/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/onboarding/cancelled`,
      metadata: {
        restaurantId,
      },
    });

    console.log('[STRIPE] Checkout session created for restaurant:', restaurantId);

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('[STRIPE] Failed to create checkout session:', error);
    return res.status(500).json({ error: 'failed_to_create_session', details: error.message });
  }
};
