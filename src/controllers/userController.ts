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

    const passwordRegex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{6,}$/;
    if (!newPassword || !passwordRegex.test(newPassword)) {
      res.status(400).json({ message: 'Password must be at least 6 characters and contain a letter, a number, and a special character.' });
      return;
    }

    user.passwordHash = newPassword; // Will be hashed by pre-save hook
    await user.save();

    res.json({ message: 'Password updated successfully' });
  } catch (error: any) {
    res.status(500).json({ message: error.message || 'Server error' });
  }
};

// @desc    Delete user permanently (Admin only)
// @route   DELETE /api/users/:id
// @access  Private/Admin
export const deleteUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const adminUser = await User.findById(req.user?._id);
    const { adminPassword } = req.body;

    if (!adminUser) {
      res.status(401).json({ message: 'Admin not found' });
      return;
    }

    if (!adminPassword) {
      res.status(400).json({ message: 'Admin password is required to delete a user permanently' });
      return;
    }

    const isMatch = await adminUser.matchPassword(adminPassword);
    if (!isMatch) {
      res.status(401).json({ message: 'Invalid admin password. Deletion aborted.' });
      return;
    }

    const userToDelete = await User.findById(req.params.id);

    if (userToDelete) {
      if (userToDelete.role === 'Admin') {
        res.status(403).json({ message: 'Cannot delete another Admin account' });
        return;
      }
      await userToDelete.deleteOne();
      res.json({ message: 'User permanently deleted' });
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error: any) {
    res.status(500).json({ message: error.message || 'Server error' });
  }
};

// @desc    Get insights for a specific examiner
// @route   GET /api/users/examiner/:id/insights
// @access  Private/Admin
export const getExaminerInsights = async (req: any, res: Response): Promise<void> => {
  try {
    const examinerId = req.params.id;
    const Exam = require('../models/Exam').default;
    const ExamAttempt = require('../models/ExamAttempt').default;

    const exams = await Exam.find({ creatorId: examinerId }).populate('questions.questionId');
    const examIds = exams.map((e: any) => e._id);
    
    const attempts = await ExamAttempt.find({ 
      examId: { $in: examIds }, 
      status: { $in: ['Submitted', 'Auto-Submitted', 'Blocked'] }
    }).populate('candidateId', 'name email section');

    res.json({ exams, attempts });
  } catch (error: any) {
    res.status(500).json({ message: error.message || 'Server error' });
  }
};

// @desc    Bulk import users via CSV
// @route   POST /api/users/bulk-import
// @access  Private/Admin
export const bulkImportUsers = async (req: any, res: Response): Promise<void> => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ message: 'No CSV file uploaded' });
      return;
    }

    const csvData = file.buffer.toString('utf-8');
    const lines = csvData.split(/\r?\n/).filter((line: string) => line.trim() !== '');

    if (lines.length < 2) {
      res.status(400).json({ message: 'CSV file is empty or missing data rows' });
      return;
    }

    // Assume header: name, email, password, role, bsgId, section, state
    const headers = lines[0].split(',').map((h: string) => h.trim().toLowerCase());
    
    let createdCount = 0;
    const errors = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].split(',').map((v: string) => v.trim());
      if (line.length < 5) continue; // Minimum required fields

      const userData: any = {};
      headers.forEach((header: string, index: number) => {
        userData[header] = line[index] || '';
      });

      try {
        const existingUser = await User.findOne({ 
          $or: [{ email: userData.email }, { bsgId: userData.bsgid }] 
        });

        if (existingUser) {
          errors.push(`Row ${i + 1}: User with email ${userData.email} or BSG ID ${userData.bsgid} already exists`);
          continue;
        }

        const newUser = new User({
          name: userData.name,
          email: userData.email,
          passwordHash: userData.password,
          role: userData.role || 'Candidate',
          bsgId: userData.bsgid,
          section: userData.section,
          state: userData.state,
          status: 'Active'
        });

        await newUser.save();
        createdCount++;
      } catch (err: any) {
        errors.push(`Row ${i + 1}: Failed to create user - ${err.message}`);
      }
    }

    res.status(200).json({
      message: 'Bulk import complete',
      createdCount,
      errors
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message || 'Server error' });
  }
};
