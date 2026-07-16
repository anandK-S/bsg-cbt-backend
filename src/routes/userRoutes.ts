import express from 'express';
import { getUsers, blockUser, unblockUser, changeUserPassword, deleteUser, getExaminerInsights, bulkImportUsers, updateUserByAdmin } from '../controllers/userController';
import { protect, admin } from '../middleware/authMiddleware';
import { auditLog } from '../middleware/auditMiddleware';

import multer from 'multer';

const router = express.Router();
const upload = multer();

router.route('/').get(protect, admin, getUsers);
router.route('/bulk-import').post(protect, admin, upload.single('file'), auditLog('BULK_IMPORTED_USERS'), bulkImportUsers);
router.route('/:id').delete(protect, admin, auditLog('DELETED_USER_PERMANENTLY'), deleteUser);
router.route('/:id/block').put(protect, admin, auditLog('BLOCKED_USER'), blockUser);
router.route('/:id/unblock').put(protect, admin, auditLog('UNBLOCKED_USER'), unblockUser);
router.route('/:id/password').put(protect, admin, auditLog('CHANGED_USER_PASSWORD'), changeUserPassword);
router.route('/:id/update').put(protect, admin, auditLog('UPDATED_USER_BY_ADMIN'), updateUserByAdmin);
router.route('/examiner/:id/insights').get(protect, admin, getExaminerInsights);

export default router;
