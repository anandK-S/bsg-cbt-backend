import express from 'express';
import { startExam } from '../controllers/attemptController';
import { heartbeatSync, submitExam, getResult, getDetailedResult, getMyResults, getLeaderboard, deleteAttempt, getLiveAttempts } from '../controllers/attemptController';
import { protect, admin } from '../middleware/authMiddleware';

const examRoutes = express.Router();
examRoutes.post('/:id/start', protect, startExam);

const attemptRoutes = express.Router();
attemptRoutes.get('/leaderboard', protect, getLeaderboard);
attemptRoutes.get('/live', protect, getLiveAttempts);
attemptRoutes.post('/:id/heartbeat', protect, heartbeatSync);
attemptRoutes.post('/:id/submit', protect, submitExam);
attemptRoutes.delete('/:id', protect, admin, deleteAttempt);
attemptRoutes.get('/results/me', protect, getMyResults);
attemptRoutes.get('/results/:resultId/detailed', protect, getDetailedResult); // Detailed review route (we will update the controller to handle this)
attemptRoutes.get('/:examId/result', protect, getResult); // Keep for backwards compatibility for now

export { examRoutes, attemptRoutes };
