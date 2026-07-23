import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { AuthRequest } from '../middleware/authMiddleware';

// @desc    Get global settings
// @route   GET /api/settings
// @access  Public
export const getSettings = async (req: Request, res: Response): Promise<void> => {
  try {
    let { data: settings, error } = await supabase.from('settings').select('*').single();

    if (error && error.code !== 'PGRST116') {
      res.status(500).json({ message: error.message }); return;
    }

    if (!settings) {
      const { data: newSettings, error: createError } = await supabase.from('settings').insert({}).select().single();
      if (createError) {
        res.status(500).json({ message: createError.message }); return;
      }
      settings = newSettings;
    }

    res.json(settings);
  } catch (err: any) {
    res.status(500).json({ message: err.message }); return;
  }
};

// @desc    Update global settings
// @route   PUT /api/settings
// @access  Private/Admin
export const updateSettings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { 
      platformName, 
      supportEmail, 
      maintenanceMode,
      termsUrl,
      privacyUrl,
      maxFailedLoginAttempts,
      require2FA,
      strictBrowserLockdown,
      defaultProctoringLevel
    } = req.body;

    // Check if settings row exists
    let { data: settings } = await supabase.from('settings').select('id').single();
    let query;

    const updates: any = {};
    if (platformName !== undefined) updates.platform_name = platformName;
    if (supportEmail !== undefined) updates.support_email = supportEmail;
    if (maintenanceMode !== undefined) updates.maintenance_mode = maintenanceMode;
    if (termsUrl !== undefined) updates.terms_url = termsUrl;
    if (privacyUrl !== undefined) updates.privacy_url = privacyUrl;
    if (maxFailedLoginAttempts !== undefined) updates.max_failed_login_attempts = maxFailedLoginAttempts;
    if (require2FA !== undefined) updates.require_2fa = require2FA;
    if (strictBrowserLockdown !== undefined) updates.strict_browser_lockdown = strictBrowserLockdown;
    if (defaultProctoringLevel !== undefined) updates.default_proctoring_level = defaultProctoringLevel;

    if (!settings) {
      query = supabase.from('settings').insert(updates).select().single();
    } else {
      query = supabase.from('settings').update(updates).eq('id', settings.id).select().single();
    }

    const { data: updatedSettings, error } = await query;

    if (error) {
      res.status(500).json({ message: error.message }); return;
    }

    // Map back for frontend
    const mapped = {
      ...updatedSettings,
      platformName: updatedSettings.platform_name,
      supportEmail: updatedSettings.support_email,
      maintenanceMode: updatedSettings.maintenance_mode,
      termsUrl: updatedSettings.terms_url,
      privacyUrl: updatedSettings.privacy_url,
      maxFailedLoginAttempts: updatedSettings.max_failed_login_attempts,
      require2FA: updatedSettings.require_2fa,
      strictBrowserLockdown: updatedSettings.strict_browser_lockdown,
      defaultProctoringLevel: updatedSettings.default_proctoring_level,
    };
    res.json(mapped);
  } catch (err: any) {
    res.status(500).json({ message: err.message }); return;
  }
};
