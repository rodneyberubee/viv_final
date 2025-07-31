// routes/auth/refresh.js
import express from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

const router = express.Router();

router.post('/', express.json(), (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing_token' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true }); // allow expired
    const payload = {
      restaurantId: decoded.restaurantId,
      email: decoded.email,
      name: decoded.name || null
    };
    const newToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' });
    return res.json({ token: newToken });
  } catch (err) {
    console.error('[REFRESH ERROR]', err);
    return res.status(401).json({ error: 'invalid_token' });
  }
});

export default router;
