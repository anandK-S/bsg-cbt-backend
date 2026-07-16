import express from 'express';
import { getSettings, updateSettings } from '../controllers/settingController';
import { protect, admin } from '../middleware/authMiddleware';

const router = express.Router();

router.route('/')
  .get(getSettings)
  .put(protect, admin, updateSettings);

export default router;
