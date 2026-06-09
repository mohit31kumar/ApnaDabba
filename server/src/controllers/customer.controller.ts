import { Request, Response } from 'express';
import { customerService } from '../services/customer.service';

export const getDeliveryByDateSlot = async (req: Request, res: Response): Promise<void> => {
  try {
    const customerId = req.user.id;
    const { date, slot } = req.query;

    if (!date || typeof date !== 'string' || isNaN(Date.parse(date))) {
      res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Valid date parameter required (YYYY-MM-DD).' });
      return;
    }

    if (slot !== 'LUNCH' && slot !== 'DINNER') {
      res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Slot must be LUNCH or DINNER.' });
      return;
    }

    const delivery = await customerService.getDeliveryBySubscriptionDateSlot(customerId, date, slot);

    if (!delivery) {
      res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'No delivery found for this date and slot.' });
      return;
    }

    res.status(200).json({ success: true, data: delivery });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Failed to fetch delivery details.' });
  }
};

export const getDashboard = async (req: Request, res: Response): Promise<void> => {
  try {
    const customerId = req.user.id;
    const dashboard = await customerService.getDashboard(customerId);
    res.status(200).json({ success: true, data: dashboard });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Failed to fetch dashboard data.',
    });
  }
};
