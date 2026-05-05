import { Request, Response } from 'express';
import { userService } from '../services/user.service';
import { validators } from '../utils/validators';

export const getMyProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;
    const profile = await userService.getProfile(userId);

    res.status(200).json({
      success: true,
      data: profile
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Failed to fetch profile.'
    });
  }
};

export const getAllUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const role = req.query.role as string | undefined;

    const data = await userService.getAllUsers(page, limit, role);

    res.status(200).json({
      success: true,
      data
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Failed to fetch users.'
    });
  }
};

export const createAdminUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { phone, role, password, first_name, last_name } = req.body;
    const adminId = req.user.id; 

    // Validation
    const details = [];
    if (!phone || !validators.is10DigitIndianPhone(phone)) {
      details.push({ field: 'phone', issue: 'Must be exactly 10 digits starting with 6-9' });
    }
    if (!role || !['CUSTOMER', 'ADMIN', 'DELIVERY_BOY'].includes(role)) {
      details.push({ field: 'role', issue: 'Invalid role provided' });
    }
    if (!password || password.length < 8) {
      details.push({ field: 'password', issue: 'Password must be at least 8 characters long' });
    }

    if (details.length > 0) {
      res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Invalid input parameters',
        details
      });
      return;
    }

    const newUser = await userService.createAdminUser(
      { phone, role, password, first_name, last_name },
      adminId
    );

    res.status(201).json({
      success: true,
      message: 'User created successfully.',
      data: newUser
    });

  } catch (error: any) {
    if (error.message === 'PHONE_ALREADY_EXISTS') {
      res.status(409).json({
        success: false,
        error: 'DUPLICATE_ENTRY',
        message: 'A user with this phone number already exists.'
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An unexpected error occurred while creating the user.'
    });
  }
};

export const updateUserStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const targetUserId = req.params.id;
    const { is_active } = req.body;
    const adminId = req.user.id;

    if (!validators.isUUID(targetUserId)) {
      res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Invalid user ID format.'
      });
      return;
    }

    if (typeof is_active !== 'boolean') {
      res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'is_active flag must be a boolean.'
      });
      return;
    }

    // Protection against admin disabling themselves
    if (targetUserId === adminId) {
      res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: 'You cannot disable your own admin account.'
      });
      return;
    }

    const updatedUser = await userService.updateUserStatus(targetUserId, is_active, adminId);

    res.status(200).json({
      success: true,
      message: `User successfully ${is_active ? 'enabled' : 'disabled'}.`,
      data: updatedUser
    });

  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An unexpected error occurred while updating user status.'
    });
  }
};