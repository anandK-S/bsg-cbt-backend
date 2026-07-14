import { Request, Response } from 'express';
import User from '../models/User';
import { AuthRequest } from '../middleware/authMiddleware';

// @desc    Get all users
// @route   GET /api/users
// @access  Private/Admin
export const getUsers = async (req: AuthRequest, res: Response) => {
  const users = await User.find({}).select('-passwordHash');
  res.json(users);
};

// @desc    Block user
// @route   PUT /api/users/:id/block
// @access  Private/Admin
export const blockUser = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await User.findById(req.params.id);

  if (user) {
    user.status = 'Blocked';
    const updatedUser = await user.save();
    res.json({ message: 'User blocked', user: updatedUser });
  } else {
    res.status(404).json({ message: 'User not found' });
  }
};

// @desc    Unblock user
// @route   PUT /api/users/:id/unblock
// @access  Private/Admin
export const unblockUser = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await User.findById(req.params.id);

  if (user) {
    user.status = 'Active';
    const updatedUser = await user.save();
    res.json({ message: 'User unblocked', user: updatedUser });
  } else {
    res.status(404).json({ message: 'User not found' });
  }
};

// @desc    Change user password (Admin only)
// @route   PUT /api/users/:id/password
// @access  Private/Admin
export const changeUserPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.params.id);
    const { newPassword } = req.body;

    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    if (!newPassword || newPassword.length < 6) {
      res.status(400).json({ message: 'Password must be at least 6 characters' });
      return;
    }

    user.passwordHash = newPassword; // Will be hashed by pre-save hook
    await user.save();

    res.json({ message: 'Password updated successfully' });
  } catch (error: any) {
    res.status(500).json({ message: error.message || 'Server error' });
  }
};
