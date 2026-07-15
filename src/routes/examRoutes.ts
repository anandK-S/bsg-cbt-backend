import express from 'express';
import { getExams, getAvailableExams, createExam, getExamById, updateExamStatus } from '../controllers/examController';
import { addQuestion, importQuestions } from '../controllers/questionController';
import { startExam } from '../controllers/attemptController';
import { protect, examiner } from '../middleware/authMiddleware';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

router.route('/').get(protect, examiner, getExams).post(protect, examiner, createExam);
router.route('/available').get(protect, getAvailableExams);
router.route('/:id').get(protect, getExamById);
router.route('/:id/status').put(protect, examiner, updateExamStatus);
router.route('/:id/start').post(protect, startExam);

// Question Routes
router.route('/:examId/questions').post(protect, examiner, upload.single('media'), addQuestion);
router.route('/:examId/questions/import').post(protect, examiner, upload.single('file'), importQuestions);

export default router;
