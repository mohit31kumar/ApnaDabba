import prisma from '../lib/prisma';

export const bufferService = {
  
  /**
   * Transitions ended ACTIVE subscriptions into BUFFER state.
   * Calculates expiry dates and activates the skipped_meal_pool.
   */
  processBufferTransitions: async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const eligibleSubscriptions = await prisma.subscriptions.findMany({
      where: {
        status: 'ACTIVE',
        end_date: { lt: today }
      }
    });

    let transitionedCount = 0;

    for (const sub of eligibleSubscriptions) {
      await prisma.$transaction(async (tx) => {
        // Re-read subscription inside transaction to get fresh skipped_meal_pool
        const freshSub = await tx.subscriptions.findUnique({
          where: { id: sub.id },
          select: { status: true, end_date: true, buffer_days_snapshot: true, skipped_meal_pool: true },
        });

        if (!freshSub || freshSub.status !== 'ACTIVE') return;

        const expiryDate = new Date(freshSub.end_date);
        expiryDate.setDate(expiryDate.getDate() + freshSub.buffer_days_snapshot);

        await tx.subscriptions.update({
          where: { id: sub.id },
          data: {
            status: 'BUFFER',
            buffer_start_date: freshSub.end_date,
            buffer_expiry_date: expiryDate,
            buffer_meals_remaining: freshSub.skipped_meal_pool
          }
        });

        await tx.audit_logs.create({
          data: {
            entity_name: 'subscriptions',
            entity_id: sub.id,
            action: 'SYSTEM_BUFFER_ACTIVATED',
            new_state: { status: 'BUFFER', meals_transferred: freshSub.skipped_meal_pool }
          }
        });
      });
      transitionedCount++;
    }

    return transitionedCount;
  },

  /**
   * Marks expired buffer subscriptions and cleans up pending deliveries.
   */
  processBufferExpirations: async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const expiredSubscriptions = await prisma.subscriptions.findMany({
      where: {
        status: 'BUFFER',
        buffer_expiry_date: { lt: today }
      }
    });

    let expiredCount = 0;

    for (const sub of expiredSubscriptions) {
      await prisma.$transaction(async (tx) => {
        
        await tx.subscriptions.update({
          where: { id: sub.id },
          data: {
            status: 'EXPIRED',
            buffer_meals_remaining: 0
          }
        });

        await tx.deliveries.updateMany({
          where: {
            subscription_id: sub.id,
            status: 'PENDING',
            is_buffer_meal: true
          },
          data: { status: 'EXPIRED_BUFFER' }
        });

        await tx.audit_logs.create({
          data: {
            entity_name: 'subscriptions',
            entity_id: sub.id,
            action: 'SYSTEM_BUFFER_EXPIRED',
            new_state: { status: 'EXPIRED', meals_lost: sub.buffer_meals_remaining }
          }
        });
      });
      expiredCount++;
    }

    return expiredCount;
  }
};