export const requireAuth = (req, res, next) => {
  console.log('[AUTH DISABLED] Skipping JWT verification');
  // Fake user context so downstream routes still work
  req.user = { 
    restaurantId: req.params.restaurantId || 'testRestaurant', 
    email: 'test@disabled.local' 
  };
  next();
};
