import { Router } from 'express';
import { 
  generateDeliveries, 
  skipMyDelivery, 
  getDeliveryDetails,
  getDriverAssignedDeliveries,
  logDriverArrival,
  markDeliveryFailed,
  markHandoverComplete
} from '../controllers/delivery.controller';
import { requireAuth } from '../middlewares/auth.middleware';
import { requireRole, requireOwnership } from '../middlewares/rbac.middleware';

const router = Router();

// ==========================================
// ADMIN ROUTES
// ==========================================
router.post('/generate', requireAuth, requireRole('ADMIN'), generateDeliveries);

// ==========================================
// CUSTOMER ROUTES
// ==========================================
router.get('/:id', 
  requireAuth, 
  requireRole('CUSTOMER'), 
  requireOwnership('deliveries', 'id', 'subscriptions.user_id'), 
  getDeliveryDetails
);
router.post('/:id/skip', requireAuth, requireRole('CUSTOMER'), skipMyDelivery);

// ==========================================
// DRIVER FLOW ROUTES (DELIVERY_BOY)
// ==========================================

// 1. Fetch assigned deliveries (grouped by address/slot logic happens in service)
router.get('/driver/assigned', 
  requireAuth, 
  requireRole('DELIVERY_BOY'), 
  getDriverAssignedDeliveries
);
router.get('/:id/driver/assigned', 
  requireAuth, 
  requireRole('DELIVERY_BOY'), 
  getDriverAssignedDeliveries
);

// 2. Mark arrived at location
router.post('/:id/driver/arrive', 
  requireAuth, 
  requireRole('DELIVERY_BOY'), 
  logDriverArrival
);

// 3. Mark delivery attempt failed
router.post('/:id/driver/fail', 
  requireAuth, 
  requireRole('DELIVERY_BOY'), 
  markDeliveryFailed
);

// 4. Mark successful handover (CRITICAL PATH)
router.post('/:id/driver/deliver', 
  requireAuth, 
  requireRole('DELIVERY_BOY'), 
  markHandoverComplete
);

export default router;