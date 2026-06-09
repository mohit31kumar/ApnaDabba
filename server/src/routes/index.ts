import { Router } from 'express';

import authRoutes from './auth.routes';
import adminRoutes from './admin.routes';
import deliveryRoutes from './delivery.routes';
import userRoutes from './user.routes';
import customerRoutes from './customer.routes';
import subscriptionRoutes from './subscription.routes';

const router = Router();

// Health check (optional)
router.get('/', (req, res) => {
  res.json({ message: 'API is running' });
});

// Mount routes
router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/deliveries', deliveryRoutes);
router.use('/users', userRoutes);
router.use('/customer', customerRoutes);
router.use('/subscriptions', subscriptionRoutes);

export default router;