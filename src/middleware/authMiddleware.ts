import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { supabase } from '../config/supabase';

export interface AuthRequest extends Request {
  user?: any;
}

const protect = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies.jwt) {
    token = req.cookies.jwt;
  }

  if (token) {
    try {
      // First try to verify as custom JWT
      let userId = null;
      try {
        const decoded: any = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        userId = decoded.userId || decoded.id;
      } catch (err) {
        // Not a custom JWT, maybe a Supabase Auth JWT?
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (!error && user) {
          userId = user.id;
        }
      }

      if (!userId) {
        res.status(401).json({ message: 'Not authorized, token failed' });
        return;
      }

      // Fetch user profile from Supabase
      const { data: userProfile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
        
      if (error || !userProfile) {
        res.status(401).json({ message: 'User profile not found' });
        return;
      }

      req.user = {
        ...userProfile,
        _id: userProfile.id // For frontend compatibility
      };

      if (req.user.status === 'Blocked') {
        res.status(403).json({ message: 'User is blocked' });
        return;
      }
      next();
    } catch (error) {
      res.status(401).json({ message: 'Not authorized, token failed' });
    }
  } else {
    res.status(401).json({ message: 'Not authorized, no token' });
  }
};

const admin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user && req.user.role === 'Admin') {
    next();
  } else {
    res.status(403).json({ message: 'Not authorized as an admin' });
  }
};

const examiner = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user && (req.user.role === 'Examiner' || req.user.role === 'Admin')) {
    next();
  } else {
    res.status(403).json({ message: 'Not authorized as an examiner' });
  }
};

export { protect, admin, examiner };
