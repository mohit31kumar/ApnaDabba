import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { validators } from '../utils/validators';

/**
 * Ensures the user has one of the allowed roles.
 * ADMIN automatically bypasses this check.
 */
export const requireRole = (...allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !req.user.role) {
      res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Authentication required.'
      });
      return;
    }

    // ADMIN has full access to all routes
    if (req.user.role === 'ADMIN') {
      return next();
    }

    // Check if user's role is in the allowed list
    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: 'You do not have permission to access this resource.'
      });
      return;
    }

    next();
  };
};

/**
 * Ensures the requesting user owns the requested resource.
 * ADMIN automatically bypasses this check.
 * 
 * @param model - The Prisma model name (e.g., 'subscriptions', 'deliveries')
 * @param idParam - The URL parameter key containing the resource ID (e.g., 'id')
 * @param ownerPath - The object path to the user ID (e.g., 'user_id' or 'subscription.user_id')
 */
export const requireOwnership = (model: string, idParam: string = 'id', ownerPath: string = 'user_id') => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user || !req.user.id) {
        res.status(401).json({
          success: false,
          error: 'UNAUTHORIZED',
          message: 'Authentication required.'
        });
        return;
      }

      const resourceId = req.params[idParam] as string;
      if (!resourceId) {
        res.status(400).json({
          success: false,
          error: 'BAD_REQUEST',
          message: `Missing URL parameter: ${idParam}`
        });
        return;
      }

      // [AUDIT FIX] Prevent Prisma P2023 Error by validating UUID before querying
      if (!validators.isUUID(resourceId)) {
        res.status(400).json({
          success: false,
          error: 'BAD_REQUEST',
          message: 'Invalid resource ID format. Must be a valid UUID.'
        });
        return;
      }

      const delegate = (prisma as any)[model];
      if (!delegate) {
        throw new Error(`Prisma model '${model}' does not exist.`);
      }

      // [AUDIT FIX] Dynamically include relations if the ownerPath is nested (e.g., 'subscription.user_id')
      const includeRelation = ownerPath.includes('.') ? { [ownerPath.split('.')[0]]: true } : undefined;

      const resource = await delegate.findUnique({
        where: { id: resourceId },
        include: includeRelation
      });

      if (!resource) {
        res.status(404).json({
          success: false,
          error: 'NOT_FOUND',
          message: 'Requested resource not found.'
        });
        return;
      }

      if (req.user.role === 'ADMIN') {
        req.resource = resource; 
        return next();
      }

      // Dynamically resolve the owner ID based on the provided path
      const pathParts = ownerPath.split('.');
      let resolvedOwnerId = resource;
      for (const part of pathParts) {
        resolvedOwnerId = resolvedOwnerId ? resolvedOwnerId[part] : undefined;
      }

      if (resolvedOwnerId !== req.user.id) {
        res.status(403).json({
          success: false,
          error: 'FORBIDDEN',
          message: 'Access denied. You do not own this resource.'
        });
        return;
      }

      // Attach resource to request to prevent duplicate DB calls in the controller
      req.resource = resource;
      next();

    } catch (error: any) {
      console.error(`[RBAC] requireOwnership Error on model '${model}':`, error.message);
      res.status(500).json({
        success: false,
        error: 'SERVER_ERROR',
        message: 'An unexpected error occurred during authorization.'
      });
    }
  };
};