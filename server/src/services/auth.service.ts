import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma';
import { tokenUtils } from '../utils/token.utils';

export const authService = {
  register: async (phone: string, password: string, first_name: string, last_name: string, role: string) => {
    const existingUser = await prisma.users.findUnique({
      where: { phone }
    });

    if (existingUser) {
      throw new Error('PHONE_ALREADY_EXISTS');
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    const user = await prisma.users.create({
      data: {
        phone,
        role,
        first_name,
        last_name,
        password_hash,
        is_temp_password: false,
        is_active: true
      },
      select: {
        id: true,
        phone: true,
        role: true,
        first_name: true,
        last_name: true,
        is_temp_password: true
      }
    });

    const accessToken = tokenUtils.generateAccessToken(user.id, user.role);
    const rawRefreshToken = tokenUtils.generateRawRefreshToken();
    const hashedRefreshToken = tokenUtils.hashRefreshToken(rawRefreshToken);

    const refreshTokenExpiry = new Date();
    refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 7);

    await prisma.refresh_tokens.create({
      data: {
        user_id: user.id,
        token_hash: hashedRefreshToken,
        expires_at: refreshTokenExpiry,
        revoked: false
      }
    });

    const safeUser = {
      id: user.id,
      phone: user.phone,
      role: user.role,
      first_name: user.first_name,
      last_name: user.last_name
    };

    return {
      user: safeUser,
      tokens: {
        access_token: accessToken,
        refresh_token: rawRefreshToken
      },
      force_password_change: false
    };
  },

  loginWithPassword: async (phone: string, password: string) => {
    const user = await prisma.users.findUnique({
      where: { phone }
    });

    if (!user) {
      throw new Error('INVALID_CREDENTIALS');
    }

    if (!user.is_active) {
      throw new Error('ACCOUNT_DISABLED');
    }

    if (!user.password_hash) {
      throw new Error('INVALID_CREDENTIALS');
    }
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      throw new Error('INVALID_CREDENTIALS');
    }

    const accessToken = tokenUtils.generateAccessToken(user.id, user.role);
    const rawRefreshToken = tokenUtils.generateRawRefreshToken();
    const hashedRefreshToken = tokenUtils.hashRefreshToken(rawRefreshToken);

    const refreshTokenExpiry = new Date();
    refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 7);

    await prisma.refresh_tokens.create({
      data: {
        user_id: user.id,
        token_hash: hashedRefreshToken,
        expires_at: refreshTokenExpiry,
        revoked: false
      }
    });

    const safeUser = {
      id: user.id,
      phone: user.phone,
      role: user.role,
      first_name: user.first_name,
      last_name: user.last_name
    };

    return {
      user: safeUser,
      tokens: {
        access_token: accessToken,
        refresh_token: rawRefreshToken 
      },
      force_password_change: user.is_temp_password
    };
  },

  rotateRefreshToken: async (rawRefreshToken: string) => {
    const hashedToken = tokenUtils.hashRefreshToken(rawRefreshToken);

    const existingToken = await prisma.refresh_tokens.findUnique({
      where: { token_hash: hashedToken },
      include: { users: true }
    });

    if (!existingToken) {
      throw new Error('INVALID_TOKEN');
    }

    if (existingToken.revoked) {
      throw new Error('TOKEN_REUSED');
    }

    if (!existingToken.users.is_active) {
      throw new Error('ACCOUNT_DISABLED');
    }

    const nowWithTolerance = new Date(Date.now() - 15000);
    if (existingToken.expires_at < nowWithTolerance) {
      throw new Error('INVALID_TOKEN');
    }

    const accessToken = tokenUtils.generateAccessToken(existingToken.user_id, existingToken.users.role);
    const newRawRefreshToken = tokenUtils.generateRawRefreshToken();
    const newHashedRefreshToken = tokenUtils.hashRefreshToken(newRawRefreshToken);
    
    const newExpiry = new Date();
    newExpiry.setDate(newExpiry.getDate() + 7);

    await prisma.$transaction(async (tx) => {
      // Re-check user active status inside transaction
      const user = await tx.users.findUnique({
        where: { id: existingToken.user_id },
        select: { is_active: true },
      });

      if (!user || !user.is_active) {
        throw new Error('ACCOUNT_DISABLED');
      }

      const revocationResult = await tx.refresh_tokens.updateMany({
        where: {
          id: existingToken.id,
          revoked: false 
        },
        data: { revoked: true }
      });

      if (revocationResult.count === 0) {
        throw new Error('TOKEN_REUSED');
      }

      await tx.refresh_tokens.create({
        data: {
          user_id: existingToken.user_id,
          token_hash: newHashedRefreshToken,
          expires_at: newExpiry,
          revoked: false
        }
      });
      // Note: Deliberately NOT deleting old tokens as per strictly enforced rule.
    });

    return {
      access_token: accessToken,
      refresh_token: newRawRefreshToken
    };
  },

  logout: async (userId: string, rawRefreshToken: string): Promise<void> => {
    const hashedToken = tokenUtils.hashRefreshToken(rawRefreshToken);

    const tokenRecord = await prisma.refresh_tokens.findUnique({
      where: { token_hash: hashedToken }
    });

    if (!tokenRecord || tokenRecord.user_id !== userId) {
      throw new Error('INVALID_TOKEN');
    }

    if (tokenRecord.revoked) {
      throw new Error('TOKEN_ALREADY_REVOKED');
    }

    await prisma.refresh_tokens.update({
      where: { id: tokenRecord.id },
      data: { revoked: true }
    });
  },

  logoutAll: async (userId: string): Promise<void> => {
    await prisma.refresh_tokens.updateMany({
      where: { 
        user_id: userId,
        revoked: false 
      },
      data: { revoked: true }
    });
  }
};