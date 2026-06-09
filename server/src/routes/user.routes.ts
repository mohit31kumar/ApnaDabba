import { Router } from 'express';
import { 
  getMyProfile, 
  getAllUsers, 
  createAdminUser, 
  updateUserStatus 
} from '../controllers/user.controller';
import { requireAuth } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';

const router = Router();

// ==========================================
// SHARED ROUTES (All authenticated users)
// ==========================================

// Get personal profile (Customers, Delivery Boys, Admins)
router.get('/me', requireAuth, getMyProfile);


// ==========================================
// ADMIN ONLY ROUTES
// ==========================================

// List all users with pagination and filtering
router.get('/', requireAuth, requireRole('ADMIN'), getAllUsers);

// Create new staff or customer accounts
router.post('/', requireAuth, requireRole('ADMIN'), createAdminUser);

// Enable/Disable a user account
router.patch('/:id/status', requireAuth, requireRole('ADMIN'), updateUserStatus);

export default router;