import express from 'express';
import { loginUser, registerUser, logoutUser, getUserProfile, updateUserProfile, createExaminer, emergencyReset } from '../controllers/authController';
import { protect, admin } from '../middleware/authMiddleware';

const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/logout', logoutUser);
router.get('/me', protect, getUserProfile);
router.put('/me/profile', protect, updateUserProfile);
router.post('/create-examiner', protect, admin, createExaminer);

// TEMPORARY EMERGENCY RESET ROUTE
router.get('/emergency-reset', emergencyReset);

export default router;
