import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('[BOOT] Running from:', __dirname);

import express from 'express';
import dotenv from 'dotenv';
import morgan from 'morgan';
import cors from 'cors';

import { reservation } from './routes/reservation.js';
import { cancelReservation } from './routes/cancelReservation.js';
import { changeReservation } from './routes/changeReservation.js';
import { checkAvailability } from './routes/checkAvailability.js';
import { askVivRouter } from './routes/askVivRouter.js';
import { dashboardRouter } from './routes/dashboard/dashboardRouter.js';
import accountRouter from './routes/account/accountRouter.js';
import loginRouter from './routes/auth/login.js';    // ✅ Handles /request
import verifyRouter from './routes/auth/verify.js';  // ✅ Handles /verify
import refreshRouter from './routes/auth/refresh.js'; // ✅ NEW: Handles /refresh
import { createCheckoutSession, createStripeCheckoutSession } from './routes/webhook/createCheckoutSession.js'; // ✅ UPDATED: Combined session creators
import webhookRouter, { webhookHandler, stripeWebhookHandler } from './routes/webhook/webhook.js'; // ✅ UPDATED: Combined webhook handlers

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// CORS config (relaxed for testing)
const allowedOrigins = [
  'http://localhost:3000',
  'https://vivaitable.com',
  'https://www.vivaitable.com',
  'https://hoppscotch.io'
];
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn('[CORS] Blocked origin:', origin);
      callback(new Error('CORS not allowed from this origin'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Stripe-Signature'], // ← add signature header
  credentials: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(morgan('dev'));

// ✅ Mount the webhook BEFORE global JSON, using RAW body for Stripe verification
app.use('/api/webhook', express.raw({ type: 'application/json' }), webhookRouter);

// === Debugging middleware to log all requests ===
app.use((req, res, next) => {
  console.log(`[DEBUG] ${req.method} ${req.url}`);
  next();
});

// Now parse JSON for the rest of the app
app.use(express.json());

// ROUTES
app.use('/api/askViv/:restaurantId', askVivRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/account', accountRouter);
app.use('/api/auth/login', loginRouter);
app.use('/api/auth/verify', verifyRouter);
app.use('/api/auth/refresh', refreshRouter);

// Payment providers (using separate endpoints for clarity)
app.post('/api/paddle/create-checkout-session', createCheckoutSession);
app.post('/api/stripe/create-checkout-session', createStripeCheckoutSession);

// === Hoppscotch/Webhook testing route (uses JSON body) ===
app.post('/api/test/webhook', async (req, res) => {
  try {
    console.log('[TEST WEBHOOK] Body received:', req.body);
    const event = req.body;
    if (event.event_type) {
      await webhookHandler(event); // Paddle
    } else if (event.type) {
      await stripeWebhookHandler(event); // Stripe
    }
    res.status(200).json({ message: 'Test event processed', eventType: event.type || event.event_type });
  } catch (err) {
    console.error('[TEST WEBHOOK ERROR]', err);
    res.status(500).json({ error: err.message });
  }
});

// Reservations
app.post('/api/reservation/:restaurantId', reservation);
app.post('/api/cancelReservation/:restaurantId', cancelReservation);
app.post('/api/changeReservation/:restaurantId', changeReservation);
app.post('/api/checkAvailability/:restaurantId', checkAvailability);

app.get('/', (req, res) => {
  res.send('👋 Viv Middleware is running. API only. Try /api/reservation or visit vivaitable.com.');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Viv middleware server listening on port ${PORT}`);
});
