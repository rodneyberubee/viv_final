import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

const PUBLIC_RESTAURANT_IDS = new Set(['mollyscafe1']);

export const requireAuth = (req, res, next) => {
  // Try to detect the target restaurantId from params or URL
  const paramId = req.params?.restaurantId;
  const path = req.originalUrl || req.url || '';
  const pathMatch = path.match(/\/dashboard\/([^/]+)\b/);
  const pathId = pathMatch?.[1];
  const targetId = paramId || pathId;

  // Bypass auth for the public demo tenant
  if (targetId && PUBLIC_RESTAURANT_IDS.has(targetId)) {
    console.log(`[AUTH] Public demo access granted for ${targetId}`);
    return next();
  }

  // Normal JWT flow
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'unauthorized', detail: 'Missing or malformed Authorization header' });
  }

  const token = authHeader.split(' ')[1];
  if (!process.env.JWT_SECRET) {
    return res.status(500).json({ error: 'server_config_error', detail: 'JWT secret is not configured' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    const code = err.name === 'TokenExpiredError' ? 'token_expired'
              : err.name === 'JsonWebTokenError' ? 'invalid_token'
              : 'invalid_or_expired_token';
    return res.status(401).json({ error: code, detail: 'Token verification failed' });
  }
};
