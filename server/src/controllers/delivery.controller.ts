import { Request, Response } from 'express';
import { deliveryService } from '../services/delivery.service';
import { validators } from '../utils/validators';
import { getAssignedDeliveriesForDriver } from '../services/delivery.service';

export const generateDeliveries = async (req: Request, res: Response): Promise<void> => {
  try {
    const { target_date, slot } = req.body;
    if (!target_date || isNaN(Date.parse(target_date))) {
       res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Valid target_date required (YYYY-MM-DD).' });
       return;
    }
    const result = await deliveryService.generateDeliveriesForSlot(target_date, slot as 'LUNCH' | 'DINNER');
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Failed to generate deliveries.' });
  }
};

export const skipMyDelivery = async (req: Request, res: Response): Promise<void> => {
  try {
    const deliveryId = req.params.id as string;
    const customerId = req.user.id;
    if (!validators.isUUID(deliveryId)) {
      res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Invalid ID.' });
      return;
    }
    const skippedDelivery = await deliveryService.skipDelivery(deliveryId, customerId);
    res.status(200).json({ success: true, data: skippedDelivery });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
};

export const getDeliveryDetails = async (req: Request, res: Response): Promise<void> => {
  const resource = req.resource;
  const safeDelivery = resource ? {
    id: resource.id,
    status: resource.status,
    delivery_date: resource.delivery_date,
    slot: resource.slot,
    cutoff_time: resource.cutoff_time,
    is_buffer_meal: resource.is_buffer_meal,
    delivered_at: resource.delivered_at,
    location_locked: resource.location_locked,
    driver_id: resource.driver_id,
    tiffin_box_id: resource.tiffin_box_id,
    delivery_notes: resource.delivery_notes,
    is_special_meal: resource.is_special_meal,
  } : null;
  res.status(200).json({ success: true, data: { delivery: safeDelivery } });
};

// ==========================================
// DRIVER FLOW CONTROLLERS
// ==========================================

// This controller is used by the driver to fetch their assigned deliveries for a specific date and slot. The service will handle the logic of grouping deliveries by address and slot.
export const getDriverAssignedDeliveries = async (req: Request, res: Response) => {
  try {
    const driverId = (req as any).user?.id;

    if (!driverId) {
      return res.status(401).json({ success: false, message: 'UNAUTHORIZED' });
    }

    const { date, slot } = req.query;

    if (!date || typeof date !== 'string') {
      return res.status(400).json({ success: false, message: 'Date query parameter is required' });
    }

    const validSlot = slot === 'LUNCH' || slot === 'DINNER' ? slot : undefined;

    const deliveries = await getAssignedDeliveriesForDriver(driverId, date, validSlot);

    return res.status(200).json({
      success: true,
      data: deliveries,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    const statusCode = message === 'INVALID_DATE' ? 400 : 500;
    
    return res.status(statusCode).json({ 
      success: false, 
      message: message 
    });
  }
};

export const logDriverArrival = async (req: Request, res: Response): Promise<void> => {
  try {
    const deliveryId = req.params.id as string;
    const driverId = req.user.id;
    const { lat, lng } = req.body;

    if (!validators.isUUID(deliveryId)) {
      res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Invalid delivery ID.' });
      return;
    }

    if (
      typeof lat !== 'number' || typeof lng !== 'number' ||
      lat < -90 || lat > 90 || lng < -180 || lng > 180
    ) {
      res.status(400).json({ 
        success: false, 
        error: 'VALIDATION_ERROR', 
        message: 'Valid lat (-90 to 90) and lng (-180 to 180) coordinates required.' 
      });
      return;
    }

    await deliveryService.markArrivedOrFailed(deliveryId, driverId, 'ARRIVED_AT_LOCATION', lat, lng);

    res.status(200).json({
      success: true,
      message: 'Arrival at location logged securely.'
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Failed to log arrival.' });
  }
};

export const markDeliveryFailed = async (req: Request, res: Response): Promise<void> => {
  try {
    const deliveryId = req.params.id as string;
    const driverId = req.user.id;
    const { lat, lng } = req.body;

    if (!validators.isUUID(deliveryId)) {
      res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Invalid delivery ID.' });
      return;
    }

    if (
      typeof lat !== 'number' || typeof lng !== 'number' ||
      lat < -90 || lat > 90 || lng < -180 || lng > 180
    ) {
      res.status(400).json({ 
        success: false, 
        error: 'VALIDATION_ERROR', 
        message: 'Valid lat (-90 to 90) and lng (-180 to 180) coordinates required.' 
      });
      return;
    }

    const result = await deliveryService.markArrivedOrFailed(deliveryId, driverId, 'FAILED', lat, lng);

    res.status(200).json({
      success: true,
      message: 'Delivery marked as failed.',
      data: result
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Failed to mark delivery as failed.' });
  }
};

export const markHandoverComplete = async (req: Request, res: Response): Promise<void> => {
  try {
    const deliveryId = req.params.id as string;
    const driverId = req.user.id;
    const { tiffin_box_id, returned_tiffin_box_id, lat, lng } = req.body;

    if (!validators.isUUID(deliveryId) || !validators.isUUID(tiffin_box_id)) {
      res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Invalid UUIDs provided.' });
      return;
    }

    if (
      typeof lat !== 'number' || typeof lng !== 'number' ||
      lat < -90 || lat > 90 || lng < -180 || lng > 180
    ) {
      res.status(400).json({ 
        success: false, 
        error: 'VALIDATION_ERROR', 
        message: 'Valid lat (-90 to 90) and lng (-180 to 180) coordinates required.' 
      });
      return;
    }

    const updatedDelivery = await deliveryService.markDelivered(
      deliveryId, 
      driverId, 
      tiffin_box_id, 
      returned_tiffin_box_id || null, 
      lat, 
      lng
    );

    res.status(200).json({
      success: true,
      message: 'Delivery successfully completed and securely logged.',
      data: updatedDelivery
    });

  } catch (error: any) {
    if (error.message === 'BLOCKED_TIFFIN_DEBT') {
      res.status(403).json({ success: false, error: 'BLOCKED_TIFFIN_DEBT', message: 'Delivery blocked due to existing tiffin debt (>= 2).' });
      return;
    }
    if (error.message === 'INVALID_STATE') {
      res.status(400).json({ success: false, error: 'INVALID_STATE', message: 'Delivery has already been completed or skipped.' });
      return;
    }
    res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Failed to complete delivery handover.' });
  }
};