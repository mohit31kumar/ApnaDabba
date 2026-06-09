import { Router } from 'express';
import { subscribeUser, getActivePlans, createPlan } from '../controllers/subscription.controller';
import { requireAuth } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';

const router = Router();

// Customer routes
router.get('/plans', getActivePlans);
router.post('/', requireAuth, requireRole('CUSTOMER'), subscribeUser);

// Admin routes
router.post('/plans', requireAuth, requireRole('ADMIN'), createPlan);

export default router;
