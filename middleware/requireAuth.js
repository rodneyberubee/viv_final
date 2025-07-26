// /middleware/requireAuth.js
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

export const requireAuth = (req, res, next) => {
  // Look for the "Authorization" header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Verify the token using our secret key
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // Add decoded user info to the request
    next(); // Pass control to the next handler
  } catch (err) {
    console.error('[AUTH ERROR] Invalid token:', err.message);
    return res.status(401).json({ error: 'invalid_or_expired_token' });
  }
};
