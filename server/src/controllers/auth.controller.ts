import { Request, Response } from 'express';
import { authService } from '../services/auth.service';
import { validators } from '../utils/validators';

const VALID_ROLES = ['CUSTOMER', 'DELIVERY_BOY', 'ADMIN'] as const;

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { phone, password, first_name, last_name, role } = req.body;

    if (!phone || !validators.is10DigitIndianPhone(phone)) {
      res.status(400).json({
        success: false, error: 'VALIDATION_ERROR',
        message: 'Phone number must be exactly 10 digits.'
      });
      return;
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      res.status(400).json({
        success: false, error: 'VALIDATION_ERROR',
        message: 'Password must be at least 8 characters long.'
      });
      return;
    }

    if (!first_name || typeof first_name !== 'string' || !first_name.trim()) {
      res.status(400).json({
        success: false, error: 'VALIDATION_ERROR',
        message: 'First name is required.'
      });
      return;
    }

    if (!last_name || typeof last_name !== 'string' || !last_name.trim()) {
      res.status(400).json({
        success: false, error: 'VALIDATION_ERROR',
        message: 'Last name is required.'
      });
      return;
    }

    if (!role || !VALID_ROLES.includes(role)) {
      res.status(400).json({
        success: false, error: 'VALIDATION_ERROR',
        message: 'Role must be one of: CUSTOMER, DELIVERY_BOY, ADMIN.'
      });
      return;
    }

    const result = await authService.register(phone, password, first_name.trim(), last_name.trim(), role);

    res.status(201).json({
      success: true,
      message: 'Registration successful.',
      data: {
        user: result.user,
        tokens: result.tokens,
        force_password_change: result.force_password_change,
        login_time: new Date().toISOString()
      }
    });
  } catch (error: any) {
    console.error('[AuthController] register Error:', error.message);

    if (error.message === 'PHONE_ALREADY_EXISTS') {
      res.status(409).json({
        success: false, error: 'DUPLICATE_ENTRY',
        message: 'A user with this phone number already exists.'
      });
      return;
    }

    res.status(500).json({
      success: false, error: 'SERVER_ERROR',
      message: 'An unexpected error occurred during registration.'
    });
  }
};

export const loginWithPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { phone, password } = req.body;

    if (!phone || !validators.is10DigitIndianPhone(phone)) {
      res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Phone number must be exactly 10 digits.'
      });
      return;
    }

    if (!password || typeof password !== 'string') {
      res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Password is required.'
      });
      return;
    }

    const loginResult = await authService.loginWithPassword(phone, password);

    res.status(200).json({
      success: true,
      message: 'Login successful.',
      data: {
        user: loginResult.user,
        tokens: loginResult.tokens,
        force_password_change: loginResult.force_password_change,
        login_time: new Date().toISOString()
      }
    });

  } catch (error: any) {
    console.error('[AuthController] login Error:', error.message);

    if (error.message === 'ACCOUNT_DISABLED') {
      res.status(403).json({
        success: false,
        error: 'ACCOUNT_DISABLED',
        message: 'Your account has been disabled. Please contact support.'
      });
      return;
    }

    if (error.message === 'INVALID_CREDENTIALS') {
      await new Promise(resolve => setTimeout(resolve, 500)); 
      res.status(401).json({
        success: false,
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid phone number or password.'
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An unexpected error occurred during login.'
    });
  }
};

export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token || typeof refresh_token !== 'string') {
      res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Refresh token is required.'
      });
      return;
    }

    const tokens = await authService.rotateRefreshToken(refresh_token);

    res.status(200).json({
      success: true,
      message: 'Tokens refreshed successfully.',
      data: { tokens }
    });

  } catch (error: any) {
    console.error('[AuthController] refresh Error:', error.message);

    if (error.message === 'TOKEN_REUSED') {
      res.status(401).json({
        success: false,
        error: 'TOKEN_REUSED',
        message: 'Security Alert: This token has already been used. Please log in again.'
      });
      return;
    }

    if (error.message === 'ACCOUNT_DISABLED') {
      res.status(403).json({
        success: false,
        error: 'ACCOUNT_DISABLED',
        message: 'Your account has been disabled.'
      });
      return;
    }

    if (error.message === 'INVALID_TOKEN') {
      res.status(401).json({
        success: false,
        error: 'INVALID_TOKEN',
        message: 'Refresh token is invalid or has expired. Please log in again.'
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An unexpected error occurred during token refresh.'
    });
  }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user.id; 
    const { refresh_token } = req.body;

    if (!refresh_token || typeof refresh_token !== 'string') {
      res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Refresh token is required.'
      });
      return;
    }

    await authService.logout(userId, refresh_token);

    res.status(200).json({
      success: true,
      message: 'Logged out successfully.'
    });

  } catch (error: any) {
    console.error('[AuthController] logout Error:', error.message);

    if (error.message === 'INVALID_TOKEN') {
      res.status(401).json({
        success: false,
        error: 'INVALID_TOKEN',
        message: 'Refresh token is invalid.'
      });
      return;
    }

    if (error.message === 'TOKEN_ALREADY_REVOKED') {
      res.status(401).json({
        success: false,
        error: 'TOKEN_ALREADY_REVOKED',
        message: 'Token already revoked.'
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An unexpected error occurred during logout.'
    });
  }
};

export const logoutAll = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user.id; 
    await authService.logoutAll(userId);

    res.status(200).json({
      success: true,
      message: 'Logged out from all devices successfully.'
    });

  } catch (error: any) {
    console.error('[AuthController] logoutAll Error:', error.message);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An unexpected error occurred while logging out of all devices.'
    });
  }
};