import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/env';

export const tokenUtils = {
  generateAccessToken: (userId: string, role: string): string => {
    return jwt.sign(
      { id: userId, role },
      env.JWT_SECRET,
      { expiresIn: '15m' }
    );
  },

  generateRawRefreshToken: (): string => {
    return crypto.randomBytes(40).toString('hex');
  },

  hashRefreshToken: (rawToken: string): string => {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }
};