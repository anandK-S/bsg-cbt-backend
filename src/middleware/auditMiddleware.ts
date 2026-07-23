import { Request, Response, NextFunction } from 'express';
import { supabase } from '../config/supabase';
import { AuthRequest } from './authMiddleware';

export const auditLog = (actionName: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    // We want to log after the request has been processed to capture the result
    res.on('finish', async () => {
      if (req.user) {
        try {
          await supabase.from('audit_logs').insert({
            user_id: req.user._id || req.user.id,
            action: actionName,
            details: `Method: ${req.method} | URL: ${req.originalUrl} | Status: ${res.statusCode}`,
          });
        } catch (error) {
          console.error('Audit log failed', error);
        }
      }
    });
    next();
  };
};
