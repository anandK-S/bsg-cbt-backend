import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import generateToken from '../utils/generateToken';
import jwt from 'jsonwebtoken';

// @desc    Auth user & get token
// @route   POST /api/auth/login
// @access  Public
export const loginUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !signInData.user) {
      res.status(401).json({ message: 'Invalid credentials' }); return;
    }

    const { data: userProfile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', signInData.user.id)
      .single();

    if (profileError || !userProfile) {
      res.status(401).json({ message: 'User profile not found' }); return;
    }

    if (userProfile.status === 'Blocked') {
      res.status(403).json({ message: 'User is blocked' }); return;
    }

    if (userProfile.locked_until && new Date(userProfile.locked_until) > new Date()) {
      res.status(403).json({ message: `Account is temporarily locked. Try again later.` }); return;
    }
    
    // Reset failed attempts
    await supabase.from('profiles').update({ failed_login_attempts: 0, locked_until: null, last_login: new Date().toISOString() }).eq('id', userProfile.id);
    
    const { data: settings } = await supabase.from('settings').select('*').single();
    if (settings?.maintenance_mode && userProfile.role !== 'Admin') {
        res.status(503).json({ 
          message: 'The platform is currently under maintenance. Please try again later.',
        });
        return;
    }

    // Return the Supabase JWT so the frontend can use it, OR generate a local one.
    // Since we support Supabase JWTs in authMiddleware, returning Supabase token is best.
    const token = signInData.session.access_token;
    
    // Also set standard cookie just in case
    res.cookie('jwt', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV !== 'development',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    try {
      await supabase.from('audit_logs').insert({
        user_id: userProfile.id,
        action: 'LOGIN',
        details: `User logged in from IP: ${req.ip || 'Unknown'}`,
      });
    } catch (err) {}

    res.json({
      _id: userProfile.id,
      name: userProfile.name,
      email: userProfile.email,
      role: userProfile.role,
      bsgId: userProfile.bsgid,
      district: userProfile.district,
      unitNumber: userProfile.unit_number,
      unitName: userProfile.unit_name,
      profileImage: userProfile.profile_image,
      token,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message || 'Server error' }); return;
  }
};

// @desc    Register a new user (Candidate or Admin via secret code)
// @route   POST /api/auth/register
// @access  Public
export const registerUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password, bsgId, section, adminCode, examinerCode, district, unitNumber, unitName } = req.body;

    const nameRegex = /^[a-zA-Z\s]+$/;
    if (!nameRegex.test(name)) {
      res.status(400).json({ message: 'Name can only contain letters and spaces.' }); return;
    }

    if (password.length < 6) {
      res.status(400).json({ message: 'Password must be at least 6 characters.' }); return;
    }

    let assignedRole: 'Candidate' | 'Examiner' | 'Admin' = 'Candidate';
    if (adminCode && process.env.ADMIN_REGISTRATION_CODE && adminCode === process.env.ADMIN_REGISTRATION_CODE) {
      assignedRole = 'Admin';
    } else if (examinerCode && process.env.EXAMINER_SECRET_CODE && examinerCode === process.env.EXAMINER_SECRET_CODE) {
      assignedRole = 'Examiner';
    } else if (examinerCode) {
      res.status(400).json({ message: 'Invalid Examiner Secret Code' }); return;
    }

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name, role: assignedRole }
      }
    });

    if (authError || !authData.user) {
      res.status(400).json({ message: authError?.message || 'Registration failed' }); return;
    }

    const { data: profileData, error: profileError } = await supabase.from('profiles').insert({
      id: authData.user.id,
      name,
      email,
      role: assignedRole,
      bsgid: bsgId,
      section,
      district,
      unit_number: unitNumber,
      unit_name: unitName,
      status: 'Active'
    }).select().single();

    if (profileError) {
      res.status(400).json({ message: profileError.message }); return;
    }

    const token = authData.session?.access_token || '';

    res.status(201).json({
      _id: profileData.id,
      name: profileData.name,
      email: profileData.email,
      role: profileData.role,
      bsgId: profileData.bsgid,
      district: profileData.district,
      unitNumber: profileData.unit_number,
      unitName: profileData.unit_name,
      profileImage: profileData.profile_image,
      token,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message || 'Server error' }); return;
  }
};

// @desc    Logout user / clear cookie
// @route   POST /api/auth/logout
// @access  Public
export const logoutUser = async (req: Request, res: Response): Promise<void> => {
  const token = req.cookies.jwt;
  if (token) {
    try {
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) {
        await supabase.from('profiles').update({ last_logout: new Date().toISOString() }).eq('id', user.id);
        try {
          await supabase.from('audit_logs').insert({
            user_id: user.id,
            action: 'LOGOUT',
            details: `User logged out from IP: ${req.ip || 'Unknown'}`,
          });
        } catch (err) {}
      }
    } catch (error) {}
  }

  res.cookie('jwt', '', {
    httpOnly: true,
    expires: new Date(0),
  });
  res.status(200).json({ message: 'Logged out successfully' }); return;
};

// @desc    Get user profile
// @route   GET /api/auth/me
// @access  Private
export const getUserProfile = async (req: any, res: Response): Promise<void> => {
  const { data: user, error } = await supabase.from('profiles').select('*').eq('id', req.user._id).single();

  if (user) {
    res.json({
      _id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      bsgId: user.bsgid,
      district: user.district,
      unitNumber: user.unit_number,
      unitName: user.unit_name,
      profileImage: user.profile_image,
    });
  } else {
    res.status(404).json({ message: 'User not found' }); return;
  }
};

// @desc    Create Examiner (Admin only)
// @route   POST /api/auth/create-examiner
// @access  Private/Admin
export const createExaminer = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password, bsgId, section, rank } = req.body;

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name, role: 'Examiner' }
    });

    if (authError || !authData.user) {
      res.status(400).json({ message: authError?.message || 'Failed to create examiner' }); return;
    }

    const { data: user, error: profileError } = await supabase.from('profiles').insert({
      id: authData.user.id,
      name,
      email,
      role: 'Examiner',
      bsgid: bsgId,
      section,
      rank,
      status: 'Active'
    }).select().single();

    if (profileError) {
      res.status(400).json({ message: profileError.message }); return;
    }

    res.status(201).json({
      _id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      message: 'Examiner created successfully',
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message || 'Server error' }); return;
  }
};

// @desc    Update user profile
// @route   PUT /api/auth/me/profile
// @access  Private
export const updateUserProfile = async (req: any, res: Response): Promise<void> => {
  try {
    let updates: any = {};
    if (req.body.name) updates.name = req.body.name;
    if (req.body.profileImage !== undefined) updates.profile_image = req.body.profileImage;
    
    if (req.body.password) {
      const passwordRegex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{6,}$/;
      if (!passwordRegex.test(req.body.password)) {
        res.status(400).json({ message: 'Password must be at least 6 characters and contain a letter, a number, and a special character.' }); return;
      }
      const { error: authError } = await supabase.auth.admin.updateUserById(req.user._id, { password: req.body.password });
      if (authError) {
         res.status(400).json({ message: authError.message }); return;
      }
    }

    const { data: updatedUser, error } = await supabase.from('profiles').update(updates).eq('id', req.user._id).select().single();

    if (error || !updatedUser) {
      res.status(404).json({ message: 'User not found' }); return;
    }

    res.json({
      _id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      role: updatedUser.role,
      bsgId: updatedUser.bsgid,
      district: updatedUser.district,
      unitNumber: updatedUser.unit_number,
      unitName: updatedUser.unit_name,
      profileImage: updatedUser.profile_image,
    });
  } catch (error: any) {
      res.status(500).json({ message: error.message || 'Server error' }); return;
  }
};
