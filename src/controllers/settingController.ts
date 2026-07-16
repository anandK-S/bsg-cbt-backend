import { Request, Response } from 'express';
import Setting from '../models/Setting';
import { AuthRequest } from '../middleware/authMiddleware';

// @desc    Get global settings
// @route   GET /api/settings
// @access  Public
export const getSettings = async (req: Request, res: Response): Promise<void> => {
  let settings = await Setting.findOne();

  // Initialize if not exists
  if (!settings) {
    settings = await Setting.create({});
  }

  res.json(settings);
};

// @desc    Update global settings
// @route   PUT /api/settings
// @access  Private/Admin
export const updateSettings = async (req: AuthRequest, res: Response): Promise<void> => {
  const { platformName, supportEmail, maintenanceMode } = req.body;

  let settings = await Setting.findOne();

  if (!settings) {
    settings = await Setting.create({});
  }

  if (platformName !== undefined) settings.platformName = platformName;
  if (supportEmail !== undefined) settings.supportEmail = supportEmail;
  if (maintenanceMode !== undefined) settings.maintenanceMode = maintenanceMode;

  const updatedSettings = await settings.save();
  res.json(updatedSettings);
};
