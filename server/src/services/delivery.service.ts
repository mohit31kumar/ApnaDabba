import prisma from "../lib/prisma";
import { Prisma } from "@prisma/client";

export const deliveryService = {
  // ==========================================
  // SYSTEM / CUSTOMER ROUTES (From Previous Feature)
  // ==========================================
  generateDeliveriesForSlot: async (
    targetDate: string,
    slot: "LUNCH" | "DINNER",
  ) => {
    const dateObj = new Date(targetDate);
    dateObj.setHours(0, 0, 0, 0);

    const targetSubscriptions = await prisma.subscriptions.findMany({
      where: {
        OR: [
          {
            status: "ACTIVE",
            start_date: { lte: dateObj },
            end_date: { gte: dateObj },
          },
          {
            status: "BUFFER",
            buffer_expiry_date: { gte: dateObj },
            buffer_meals_remaining: { gt: 0 },
          },
        ],
      },
      include: { users: { select: { is_active: true } }, tiffin_tracker: true },
    });

    let generatedCount = 0;
    const errors: any[] = [];
    const cutoffTime = new Date(dateObj);
    if (slot === "LUNCH") cutoffTime.setHours(10, 0, 0, 0);
    else cutoffTime.setHours(16, 0, 0, 0);

    for (const sub of targetSubscriptions) {
      if (!sub.users.is_active) continue;
      try {
        await prisma.$transaction(async (tx) => {
          const isBlockedByDebt =
            sub.tiffin_tracker && sub.tiffin_tracker.tiffins_due >= 2;
          const deliveryStatus = isBlockedByDebt
            ? "BLOCKED_TIFFIN_DEBT"
            : "PENDING";
          const isBuffer = sub.status === "BUFFER";

          await tx.deliveries.create({
            data: {
              subscription_id: sub.id,
              delivery_date: dateObj,
              slot: slot,
              status: deliveryStatus,
              cutoff_time: cutoffTime,
              is_buffer_meal: isBuffer,
            },
          });

          if (isBuffer) {
            await tx.subscriptions.update({
              where: { id: sub.id },
              data: { buffer_meals_remaining: { decrement: 1 } },
            });
          }
        });
        generatedCount++;
      } catch (err: any) {
        if (err.code !== "P2002")
          errors.push({ sub_id: sub.id, error: err.message });
      }
    }
    return { generatedCount, errors };
  },

  skipDelivery: async (deliveryId: string, customerId: string) => {
    return await prisma.$transaction(async (tx) => {
      const delivery = await tx.deliveries.findUnique({
        where: { id: deliveryId },
        include: { subscriptions: true },
      });

      if (!delivery) throw new Error("DELIVERY_NOT_FOUND");
      if (delivery.subscriptions.user_id !== customerId)
        throw new Error("FORBIDDEN");
      if (delivery.status !== "PENDING") throw new Error("INVALID_STATE");
      if (delivery.is_buffer_meal) throw new Error("CANNOT_SKIP_BUFFER_MEAL");
      if (new Date() >= delivery.cutoff_time)
        throw new Error("CUTOFF_TIME_PASSED");
      if (delivery.subscriptions.skip_balance <= 0)
        throw new Error("NO_SKIPS_REMAINING");

      const updatedDelivery = await tx.deliveries.update({
        where: { id: deliveryId },
        data: { status: "SKIPPED" },
      });

      await tx.subscriptions.update({
        where: { id: delivery.subscription_id },
        data: {
          skip_balance: { decrement: 1 },
          skipped_meal_pool: { increment: 1 },
        },
      });

      return updatedDelivery;
    });
  },

  // ==========================================
  // DRIVER FLOW ROUTES (New Features)
  // ==========================================

  getAssignedDeliveries: async (
    driverId: string,
    date: string,
    slot: "LUNCH" | "DINNER",
  ) => {
    // Fetches deliveries grouped by date, slot, and delivery address logic
    const deliveries = await prisma.deliveries.findMany({
      where: {
        delivery_date: new Date(date),
        slot: slot,
        status: { in: ["DISPATCHED", "PENDING"] }, // Drivers might see dispatched or pending ones
      },
      include: {
        subscriptions: {
          include: {
            delivery_addresses: true,
            users: {
              select: { first_name: true, last_name: true, phone: true },
            },
          },
        },
      },
      orderBy: {
        subscriptions: { delivery_address_id: "asc" }, // Groups by address
      },
    });

    return deliveries;
  },

  markArrivedOrFailed: async (
    deliveryId: string,
    driverId: string,
    status: "ARRIVED_AT_LOCATION" | "FAILED",
    lat: number,
    lng: number,
  ) => {
    return await prisma.$transaction(async (tx) => {
      const delivery = await tx.deliveries.findUnique({
        where: { id: deliveryId },
      });
      if (!delivery) throw new Error("DELIVERY_NOT_FOUND");

      // [FIX] ISSUE 5: Idempotency Protection
      if (delivery.status === "DELIVERED") {
        throw new Error("ALREADY_PROCESSED");
      }

      // [FIX] ISSUE 2: Delivery State Validation
      if (delivery.status !== "PENDING" && delivery.status !== "DISPATCHED") {
        throw new Error("INVALID_STATE");
      }

      // [FIX] ISSUE 4: Driver Ownership Check (Placeholder)
      // logic to verify driver is assigned to this specific delivery/route
      if (delivery.driver_id !== driverId) throw new Error("FORBIDDEN");

      await tx.route_logs.create({
        data: {
          delivery_boy_id: driverId,
          delivery_id: deliveryId,
          lat,
          lng,
          event:
            status === "ARRIVED_AT_LOCATION"
              ? "ARRIVED_AT_LOCATION"
              : "DELIVERY_ATTEMPTED",
        },
      });

      if (status === "FAILED") {
        return await tx.deliveries.update({
          where: { id: deliveryId },
          data: { status: "FAILED" },
        });
      }

      return delivery;
    });
  },

  markDelivered: async (
    deliveryId: string,
    driverId: string,
    tiffinBoxId: string,
    returnedTiffinBoxId: string | null,
    lat: number,
    lng: number,
  ) => {
    return await prisma.$transaction(async (tx) => {
      // 1. Fetch Entities
      const delivery = await tx.deliveries.findUnique({
        where: { id: deliveryId },
        include: { subscriptions: true },
      });

      if (!delivery) throw new Error("DELIVERY_NOT_FOUND");
      // [FIX] ISSUE 5: Idempotency Protection
      if (delivery.status === "DELIVERED") {
        throw new Error("ALREADY_PROCESSED");
      }

      // [FIX] ISSUE 2: Delivery State Validation
      if (delivery.status !== "PENDING" && delivery.status !== "DISPATCHED") {
        throw new Error("INVALID_STATE");
      }

      // [FIX] ISSUE 4: Driver Ownership Check (Placeholder)
      // TODO: Add logic to verify driver is assigned to this specific delivery/route
      if (delivery.driver_id !== driverId) throw new Error("FORBIDDEN");

      // [FIX] ISSUE 3: Tiffin Box Validation
      const tracker = await tx.tiffin_tracker.findUnique({
        where: { subscription_id: delivery.subscription_id },
      });

      const wallet = await tx.subscription_wallets.findUnique({
        where: { subscription_id: delivery.subscription_id },
      });

      if (!tracker || !wallet) throw new Error("DATA_INTEGRITY_ERROR");

      const mealCost = delivery.subscriptions.price_per_meal_snapshot;
      if (mealCost == null) {
        throw new Error("INVALID_PRICE_CONFIGURATION");
      }

      if (!wallet || wallet.balance < mealCost) {
        throw new Error("INSUFFICIENT_BALANCE");
      }

      // 2. Strict Blocking Rule Enforcement
      if (tracker.tiffins_due >= 2) {
        await tx.deliveries.update({
          where: { id: deliveryId },
          data: { status: "BLOCKED_TIFFIN_DEBT" },
        });
        throw new Error("BLOCKED_TIFFIN_DEBT");
      }

      // [FIX] ISSUE 3: Tiffin Box Validation
      const newTiffinBox = await tx.tiffin_boxes.findUnique({
        where: { id: tiffinBoxId },
      });
      if (!newTiffinBox) throw new Error("TIFFIN_NOT_FOUND");
      if (newTiffinBox.status === "WITH_CUSTOMER")
        throw new Error("TIFFIN_ALREADY_WITH_CUSTOMER");

      if (returnedTiffinBoxId) {
        const returnedTiffin = await tx.tiffin_boxes.findUnique({
          where: { id: returnedTiffinBoxId },
        });
        if (!returnedTiffin) throw new Error("RETURNED_TIFFIN_NOT_FOUND");
      }

      // 3. Tiffin Tracker Logic (Inside Same Transaction)
      let newTiffinsDue = tracker.tiffins_due + 1; // New box given
      if (returnedTiffinBoxId) {
        newTiffinsDue -= 1; // Old box collected
      }

      await tx.tiffin_tracker.update({
        where: { id: tracker.id },
        data: { tiffins_due: newTiffinsDue },
      });

      // 4. Update Delivery Status & Timestamp
      const updateResult = await tx.deliveries.updateMany({
        where: {
          id: deliveryId,
          status: { in: ["PENDING", "DISPATCHED"] },
        },
        data: {
          status: "DELIVERED",
          delivered_at: new Date(),
          tiffin_box_id: tiffinBoxId,
          location_locked: true,
          location_locked_at: new Date(),
        },
      });

      if (updateResult.count === 0) {
        throw new Error("DELIVERY_ALREADY_COMPLETED");
      }

      const updatedDelivery = await tx.deliveries.findUnique({
        where: { id: deliveryId },
      });

      // 5. Log Tiffin Events
      await tx.tiffin_events.create({
        data: {
          tiffin_box_id: tiffinBoxId,
          delivery_id: deliveryId,
          action: "DELIVERED",
          performed_by: driverId,
        },
      });

      if (returnedTiffinBoxId) {
        await tx.tiffin_events.create({
          data: {
            tiffin_box_id: returnedTiffinBoxId,
            delivery_id: deliveryId,
            action: "COLLECTED",
            performed_by: driverId,
          },
        });

        // Update old physical box status
        await tx.tiffin_boxes.update({
          where: { id: returnedTiffinBoxId },
          data: { status: "IN_KITCHEN" },
        });
      }

      // Update new physical box status
      await tx.tiffin_boxes.update({
        where: { id: tiffinBoxId },
        data: { status: "WITH_CUSTOMER" },
      });

      // 6. Wallet Deduction Logic (Inside Same Transaction)

      await tx.subscription_wallets.update({
        where: { id: wallet.id },
        data: { balance: { decrement: mealCost } },
      });

      await tx.wallet_transactions.create({
        data: {
          subscription_wallet_id: wallet.id,
          amount: mealCost,
          transaction_type: "DEBIT",
          transaction_category: "MEAL_DEDUCTION",
          reference_id: deliveryId,
          description: `Meal deduction for delivery ${deliveryId}`,
        },
      });

      // 7. Route Logging
      await tx.route_logs.create({
        data: {
          delivery_boy_id: driverId,
          delivery_id: deliveryId,
          lat,
          lng,
          event: "HANDOVER_COMPLETE",
        },
      });

      return updatedDelivery;
    });
  },
};

// Helper function to fetch assigned deliveries for driver (used in controller)

export const getAssignedDeliveriesForDriver = async (
  driverId: string,
  dateString: string,
  slot?: 'LUNCH' | 'DINNER'
) => {
  const targetDate = new Date(dateString);
  
  if (isNaN(targetDate.getTime())) {
    throw new Error('INVALID_DATE');
  }

  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);
  
  const nextDay = new Date(startOfDay);
  nextDay.setDate(nextDay.getDate() + 1);

  const whereClause: Prisma.deliveriesWhereInput = {
    driver_id: driverId,
    delivery_date: {
      gte: startOfDay,
      lt: nextDay,
    },
  };

  if (slot) {
    whereClause.slot = slot;
  }

  const deliveries = await prisma.deliveries.findMany({
    where: whereClause,
    select: {
      id: true,
      delivery_date: true,
      slot: true,
      status: true,
      subscription_id: true,
    },
    orderBy: {
      delivery_date: 'asc',
    },
  });

  return deliveries;
};