// /routes/paddle/createCheckoutSession.js
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

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
