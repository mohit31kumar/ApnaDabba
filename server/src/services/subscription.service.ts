import prisma from '../lib/prisma';
import { Prisma } from '@prisma/client';

export const subscriptionService = {
  
  createPlan: async (data: {
    plan_code: string;
    name: string;
    description?: string;
    price_per_meal: number;
    security_deposit: number;
    skip_limit: number;
    buffer_days: number;
  }, adminId: string) => {
    return await prisma.$transaction(async (tx) => {
      const existingPlan = await tx.plan_configs.findUnique({
        where: { plan_code: data.plan_code }
      });

      if (existingPlan) {
        throw new Error('PLAN_CODE_EXISTS');
      }

      const newPlan = await tx.plan_configs.create({ data });

      await tx.audit_logs.create({
        data: {
          entity_name: 'plan_configs',
          entity_id: newPlan.id,
          action: 'ADMIN_CREATED_PLAN',
          new_state: data as any,
          performed_by: adminId
        }
      });

      return newPlan;
    });
  },

  getAllActivePlans: async () => {
    return await prisma.plan_configs.findMany({
      where: { is_active: true },
      orderBy: { price_per_meal: 'asc' }
    });
  },

  subscribeUser: async (data: {
    userId: string;
    planConfigId: string;
    deliveryAddressId: string;
    startDate: string; 
    endDate: string;   
  }) => {
    const { userId, planConfigId, deliveryAddressId, startDate, endDate } = data;
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (start >= end) {
      throw new Error('INVALID_DATE_RANGE');
    }

    return await prisma.$transaction(async (tx) => {
      // 1. Validate User & Address
      const address = await tx.delivery_addresses.findFirst({
        where: { id: deliveryAddressId, user_id: userId, is_active: true }
      });
      if (!address) throw new Error('INVALID_ADDRESS');

      // 2. Fetch Plan to Snapshot Data
      const plan = await tx.plan_configs.findUnique({
        where: { id: planConfigId, is_active: true }
      });
      if (!plan) throw new Error('INVALID_PLAN');

      // 3. Create Subscription (with Snapshots)
      const subscription = await tx.subscriptions.create({
        data: {
          user_id: userId,
          plan_config_id: plan.id,
          delivery_address_id: address.id,
          status: 'ACTIVE',
          start_date: start,
          end_date: end,
          skip_balance: plan.skip_limit,
          skipped_meal_pool: 0,
          buffer_meals_remaining: 0,
          
          price_per_meal_snapshot: plan.price_per_meal,
          total_price_snapshot: new Prisma.Decimal(0), 
          security_deposit_snapshot: plan.security_deposit,
          skip_limit_snapshot: plan.skip_limit,
          buffer_days_snapshot: plan.buffer_days,
          plan_code_snapshot: plan.plan_code
        }
      });

      // 4. Create Isolated Wallet (1:1 constraint)
      await tx.subscription_wallets.create({
        data: {
          subscription_id: subscription.id,
          balance: 0.00,
          security_deposit_held: plan.security_deposit
        }
      });

      // 5. Create Tiffin Tracker (1:1 constraint)
      await tx.tiffin_tracker.create({
        data: {
          subscription_id: subscription.id,
          tiffins_due: 0,
          security_deducted: false
        }
      });

      // 6. Audit Trail
      await tx.audit_logs.create({
        data: {
          entity_name: 'subscriptions',
          entity_id: subscription.id,
          action: 'CUSTOMER_SUBSCRIBED',
          new_state: { plan_code: plan.plan_code, start_date: start, end_date: end },
          performed_by: userId
        }
      });

      return subscription;
    });
  }
};