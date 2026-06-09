import { Request, Response } from 'express';
import { subscriptionService } from '../services/subscription.service';

export const subscribeUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const customerId = req.user.id;
    const { plan_config_id, delivery_address_id, start_date, end_date } = req.body;

    if (!plan_config_id || !delivery_address_id || !start_date || !end_date) {
      res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'plan_config_id, delivery_address_id, start_date, and end_date are required.' });
      return;
    }

    const subscription = await subscriptionService.subscribeUser({
      userId: customerId,
      planConfigId: plan_config_id,
      deliveryAddressId: delivery_address_id,
      startDate: start_date,
      endDate: end_date,
    });

    res.status(201).json({ success: true, data: subscription });
  } catch (error: any) {
    if (error.message === 'INVALID_DATE_RANGE') {
      res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Start date must be before end date.' });
      return;
    }
    if (error.message === 'INVALID_ADDRESS') {
      res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Invalid or inactive delivery address.' });
      return;
    }
    if (error.message === 'INVALID_PLAN') {
      res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Invalid or inactive plan.' });
      return;
    }
    if (error.message === 'OVERLAPPING_SUBSCRIPTION') {
      res.status(409).json({ success: false, error: 'CONFLICT', message: 'You already have an active subscription that overlaps with this period.' });
      return;
    }
    res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Failed to create subscription.' });
  }
};

export const getActivePlans = async (req: Request, res: Response): Promise<void> => {
  try {
    const plans = await subscriptionService.getAllActivePlans();
    res.status(200).json({ success: true, data: plans });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Failed to fetch plans.' });
  }
};

export const createPlan = async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = req.user.id;
    const { plan_code, name, description, price_per_meal, security_deposit, skip_limit, buffer_days } = req.body;

    if (!plan_code || !name || !price_per_meal || security_deposit === undefined || skip_limit === undefined || buffer_days === undefined) {
      res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'plan_code, name, price_per_meal, security_deposit, skip_limit, and buffer_days are required.' });
      return;
    }

    const plan = await subscriptionService.createPlan({
      plan_code, name, description, price_per_meal, security_deposit, skip_limit, buffer_days,
    }, adminId);

    res.status(201).json({ success: true, data: plan });
  } catch (error: any) {
    if (error.message === 'PLAN_CODE_EXISTS') {
      res.status(409).json({ success: false, error: 'CONFLICT', message: 'A plan with this code already exists.' });
      return;
    }
    res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Failed to create plan.' });
  }
};
