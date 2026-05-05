import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import {
  getDashboardOverview,
  getUsers,
  getUserById,
  updateUserStatus,
  getSubscriptions,
  getSubscriptionById,
  updateSubscriptionStatus,
  getDeliveries,
  getWalletBySubscriptionId,
  getWalletTransactions,
  getTiffinTracker,
  getAlerts
} from '../controllers/admin.controller';

const router = Router();

// Apply strict Admin RBAC to all routes in this file
router.use(requireAuth, requireRole('ADMIN'));

// ==========================================
// DASHBOARD OVERVIEW
// ==========================================
router.get('/dashboard', getDashboardOverview);

// ==========================================
// USER MANAGEMENT
// ==========================================
router.get('/users', getUsers);
router.get('/users/:id', getUserById);
router.patch('/users/:id/status', updateUserStatus);

// ==========================================
// SUBSCRIPTION MANAGEMENT
// ==========================================
router.get('/subscriptions', getSubscriptions);
router.get('/subscriptions/:id', getSubscriptionById);
router.patch('/subscriptions/:id/status', updateSubscriptionStatus);

// ==========================================
// DELIVERY MONITORING
// ==========================================
router.get('/deliveries', getDeliveries);

// ==========================================
// WALLET MONITORING
// ==========================================
router.get('/wallets/:subscriptionId', getWalletBySubscriptionId);
router.get('/wallets/:subscriptionId/transactions', getWalletTransactions);

// ==========================================
// TIFFIN TRACKING
// ==========================================
router.get('/tiffin-tracker', getTiffinTracker);

// ==========================================
// ALERTS
// ==========================================
router.get('/alerts', getAlerts);

export default router;