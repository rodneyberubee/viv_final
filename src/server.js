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

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// ✅ Replace default cors() with real config
const allowedOrigins = [
  'http://localhost:3000',
  'https://vivaitable.com',
  'https://hoppscotch.io',
  'https://www.vivaitable.com'
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn('[CORS] Blocked origin:', origin);
      callback(new Error('CORS not allowed from this origin'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true
};

app.use(cors(corsOptions));

// ✅ Handle preflight requests (CORS)
app.options('*', cors(corsOptions));

app.use(morgan('dev'));
app.use(express.json());

app.use('/api/askViv/:restaurantId', askVivRouter);

// ✅ Route bindings (restaurantId always from req.params)
app.post('/api/reservation/:restaurantId', reservation);
app.post('/api/cancelReservation/:restaurantId', cancelReservation);
app.post('/api/changeReservation/:restaurantId', changeReservation);
app.post('/api/checkAvailability/:restaurantId', checkAvailability);

app.get('/', (req, res) => {
  res.send('👋 Viv Middleware is running. API only. Try /api/reservation or visit vivaitable.com.');
});

// ✅ Listen on 0.0.0.0 to allow external requests
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Viv middleware server listening on port ${PORT}`);
});
