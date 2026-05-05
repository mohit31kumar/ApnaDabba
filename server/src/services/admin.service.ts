import { prisma } from "../lib/prisma";
import { Prisma } from "@prisma/client";

export const adminService = {
  // ==========================================
  // DASHBOARD OVERVIEW
  // ==========================================
  getDashboardStats: async () => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [
      totalUsers,
      activeSubscriptions,
      deliveriesToday,
      blockedDeliveries,
      revenueResult,
    ] = await Promise.all([
      prisma.users.count({ where: { role: "CUSTOMER" } }),
      prisma.subscriptions.count({ where: { status: "ACTIVE" } }),
      prisma.deliveries.count({
        where: { delivery_date: { gte: todayStart, lte: todayEnd } },
      }),
      prisma.deliveries.count({
        where: {
          status: "BLOCKED_TIFFIN_DEBT",
          delivery_date: { gte: todayStart, lte: todayEnd },
        },
      }),
      prisma.wallet_transactions.aggregate({
        _sum: { amount: true },
        where: {
          transaction_type: "DEBIT",
          transaction_category: "MEAL_DEDUCTION",
          created_at: { gte: todayStart, lte: todayEnd },
        },
      }),
    ]);

    return {
      total_users: totalUsers,
      active_subscriptions: activeSubscriptions,
      total_deliveries_today: deliveriesToday,
      blocked_deliveries: blockedDeliveries,
      total_revenue: revenueResult?._sum?.amount ?? 0,
    };
  },

  // ==========================================
  // USER MANAGEMENT
  // ==========================================
  getUsers: async (page: number, limit: number, role?: string) => {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (role) where.role = role;

    const [users, total] = await Promise.all([
      prisma.users.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          phone: true,
          role: true,
          first_name: true,
          last_name: true,
          is_active: true,
          created_at: true,
        },
        orderBy: { created_at: "desc" },
      }),
      prisma.users.count({ where }),
    ]);

    return { users, total, page, limit };
  },

  getUserById: async (userId: string) => {
    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        role: true,
        first_name: true,
        last_name: true,
        is_active: true,
        created_at: true,
      },
    });
    if (!user) throw new Error("USER_NOT_FOUND");
    return user;
  },

  updateUserStatus: async (userId: string, is_active: boolean) => {
    return await prisma.users.update({
      where: { id: userId },
      data: { is_active },
      select: { id: true, phone: true, is_active: true },
    });
  },

  // ==========================================
  // SUBSCRIPTION MANAGEMENT
  // ==========================================
  getSubscriptions: async (page: number, limit: number, status?: string) => {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (status) where.status = status;

    const [subscriptions, total] = await Promise.all([
      prisma.subscriptions.findMany({
        where,
        skip,
        take: limit,
        include: {
          users: { select: { first_name: true, last_name: true, phone: true } },
          plan_configs: { select: { name: true, plan_code: true } },
        },
        orderBy: { created_at: "desc" },
      }),
      prisma.subscriptions.count({ where }),
    ]);

    return { subscriptions, total, page, limit };
  },

  getSubscriptionById: async (subscriptionId: string) => {
    const subscription = await prisma.subscriptions.findUnique({
      where: { id: subscriptionId },
      include: {
        users: {
          select: { id: true, first_name: true, last_name: true, phone: true },
        },
        plan_configs: true,
        delivery_addresses: true,
        subscription_wallets: true,
        tiffin_tracker: true,
      },
    });
    if (!subscription) throw new Error("SUBSCRIPTION_NOT_FOUND");
    return subscription;
  },

  updateSubscriptionStatus: async (subscriptionId: string, status: string) => {
    return await prisma.subscriptions.update({
      where: { id: subscriptionId },
      data: { status },
    });
  },

  // ==========================================
  // DELIVERY MONITORING
  // ==========================================
  getDeliveries: async (date?: string, slot?: string, status?: string) => {
    const where: any = {};
    if (date) {
      const targetDate = new Date(date);
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);
      where.delivery_date = { gte: startOfDay, lte: endOfDay };
    }
    if (slot) where.slot = slot;
    if (status) where.status = status;

    return await prisma.deliveries.findMany({
      where,
      include: {
        subscriptions: {
          include: {
            users: {
              select: { first_name: true, last_name: true, phone: true },
            },
            delivery_addresses: { select: { label: true, full_address: true } },
          },
        },
      },
      orderBy: { created_at: "desc" },
      take: 500,
    });
  },

  // ==========================================
  // WALLET MONITORING
  // ==========================================
  getWalletBySubscriptionId: async (subscriptionId: string) => {
    const wallet = await prisma.subscription_wallets.findUnique({
      where: { subscription_id: subscriptionId },
    });
    if (!wallet) throw new Error("WALLET_NOT_FOUND");
    return wallet;
  },

  getWalletTransactions: async (
    subscriptionId: string,
    page: number,
    limit: number,
  ) => {
    const skip = (page - 1) * limit;

    // First ensure wallet exists
    const wallet = await prisma.subscription_wallets.findUnique({
      where: { subscription_id: subscriptionId },
    });
    if (!wallet) throw new Error("WALLET_NOT_FOUND");

    const [transactions, total] = await Promise.all([
      prisma.wallet_transactions.findMany({
        where: { subscription_wallet_id: wallet.id },
        skip,
        take: limit,
        orderBy: { created_at: "desc" },
      }),
      prisma.wallet_transactions.count({
        where: { subscription_wallet_id: wallet.id },
      }),
    ]);

    return { transactions, total, page, limit };
  },

  // ==========================================
  // TIFFIN TRACKING
  // ==========================================
  getTiffinDefaulters: async () => {
    return await prisma.tiffin_tracker.findMany({
      where: { tiffins_due: { gte: 1 } },
      include: {
        subscriptions: {
          include: {
            users: {
              select: { first_name: true, last_name: true, phone: true },
            },
          },
        },
      },
      orderBy: { created_at: "desc" },
    });
  },

  // ==========================================
  // ALERTS SYSTEM
  // ==========================================
  getSystemAlerts: async () => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [negativeWallets, blockedDeliveries] = await Promise.all([
      // Alert 1: Users with negative wallet balances
      prisma.subscription_wallets.findMany({
        where: { balance: { lt: 0 } },
        include: {
          subscriptions: {
            include: { users: { select: { first_name: true, phone: true } } },
          },
        },
      }),

      // Alert 2: Today's blocked deliveries
      prisma.deliveries.findMany({
        where: {
          status: "BLOCKED_TIFFIN_DEBT",
          delivery_date: { gte: todayStart },
        },
        include: {
          subscriptions: {
            include: { users: { select: { first_name: true, phone: true } } },
          },
        },
      }),
    ]);

    return {
      negative_wallets: negativeWallets,
      blocked_deliveries: blockedDeliveries,
    };
  },
};
