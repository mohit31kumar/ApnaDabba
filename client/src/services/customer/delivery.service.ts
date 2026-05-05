import { api } from '@/services/api';

export type Delivery = {
  id: string;
  delivery_date: string;
  slot: 'LUNCH' | 'DINNER';
  status: string;
  is_buffer_meal: boolean;
  cutoff_time: string;
};

export const getDeliveryById = async (deliveryId: string): Promise<Delivery> => {
  try {
    const response = await api.get(`/api/v1/deliveries/${deliveryId}`);
    const delivery = response.data.data.delivery;
    if (!delivery) {
      throw new Error("Failed to fetch delivery");
    }
    return delivery;
  } catch (error) {
    throw new Error('Failed to fetch delivery');
  }
};

export const skipDelivery = async (deliveryId: string): Promise<void> => {
  try {
    await api.post(`/api/v1/deliveries/${deliveryId}/skip`);
  } catch (error) {
    throw new Error('Failed to skip delivery');
  }
};
