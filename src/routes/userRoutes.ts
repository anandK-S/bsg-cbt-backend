import express from 'express';
import { getUsers, blockUser, unblockUser, changeUserPassword, deleteUser } from '../controllers/userController';
import { protect, admin } from '../middleware/authMiddleware';
import { auditLog } from '../middleware/auditMiddleware';

const router = express.Router();

router.route('/').get(protect, admin, getUsers);
router.route('/:id').delete(protect, admin, auditLog('DELETED_USER_PERMANENTLY'), deleteUser);
router.route('/:id/block').put(protect, admin, auditLog('BLOCKED_USER'), blockUser);
router.route('/:id/unblock').put(protect, admin, auditLog('UNBLOCKED_USER'), unblockUser);
router.route('/:id/password').put(protect, admin, auditLog('CHANGED_USER_PASSWORD'), changeUserPassword);

export default router;
