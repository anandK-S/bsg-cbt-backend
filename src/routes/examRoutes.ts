import express from 'express';
import { getExams, createExam, getExamById, updateExamStatus, getAvailableExams, updateExam, deleteExam } from '../controllers/examController';
import { addQuestion, importQuestions, deleteQuestion, editQuestion, autoTranslate, deleteAllQuestions } from '../controllers/questionController';
import { startExam } from '../controllers/attemptController';
import { protect, examiner, admin } from '../middleware/authMiddleware';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

router.route('/')
  .get(protect, getExams)
  .post(protect, examiner, createExam);

router.get('/available', protect, getAvailableExams);

router.route('/:id')
  .get(protect, getExamById)
  .put(protect, examiner, updateExam)
  .delete(protect, examiner, deleteExam);

router.put('/:id/status', protect, examiner, updateExamStatus);
router.post('/:id/start', protect, startExam);

router.post('/translate', protect, examiner, autoTranslate);
router.post('/:examId/questions', protect, examiner, upload.single('media'), addQuestion);
router.post('/:examId/questions/import', protect, examiner, upload.single('file'), importQuestions);
router.delete('/:examId/questions/all', protect, examiner, deleteAllQuestions);
router.delete('/:examId/questions/:questionId', protect, examiner, deleteQuestion);
router.put('/:examId/questions/:questionId', protect, examiner, upload.single('media'), editQuestion);

export default router;
