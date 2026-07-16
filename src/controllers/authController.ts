import { Request, Response } from 'express';
import User from '../models/User';
import generateToken from '../utils/generateToken';
import Setting from '../models/Setting';
// @desc    Auth user & get token
// @route   POST /api/auth/login
// @access  Public
export const loginUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ $or: [{ email: email }, { bsgId: email }] });
    const settings = await Setting.findOne();
    const isMaintenance = settings?.maintenanceMode ?? false;
    const maxFailedAttempts = settings?.maxFailedLoginAttempts ?? 5;

    if (!user) {
      res.status(401).json({ message: 'Invalid credentials' });
      return;
    }

    if (user.status === 'Blocked') {
      res.status(403).json({ message: 'User is blocked' });
      return;
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      res.status(403).json({ message: `Account is temporarily locked due to too many failed attempts. Try again later.` });
      return;
    }

    if (await user.matchPassword(password)) {
      // Reset failed attempts on success
      if (user.failedLoginAttempts > 0 || user.lockedUntil) {
        user.failedLoginAttempts = 0;
        user.lockedUntil = undefined;
        await user.save();
      }

      if (isMaintenance && user.role !== 'Admin') {
        res.status(503).json({ 
          message: 'The platform is currently under maintenance. Please try again later.',
          platformName: settings?.platformName || 'BSG CBT Portal',
          supportEmail: settings?.supportEmail || 'support@bsg-india.org'
        });
        return;
      }

      const token = generateToken(res, user._id.toString());

      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        bsgId: user.bsgId,
        profileImage: user.profileImage,
        token,
      });
    } else {
      // Increment failed attempts
      user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
      if (user.failedLoginAttempts >= maxFailedAttempts) {
        // Lock for 15 minutes
        user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      }
      await user.save();

      res.status(401).json({ message: 'Invalid credentials' });
    }
  } catch (error: any) {
    res.status(500).json({ message: error.message || 'Server error' });
  }
};

// @desc    Register a new user (Candidate or Admin via secret code)
// @route   POST /api/auth/register
// @access  Public
export const registerUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password, bsgId, section, adminCode } = req.body;

    const userExists = await User.findOne({ email });

    if (userExists) {
      res.status(400).json({ message: 'User already exists' });
      return;
    }

    const passwordRegex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{6,}$/;
    if (!passwordRegex.test(password)) {
      res.status(400).json({ message: 'Password must be at least 6 characters and contain a letter, a number, and a special character.' });
      return;
    }

    let assignedRole: 'Candidate' | 'Examiner' | 'Admin' = 'Candidate';
    if (adminCode && process.env.ADMIN_REGISTRATION_CODE && adminCode === process.env.ADMIN_REGISTRATION_CODE) {
      assignedRole = 'Admin';
    }

    const settings = await Setting.findOne();
    const isMaintenance = settings?.maintenanceMode ?? false;
    
    if (isMaintenance && assignedRole !== 'Admin') {
      res.status(503).json({ message: 'Registration is disabled while the platform is under maintenance.' });
      return;
    }

    const user = await User.create({
      name,
      email,
      passwordHash: password, // The pre-save hook will hash it
      role: assignedRole,
      bsgId: assignedRole === 'Candidate' ? bsgId : undefined,
      section: assignedRole === 'Candidate' ? section : undefined,
    });

    if (user) {
      const token = generateToken(res, user._id.toString());

      res.status(201).json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        bsgId: user.bsgId,
        profileImage: user.profileImage,
        token,
      });
    } else {
      res.status(400).json({ message: 'Invalid user data' });
    }
  } catch (error: any) {
    res.status(500).json({ message: error.message || 'Server error' });
  }
};

// @desc    Logout user / clear cookie
// @route   POST /api/auth/logout
// @access  Public
export const logoutUser = (req: Request, res: Response) => {
  res.cookie('jwt', '', {
    httpOnly: true,
    expires: new Date(0),
  });
  res.status(200).json({ message: 'Logged out successfully' });
};

// @desc    Get user profile
// @route   GET /api/auth/me
// @access  Private
export const getUserProfile = async (req: any, res: Response): Promise<void> => {
  const user = await User.findById(req.user._id);

  if (user) {
    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      bsgId: user.bsgId,
      profileImage: user.profileImage,
    });
  } else {
    res.status(404).json({ message: 'User not found' });
  }
};

// @desc    Create Examiner (Admin only)
// @route   POST /api/auth/create-examiner
// @access  Private/Admin
export const createExaminer = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password, bsgId, section, rank } = req.body;

    const userExists = await User.findOne({ email });

    if (userExists) {
      res.status(400).json({ message: 'User already exists' });
      return;
    }

    const passwordRegex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{6,}$/;
    if (!passwordRegex.test(password)) {
      res.status(400).json({ message: 'Password must be at least 6 characters and contain a letter, a number, and a special character.' });
      return;
    }

    const user = await User.create({
      name,
      email,
      passwordHash: password,
      role: 'Examiner',
      bsgId,
      section,
      rank
    });

    if (user) {
      res.status(201).json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        message: 'Examiner created successfully',
      });
    } else {
      res.status(400).json({ message: 'Invalid user data' });
    }
  } catch (error: any) {
    res.status(500).json({ message: error.message || 'Server error' });
  }
};

// @desc    Update user profile
// @route   PUT /api/auth/me/profile
// @access  Private
export const updateUserProfile = async (req: any, res: Response): Promise<void> => {
  const user = await User.findById(req.user._id);

  if (user) {
    user.name = req.body.name || user.name;
    user.profileImage = req.body.profileImage !== undefined ? req.body.profileImage : user.profileImage;
    
    if (req.body.password) {
      const passwordRegex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{6,}$/;
      if (!passwordRegex.test(req.body.password)) {
        res.status(400).json({ message: 'Password must be at least 6 characters and contain a letter, a number, and a special character.' });
        return;
      }
      user.passwordHash = req.body.password; // hook will hash it
    }

    const updatedUser = await user.save();

    res.json({
      _id: updatedUser._id,
      name: updatedUser.name,
      email: updatedUser.email,
      role: updatedUser.role,
      bsgId: updatedUser.bsgId,
      profileImage: updatedUser.profileImage,
    });
  } else {
    res.status(404).json({ message: 'User not found' });
  }
};


