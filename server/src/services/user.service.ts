import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma';

export const userService = {
  getProfile: async (userId: string) => {
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
      }
    });

    if (!user) {
      throw new Error('USER_NOT_FOUND');
    }

    return user;
  },

  getAllUsers: async (page: number = 1, limit: number = 10, role?: string) => {
    const skip = (page - 1) * limit;
    
    const whereClause = role ? { role } : {};

    const [users, total] = await Promise.all([
      prisma.users.findMany({
        where: whereClause,
        select: {
          id: true,
          phone: true,
          role: true,
          first_name: true,
          last_name: true,
          is_active: true,
          created_at: true,
        },
        skip,
        take: limit,
        orderBy: { created_at: 'desc' }
      }),
      prisma.users.count({ where: whereClause })
    ]);

    return { users, total, page, limit };
  },

  createAdminUser: async (params: any, adminId: string) => {
    const { phone, role, password, first_name, last_name } = params;

    const existingUser = await prisma.users.findUnique({
      where: { phone }
    });

    if (existingUser) {
      throw new Error('PHONE_ALREADY_EXISTS');
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    // Atomic transaction to ensure audit log is always created alongside the user
    const safeUser = await prisma.$transaction(async (tx) => {
      const user = await tx.users.create({
        data: {
          phone,
          role,
          first_name,
          last_name,
          password_hash,
          is_temp_password: true,
          is_active: true
        },
        select: {
          id: true,
          phone: true,
          role: true,
          first_name: true,
          last_name: true,
          is_temp_password: true,
          created_at: true
        }
      });

      await tx.audit_logs.create({
        data: {
          entity_name: 'users',
          entity_id: user.id,
          action: 'ADMIN_CREATED_USER',
          new_state: { phone: user.phone, role: user.role },
          performed_by: adminId
        }
      });

      return user;
    });

    return safeUser;
  },

  updateUserStatus: async (targetUserId: string, isActive: boolean, adminId: string) => {
    return await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.users.update({
        where: { id: targetUserId },
        data: { is_active: isActive },
        select: {
          id: true,
          phone: true,
          is_active: true
        }
      });

      await tx.audit_logs.create({
        data: {
          entity_name: 'users',
          entity_id: updatedUser.id,
          action: isActive ? 'ADMIN_ENABLED_USER' : 'ADMIN_DISABLED_USER',
          new_state: { is_active: isActive },
          performed_by: adminId
        }
      });

      return updatedUser;
    });
  }
};