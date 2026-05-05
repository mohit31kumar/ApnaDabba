import { Request, Response } from 'express';
import { adminService } from '../services/admin.service';
import { validators } from '../utils/validators';

export const getDashboardOverview = async (req: Request, res: Response): Promise<void> => {
  try {
    const stats = await adminService.getDashboardStats();
    res.status(200).json({ success: true, data: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Failed to fetch dashboard stats.' });
  }
};

export const getUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const requestedLimit = parseInt(req.query.limit as string) || 20;
    const limit = Math.min(requestedLimit, 100);
    const role = req.query.role as string | undefined;

    if (role && !['CUSTOMER', 'ADMIN', 'DELIVERY_BOY'].includes(role)) {
      res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Invalid role.' });
      return;
    }

    const data = await adminService.getUsers(page, limit, role);
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Failed to fetch users.' });
  }
};

export const getUserById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!validators.isUUID(id)) {
      res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Invalid User ID.' });
      return;
    }
    const user = await adminService.getUserById(id);
    res.status(200).json({ success: true, data: user });
  } catch (error: any) {
    if (error.message === 'USER_NOT_FOUND') {
      res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'User not found.' });
      return;
    }
    res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Failed to fetch user.' });
  }
};

export const updateUserStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    if (!validators.isUUID(id)) {
      res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Invalid User ID.' });
      return;
    }
    if (typeof is_active !== 'boolean') {
      res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'is_active must be boolean.' });
      return;
    }

    const updated = await adminService.updateUserStatus(id, is_active);
    res.status(200).json({ success: true, message: 'User status updated.', data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Failed to update user.' });
  }
};

export const getSubscriptions = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const requestedLimit = parseInt(req.query.limit as string) || 20;
    const limit = Math.min(requestedLimit, 100);
    const status = req.query.status as string | undefined;

    if (status && !['ACTIVE', 'BUFFER', 'EXPIRED', 'CANCELLED', 'ON_HOLD'].includes(status)) {
      res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Invalid subscription status.' });
      return;
    }

    const data = await adminService.getSubscriptions(page, limit, status);
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Failed to fetch subscriptions.' });
  }
};

export const getSubscriptionById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!validators.isUUID(id)) {
      res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Invalid Subscription ID.' });
      return;
    }
    const data = await adminService.getSubscriptionById(id);
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    if (error.message === 'SUBSCRIPTION_NOT_FOUND') {
      res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Subscription not found.' });
      return;
    }
    res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Failed to fetch subscription.' });
  }
};

export const updateSubscriptionStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status } = req.body;

   if (!validators.isUUID(id)) {
      res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Invalid Subscription ID.' });
      return;
    }
    if (!status || !['ACTIVE', 'BUFFER', 'EXPIRED', 'CANCELLED', 'ON_HOLD'].includes(status)) {
      res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Valid status required.' });
      return;
    }

    const updated = await adminService.updateSubscriptionStatus(id, status);
    res.status(200).json({ success: true, message: 'Subscription status updated.', data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Failed to update subscription.' });
  }
};

export const getDeliveries = async (req: Request, res: Response): Promise<void> => {
  try {
    const { date, slot, status } = req.query;
    
    if (date && isNaN(Date.parse(date as string))) {
      res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Invalid date format.' });
      return;
    }

    if (status && !['PENDING','DISPATCHED','DELIVERED','SKIPPED','FAILED','BLOCKED_TIFFIN_DEBT','EXPIRED_BUFFER','ON_HOLD'].includes(status as string)) {
      res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Invalid delivery status.' });
      return;
    }

    const data = await adminService.getDeliveries(date as string, slot as string, status as string);
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Failed to fetch deliveries.' });
  }
};

export const getWalletBySubscriptionId = async (req: Request, res: Response): Promise<void> => {
  try {
    const { subscriptionId } = req.params;
    if (!validators.isUUID(subscriptionId)) {
      res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Invalid Subscription ID.' });
      return;
    }
    const data = await adminService.getWalletBySubscriptionId(subscriptionId);
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    if (error.message === 'WALLET_NOT_FOUND') {
      res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Wallet not found.' });
      return;
    }
    res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Failed to fetch wallet.' });
  }
};

export const getWalletTransactions = async (req: Request, res: Response): Promise<void> => {
  try {
    const { subscriptionId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const requestedLimit = parseInt(req.query.limit as string) || 20;
    const limit = Math.min(requestedLimit, 100);

    if (!validators.isUUID(subscriptionId)) {
      res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Invalid Subscription ID.' });
      return;
    }
    const data = await adminService.getWalletTransactions(subscriptionId, page, limit);
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    if (error.message === 'WALLET_NOT_FOUND') {
      res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Wallet not found.' });
      return;
    }
    res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Failed to fetch wallet transactions.' });
  }
};

export const getTiffinTracker = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await adminService.getTiffinDefaulters();
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Failed to fetch tiffin tracker data.' });
  }
};

export const getAlerts = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await adminService.getSystemAlerts();
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Failed to fetch alerts.' });
  }
};