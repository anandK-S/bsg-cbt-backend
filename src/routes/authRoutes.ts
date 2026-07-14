import express from 'express';
import { loginUser, registerUser, logoutUser, getUserProfile, updateUserProfile } from '../controllers/authController';
import { protect } from '../middleware/authMiddleware';

const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/logout', logoutUser);
router.get('/me', protect, getUserProfile);
router.put('/me/profile', protect, updateUserProfile);

export default router;
