import express from 'express';
import { getExams, createExam, getExamById, updateExamStatus, getAvailableExams, updateExam } from '../controllers/examController';
import { addQuestion, importQuestions, deleteQuestion, editQuestion } from '../controllers/questionController';
import { startExam } from '../controllers/attemptController';
import { protect, examiner, admin } from '../middleware/authMiddleware';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

// General exam routes
router.get('/', protect, getExams);
router.post('/', protect, examiner, createExam);
router.get('/available', protect, getAvailableExams);
router.get('/:id', protect, getExamById);
router.put('/:id/status', protect, examiner, updateExamStatus);
router.put('/:id', protect, examiner, updateExam);
router.route('/:id/start').post(protect, startExam);

// Question management
router.post('/:examId/questions', protect, examiner, upload.single('media'), addQuestion);
router.post('/:examId/questions/import', protect, examiner, upload.single('file'), importQuestions);
router.delete('/:examId/questions/:questionId', protect, examiner, deleteQuestion);
router.put('/:examId/questions/:questionId', protect, examiner, upload.single('media'), editQuestion);

export default router;
