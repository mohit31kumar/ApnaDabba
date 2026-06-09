import prisma from '../lib/prisma';

export const customerService = {

  getDeliveryBySubscriptionDateSlot: async (customerId: string, date: string, slot: 'LUNCH' | 'DINNER') => {
    const subscription = await prisma.subscriptions.findFirst({
      where: {
        user_id: customerId,
        status: { in: ['ACTIVE', 'BUFFER'] },
      },
      select: { id: true },
    });

    if (!subscription) return null;

    const dateObj = new Date(date);
    dateObj.setHours(0, 0, 0, 0);

    const delivery = await prisma.deliveries.findFirst({
      where: {
        subscription_id: subscription.id,
        delivery_date: dateObj,
        slot: slot,
      },
      include: {
        subscriptions: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    return delivery;
  },

  getDashboard: async (customerId: string) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const subscription = await prisma.subscriptions.findFirst({
      where: {
        user_id: customerId,
        status: { in: ['ACTIVE', 'BUFFER'] },
      },
      include: {
        subscription_wallets: true,
        plan_configs: true,
        delivery_addresses: true,
      },
    });

    if (!subscription) {
      return {
        subscription: null,
        wallet: null,
        todayDeliveries: [],
        upcomingDeliveries: [],
      };
    }

    const { subscription_wallets, ...subscriptionData } = subscription;

    const todayDeliveries = await prisma.deliveries.findMany({
      where: {
        subscription_id: subscription.id,
        delivery_date: { gte: todayStart, lte: todayEnd },
      },
      orderBy: { slot: 'asc' },
    });

    const upcomingDeliveries = await prisma.deliveries.findMany({
      where: {
        subscription_id: subscription.id,
        delivery_date: { gt: todayEnd },
      },
      orderBy: { delivery_date: 'asc' },
      take: 5,
    });

    return {
      subscription: subscriptionData,
      wallet: subscription_wallets || null,
      todayDeliveries,
      upcomingDeliveries,
    };
  },
};
