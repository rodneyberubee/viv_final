if (records.length > 0) {
  await base('restaurantMap').update(records[0].id, { 
    status: 'expired',
    restaurantId: '' // clear restaurantId to disable pages & routing
  });
  console.log('[STRIPE WEBHOOK] Marked account expired and cleared restaurantId for customer:', stripeCustomerId);
}
