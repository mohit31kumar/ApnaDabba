import { Router } from 'express';
import { getDashboard, getDeliveryByDateSlot } from '../controllers/customer.controller';
import { requireAuth } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';

const router = Router();

router.get('/dashboard', requireAuth, requireRole('CUSTOMER'), getDashboard);
router.get('/deliveries/by-date', requireAuth, requireRole('CUSTOMER'), getDeliveryByDateSlot);

export default router;
