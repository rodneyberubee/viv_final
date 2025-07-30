import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

export const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('[AUTH] Missing or malformed Authorization header:', authHeader);
    return res.status(401).json({ error: 'unauthorized', detail: 'Missing or malformed Authorization header' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    console.warn('[AUTH] No token provided after Bearer.');
    return res.status(401).json({ error: 'unauthorized', detail: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('[AUTH] Token verified for:', decoded.restaurantId || 'unknown', decoded.email || 'no-email');
    req.user = decoded; // Attach user payload for downstream routes
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      console.error('[AUTH ERROR] Token expired:', err.message);
      return res.status(401).json({ error: 'token_expired', detail: 'JWT has expired' });
    }
    if (err.name === 'JsonWebTokenError') {
      console.error('[AUTH ERROR] Invalid token signature or format:', err.message);
      return res.status(401).json({ error: 'invalid_token', detail: 'Invalid token signature or format' });
    }
    console.error('[AUTH ERROR] Unexpected JWT error:', err.message);
    return res.status(401).json({ error: 'invalid_or_expired_token', detail: 'Token verification failed' });
  }
};
