import { Request, Response, NextFunction } from 'express';
import AuditLog from '../models/AuditLog';
import { AuthRequest } from './authMiddleware';

export const auditLog = (actionName: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    // We want to log after the request has been processed to capture the result
    res.on('finish', async () => {
      if (req.user) {
        try {
          const log = new AuditLog({
            userId: req.user._id,
            action: actionName,
            details: `Method: ${req.method} | URL: ${req.originalUrl} | Status: ${res.statusCode}`,
          });
          await log.save();
        } catch (error) {
          console.error('Audit log failed', error);
        }
      }
    });
    next();
  };
};
