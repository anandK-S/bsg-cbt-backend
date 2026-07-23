import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { AuthRequest } from '../middleware/authMiddleware';

// @desc    Get all users
// @route   GET /api/users
// @access  Private/Admin
export const getUsers = async (req: AuthRequest, res: Response) => {
  const { data: users, error } = await supabase.from('profiles').select('*');
  if (error) {
    res.status(500).json({ message: error.message }); return;
  }
  const formattedUsers = users.map(u => ({ ...u, _id: u.id }));
  res.json(formattedUsers);
};

// @desc    Get audit logs
// @route   GET /api/users/audit-logs
// @access  Private/Admin
export const getAuditLogs = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data: logs, error } = await supabase
      .from('audit_logs')
      .select('*, profiles:user_id(name, email, role)')
      .order('timestamp', { ascending: false })
      .limit(1000);

    if (error) throw error;
    
    const formattedLogs = logs.map(log => ({
      _id: log.id,
      userId: log.profiles ? { ...log.profiles, _id: log.user_id } : { _id: log.user_id },
      action: log.action,
      details: log.details,
      timestamp: log.timestamp
    }));
    res.json(formattedLogs);
  } catch (error: any) {
    res.status(500).json({ message: error.message || 'Server error' }); return;
  }
};

// @desc    Block user
// @route   PUT /api/users/:id/block
// @access  Private/Admin
export const blockUser = async (req: AuthRequest, res: Response): Promise<void> => {
  const { data: user, error } = await supabase.from('profiles').update({ status: 'Blocked' }).eq('id', req.params.id).select().single();

  if (user) {
    res.json({ message: 'User blocked', user: { ...user, _id: user.id } });
  } else {
    res.status(404).json({ message: 'User not found' }); return;
  }
};

// @desc    Unblock user
// @route   PUT /api/users/:id/unblock
// @access  Private/Admin
export const unblockUser = async (req: AuthRequest, res: Response): Promise<void> => {
  const { data: user, error } = await supabase.from('profiles').update({ status: 'Active' }).eq('id', req.params.id).select().single();

  if (user) {
    res.json({ message: 'User unblocked', user: { ...user, _id: user.id } });
  } else {
    res.status(404).json({ message: 'User not found' }); return;
  }
};

// @desc    Unlock user account (reset failed login attempts)
// @route   PUT /api/users/:id/unlock
// @access  Private/Admin
export const unlockUser = async (req: AuthRequest, res: Response): Promise<void> => {
  const { data: user, error } = await supabase.from('profiles').update({ 
    failed_login_attempts: 0, 
    locked_until: null 
  }).eq('id', req.params.id).select().single();

  if (user) {
    res.json({ message: 'User account unlocked', user: { ...user, _id: user.id } });
  } else {
    res.status(404).json({ message: 'User not found' }); return;
  }
};

// @desc    Change user password (Admin only)
// @route   PUT /api/users/:id/password
// @access  Private/Admin
export const changeUserPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { newPassword } = req.body;

    const passwordRegex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{6,}$/;
    if (!newPassword || !passwordRegex.test(newPassword)) {
      res.status(400).json({ message: 'Password must be at least 6 characters and contain a letter, a number, and a special character.' }); return;
    }

    const { error } = await supabase.auth.admin.updateUserById(req.params.id as string, { password: newPassword });

    if (error) {
      res.status(400).json({ message: error.message }); return;
    }

    res.json({ message: 'Password updated successfully' });
  } catch (error: any) {
    res.status(500).json({ message: error.message || 'Server error' }); return;
  }
};

// @desc    Delete user permanently (Admin only)
// @route   DELETE /api/users/:id
// @access  Private/Admin
export const deleteUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { adminPassword } = req.body;

    if (!adminPassword) {
      res.status(400).json({ message: 'Admin password is required to delete a user permanently' }); return;
    }

    // Verify admin password by attempting to sign in
    if (!req.user || !req.user.email) {
      res.status(401).json({ message: 'Admin not found' }); return;
    }

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: req.user.email,
      password: adminPassword,
    });

    if (signInError || !signInData.user) {
      res.status(401).json({ message: 'Invalid admin password. Deletion aborted.' }); return;
    }

    const { data: userToDelete } = await supabase.from('profiles').select('role').eq('id', req.params.id).single();

    if (userToDelete) {
      if (userToDelete.role === 'Admin') {
        res.status(403).json({ message: 'Cannot delete another Admin account' }); return;
      }
      // Delete from Auth
      await supabase.auth.admin.deleteUser(req.params.id as string);
      // Delete from profiles (should cascade, but doing it explicitly)
      await supabase.from('profiles').delete().eq('id', req.params.id);
      
      res.json({ message: 'User permanently deleted' });
    } else {
      res.status(404).json({ message: 'User not found' }); return;
    }
  } catch (error: any) {
    res.status(500).json({ message: error.message || 'Server error' }); return;
  }
};

// @desc    Get insights for a specific examiner
// @route   GET /api/users/examiner/:id/insights
// @access  Private/Admin
export const getExaminerInsights = async (req: any, res: Response): Promise<void> => {
  try {
    const examinerId = req.params.id;

    const { data: exams } = await supabase.from('exams').select('*, questions(*)').eq('creator_id', examinerId);
    
    const examIds = exams ? exams.map(e => e.id) : [];
    
    let attempts = [];
    if (examIds.length > 0) {
        const { data } = await supabase.from('exam_attempts')
            .select('*, candidate:candidate_id(name, email, section)')
            .in('exam_id', examIds)
            .in('status', ['Submitted', 'Auto-Submitted', 'Blocked']);
        attempts = data || [];
    }

    const formattedExams = exams?.map(e => ({ ...e, _id: e.id })) || [];
    const formattedAttempts = attempts?.map(a => ({ ...a, _id: a.id, candidateId: a.candidate })) || [];

    res.json({ exams: formattedExams, attempts: formattedAttempts });
  } catch (error: any) {
    res.status(500).json({ message: error.message || 'Server error' }); return;
  }
};

// @desc    Bulk import users via CSV
// @route   POST /api/users/bulk-import
// @access  Private/Admin
export const bulkImportUsers = async (req: any, res: Response): Promise<void> => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ message: 'No CSV file uploaded' }); return;
    }

    const csvData = file.buffer.toString('utf-8');
    const lines = csvData.split(/\r?\n/).filter((line: string) => line.trim() !== '');

    if (lines.length < 2) {
      res.status(400).json({ message: 'CSV file is empty or missing data rows' }); return;
    }

    const headers = lines[0].split(',').map((h: string) => h.trim().toLowerCase());
    let createdCount = 0;
    const errors = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].split(',').map((v: string) => v.trim());
      if (line.length < 5) continue; 

      const userData: any = {};
      headers.forEach((header: string, index: number) => {
        userData[header] = line[index] || '';
      });

      try {
        const { data: existingUser } = await supabase.from('profiles').select('id').or(`email.eq.${userData.email},bsgid.eq.${userData.bsgid}`).maybeSingle();

        if (existingUser) {
          errors.push(`Row ${i + 1}: User with email ${userData.email} or BSG ID ${userData.bsgid} already exists`);
          continue;
        }

        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
          email: userData.email,
          password: userData.password,
          email_confirm: true,
          user_metadata: { full_name: userData.name, role: userData.role || 'Candidate' }
        });

        if (authError) {
          errors.push(`Row ${i + 1}: ${authError.message}`);
          continue;
        }

        await supabase.from('profiles').upsert({
          id: authData.user.id,
          name: userData.name,
          email: userData.email,
          role: userData.role || 'Candidate',
          bsgid: userData.bsgid,
          section: userData.section,
          state: userData.state,
          status: 'Active'
        });

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
    res.status(500).json({ message: error.message || 'Server error' }); return;
  }
};

// @desc    Update user details (Admin only)
// @route   PUT /api/users/:id/update
// @access  Private/Admin
export const updateUserByAdmin = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const updates: any = {};
    if (req.body.name) updates.name = req.body.name;
    if (req.body.email) updates.email = req.body.email;
    if (req.body.bsgId !== undefined) updates.bsgid = req.body.bsgId;
    if (req.body.section !== undefined) updates.section = req.body.section;
    if (req.body.rank !== undefined) updates.rank = req.body.rank;
    if (req.body.district !== undefined) updates.district = req.body.district;

    const { data: updatedUser, error } = await supabase.from('profiles').update(updates).eq('id', req.params.id).select().single();

    if (error) throw error;

    res.json({ message: 'User updated successfully', user: { ...updatedUser, _id: updatedUser.id } });
  } catch (error: any) {
    res.status(500).json({ message: error.message || 'Server error' }); return;
  }
};
