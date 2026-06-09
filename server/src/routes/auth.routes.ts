import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { register, loginWithPassword, refreshToken, logout, logoutAll } from '../controllers/auth.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'TOO_MANY_ATTEMPTS',
    message: 'Too many login attempts. Please try again after 15 minutes.'
  }
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'TOO_MANY_ATTEMPTS',
    message: 'Too many refresh attempts. Please try again later.'
  }
});

router.post('/register', register);
router.post('/login/password', loginLimiter, loginWithPassword);
router.post('/refresh', refreshLimiter, refreshToken);

router.post('/logout', requireAuth, logout);
router.post('/logout-all', requireAuth, logoutAll);

export default router;