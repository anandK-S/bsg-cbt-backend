import { Response } from 'express';
import ExamAttempt from '../models/ExamAttempt';
import Exam from '../models/Exam';
import Result from '../models/Result';
import { AuthRequest } from '../middleware/authMiddleware';
import Setting from '../models/Setting';
import { GoogleGenAI } from '@google/genai';

// We initialize inside the function so it doesn't crash on startup if the key is missing

// @desc    Start an exam attempt
// @route   POST /api/exams/:id/start
// @access  Private/Candidate
export const startExam = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const exam = await Exam.findById(id).populate('questions.questionId');

  if (!exam) {
    res.status(404).json({ message: 'Exam not found' });
    return;
  }

  const settings = await Setting.findOne();
  if (settings?.maintenanceMode && req.user.role === 'Candidate') {
    res.status(503).json({ message: 'The platform is currently under maintenance. New exams cannot be started.' });
    return;
  }

  // Check scheduled dates
  const now = new Date();
  if (exam.scheduledStartDate && new Date(exam.scheduledStartDate) > now) {
    res.status(403).json({ message: 'Exam has not started yet', availableFrom: exam.scheduledStartDate });
    return;
  }
  if (exam.scheduledEndDate && new Date(exam.scheduledEndDate) < now) {
    res.status(403).json({ message: 'Exam has already ended' });
    return;
  }

  // Check multiple attempts configuration
  if (!exam.allowMultipleAttempts) {
    const existingCompleted = await ExamAttempt.findOne({
      candidateId: req.user._id,
      examId: id,
      status: { $in: ['Submitted', 'Auto-Submitted', 'Blocked'] }
    });
    if (existingCompleted) {
      res.status(403).json({ message: 'You have already submitted this exam and multiple attempts are not allowed.' });
      return;
    }
  }

  // Check if attempt already exists and is in-progress
  let attempt = await ExamAttempt.findOne({ candidateId: req.user._id, examId: id, status: 'In-Progress' });

  if (!attempt) {
    const totalSeconds = exam.durationSeconds ? exam.durationSeconds : (exam.durationMinutes * 60);
    attempt = new ExamAttempt({
      candidateId: req.user._id,
      examId: id,
      timeRemaining: totalSeconds,
      answers: exam.questions.map((q: any) => ({
        questionId: q.questionId._id,
        status: 'NotVisited',
      })),
    });
    await attempt.save();
  }

  // Hide correctOptionIndex from candidate
  const sanitizedQuestions = exam.questions.map((q: any) => {
    const questionObj = q.questionId.toObject();
    delete questionObj.correctOptionIndex;
    return questionObj;
  });

  res.status(200).json({ attempt, questions: sanitizedQuestions, examTitle: exam.title, durationMinutes: exam.durationMinutes });
};

// @desc    Heartbeat sync (save state)
// @route   POST /api/attempts/:id/heartbeat
// @access  Private/Candidate
export const heartbeatSync = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { answers, timeRemaining, warnings, timeSpentAnalytics } = req.body;

  const attempt = await ExamAttempt.findById(id);

  if (!attempt) {
    res.status(404).json({ message: 'Attempt not found' });
    return;
  }

  if (attempt.status !== 'In-Progress') {
    res.status(400).json({ message: 'Exam already submitted or blocked' });
    return;
  }

  attempt.answers = answers;
  attempt.timeRemaining = timeRemaining;
  
  if (timeSpentAnalytics) {
    attempt.timeSpentAnalytics = timeSpentAnalytics;
  }
  
  if (warnings !== undefined) {
    attempt.warnings = warnings;
    if (attempt.warnings >= 3) {
      attempt.status = 'Blocked';
    }
  }

  await attempt.save();

  res.status(200).json({ message: 'Sync successful', status: attempt.status });
};

// @desc    Submit exam
// @route   POST /api/attempts/:id/submit
// @access  Private/Candidate
export const submitExam = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { answers, timeRemaining, timeSpentAnalytics } = req.body;

  const attempt = await ExamAttempt.findById(id);

  if (!attempt) {
    res.status(404).json({ message: 'Attempt not found' });
    return;
  }

  if (attempt.status === 'Submitted') {
    res.status(400).json({ message: 'Exam already submitted' });
    return;
  }

  if (answers) {
    attempt.answers = answers;
  }
  if (timeRemaining !== undefined) {
    attempt.timeRemaining = timeRemaining;
  }
  if (timeSpentAnalytics) {
    attempt.timeSpentAnalytics = timeSpentAnalytics;
  }
  if (req.body.violationReason) {
    (attempt as any).violationReason = req.body.violationReason;
  }

  const exam = await Exam.findById(attempt.examId).populate('questions.questionId');

  let score = 0;
  let totalMarks = 0;

  // Calculate Total Marks
  exam?.questions.forEach((q: any) => {
    totalMarks += q.marks || 1;
  });

  // Calculate Score
  attempt.answers.forEach((ans) => {
    const examQuestion = exam?.questions.find(
      (q: any) => q.questionId && q.questionId._id.toString() === ans.questionId.toString()
    );
    if (examQuestion && examQuestion.questionId) {
      const correctIndex = (examQuestion.questionId as any).correctOptionIndex;
      console.log(`QID: ${ans.questionId.toString()}, Selected: ${ans.selectedOptionIndex}, Correct: ${correctIndex}`);
      if (
        ans.selectedOptionIndex !== undefined &&
        ans.selectedOptionIndex !== null &&
        Number(ans.selectedOptionIndex) === Number(correctIndex)
      ) {
        score += examQuestion.marks;
      }
    } else {
      console.log(`Missing examQuestion for QID: ${ans.questionId.toString()}`);
    }
  });
  console.log(`Final Score: ${score} / ${totalMarks}`);

  attempt.status = 'Submitted';
  attempt.endTime = new Date();
  await attempt.save();

  let aiFeedback = "Good job on completing the exam! Review your correct and incorrect answers to improve your score next time.";
  
  if (process.env.GEMINI_API_KEY) {
    try {
      const prompt = `The candidate just completed a multiple-choice exam. They scored ${score} out of ${totalMarks}.
Analyze their performance and give a brief, encouraging qualitative summary pointing out areas of strength and areas to improve based on the category of questions they got right/wrong.
Do not provide a generic response; write directly to the candidate as a supportive tutor. Keep it under 3 sentences.`;

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });
      
      if (response.text) {
        aiFeedback = response.text;
      }
    } catch (error) {
      console.error("AI feedback generation failed:", error);
      // Fallback stays intact
    }
  }

  const resultData: any = {
    attemptId: attempt._id,
    candidateId: attempt.candidateId,
    examId: attempt.examId,
    score,
    totalMarks,
    aiFeedback,
  };
  
  if (req.body.violationReason) {
    resultData.violationReason = req.body.violationReason;
  }

  const result = new Result(resultData);

  await result.save();

  res.status(200).json(result);
};

// @desc    Get detailed result by result ID
// @route   GET /api/attempts/results/:resultId/detailed
// @access  Private/Candidate/Examiner/Admin
export const getDetailedResult = async (req: AuthRequest, res: Response): Promise<void> => {
  const { resultId } = req.params;
  
  const result = await Result.findById(resultId).populate('examId', 'title description durationMinutes');
  
  if (!result) {
    res.status(404).json({ message: 'Result not found' });
    return;
  }
  
  // Authorization: Candidate can only view their own. Admins/Examiners can view anyone's.
  if (req.user.role === 'Candidate' && result.candidateId.toString() !== req.user._id.toString()) {
    res.status(403).json({ message: 'Not authorized to view this result' });
    return;
  }
  
  const attempt = await ExamAttempt.findById(result.attemptId);
  const exam = await Exam.findById(result.examId).populate('questions.questionId');
  
  if (!attempt || !exam) {
    res.status(404).json({ message: 'Missing attempt or exam data' });
    return;
  }
  
  // Merge questions with candidate's answers and correct answers
  const questionDetails = exam.questions.map((q: any) => {
    const qObj = q.questionId.toObject();
    const candidateAnswer = attempt.answers.find((a: any) => a.questionId.toString() === qObj._id.toString());
    
    return {
      _id: qObj._id,
      text: qObj.text,
      textHindi: qObj.textHindi,
      options: qObj.options,
      optionsHindi: qObj.optionsHindi,
      correctOptionIndex: qObj.correctOptionIndex,
      marks: q.marks,
      candidateAnswerIndex: candidateAnswer?.selectedOptionIndex ?? null,
      viewedLanguage: candidateAnswer?.viewedLanguage || 'en',
      isCorrect: candidateAnswer?.selectedOptionIndex === qObj.correctOptionIndex
    };
  });
  
  res.status(200).json({
    result,
    questionDetails
  });
};

// @desc    Get result by exam ID
// @route   GET /api/attempts/:examId/result
// @access  Private/Candidate/Examiner/Admin
export const getResult = async (req: AuthRequest, res: Response): Promise<void> => {
  const { examId } = req.params;
  
  // Find result for this candidate and this exam
  let result;
  
  if (req.user.role === 'Candidate') {
    result = await Result.findOne({ candidateId: req.user._id, examId }).populate('examId', 'title releaseResultsInstantly');
    
    // Check if results are released
    if (result && result.examId && (result.examId as any).releaseResultsInstantly === false && !result.isReleased) {
      res.status(403).json({ message: 'Results for this exam have not been released yet.' });
      return;
    }
  } else {
    // If Admin/Examiner wants to see it, they can pass attemptId or we just return all results for the exam
    const query: any = { examId };
    if (req.query.candidateId) query.candidateId = req.query.candidateId;
    
    // Fetch all results for the exam
    const allResults = await Result.find(query)
      .populate('examId', 'title')
      .populate('candidateId', 'name email bsgId role'); // Include role
      
    // Filter out Admins so their testing doesn't skew candidate analytics
    result = allResults.filter((r: any) => r.candidateId?.role === 'Candidate');
  }

  if (!result) {
    res.status(404).json({ message: 'Result not found' });
    return;
  }

  res.status(200).json(result);
};

// @desc    Get all results for logged in candidate
// @route   GET /api/attempts/results/me
// @access  Private/Candidate
export const getMyResults = async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user.role !== 'Candidate') {
    res.status(403).json({ message: 'Only candidates can view their past results' });
    return;
  }

  let results = await Result.find({ candidateId: req.user._id })
    .populate({
      path: 'examId',
      select: 'title durationMinutes durationSeconds category releaseResultsInstantly creatorId',
      populate: {
        path: 'creatorId',
        select: 'name'
      }
    })
    .populate('attemptId', 'timeRemaining startTime endTime')
    .sort({ createdAt: -1 });

  // Filter out unreleased results
  results = results.filter((r: any) => r.isReleased || (r.examId && (r.examId as any).releaseResultsInstantly !== false));

  res.status(200).json(results);
};

// @desc    Get Global Leaderboard
// @route   GET /api/attempts/leaderboard
// @access  Private (All Authenticated)
export const getLeaderboard = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { examId, startDate, endDate } = req.query;
    const filter: any = {};
    if (examId && examId !== 'All') {
      filter.examId = examId;
    }
    
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate as string);
      if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }
    
    const results = await Result.find(filter).populate('candidateId', 'name bsgId section role district');

    // Aggregate by candidate
    const candidateMap = new Map();

    results.forEach((r: any) => {
      if (!r.candidateId || r.candidateId.role === 'Admin' || r.candidateId.role === 'Examiner') return; // Only candidates
      
      const cid = r.candidateId._id.toString();
      if (!candidateMap.has(cid)) {
        candidateMap.set(cid, {
          _id: cid,
          name: r.candidateId.name,
          bsgId: r.candidateId.bsgId,
          section: r.candidateId.section,
          district: r.candidateId.district,
          totalScore: 0,
          totalMarksPossible: 0,
          examsTaken: 0,
        });
      }

      const stats = candidateMap.get(cid);
      stats.totalScore += r.score;
      stats.totalMarksPossible += r.totalMarks;
      stats.examsTaken += 1;
    });

    const leaderboard = Array.from(candidateMap.values())
      .map(c => ({
        ...c,
        percentage: c.totalMarksPossible > 0 ? ((c.totalScore / c.totalMarksPossible) * 100).toFixed(1) : 0
      }))
      .sort((a, b) => {
        // Sort by total score, then by percentage
        if (b.totalScore !== a.totalScore) {
          return b.totalScore - a.totalScore;
        }
        return Number(b.percentage) - Number(a.percentage);
      });

    res.status(200).json(leaderboard);
  } catch (error: any) {
    res.status(500).json({ message: error.message || 'Server error' });
  }
};

// @desc    Delete an exam attempt and its result
// @route   DELETE /api/attempts/:id
// @access  Private/Admin
export const deleteAttempt = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const attemptId = req.params.id;
    
    // Find the attempt
    const attempt = await ExamAttempt.findById(attemptId);
    if (!attempt) {
      res.status(404).json({ message: 'Attempt not found' });
      return;
    }

    // Delete the associated Result if it exists
    await Result.deleteOne({ attemptId: attempt._id });
    
    // Delete the attempt
    await attempt.deleteOne();

    res.status(200).json({ message: 'Attempt and associated result deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ message: error.message || 'Server error' });
  }
};

// @desc    Get live attempts for monitoring
// @route   GET /api/attempts/live
// @access  Private/Examiner/Admin
export const getLiveAttempts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Mock user for debug route
    if (!req.user) {
      req.user = {
        _id: '6a56f207145ed3f53293785f', // examiner ID
        role: 'Examiner'
      } as any;
    }
    const liveAttempts = await ExamAttempt.find({ status: 'In-Progress' })
      .populate('candidateId', 'name bsgId section district')
      .populate('examId', 'title creatorId questions')
      .sort({ updatedAt: -1 });

    const cutoffTime = new Date(Date.now() - 4 * 60 * 60 * 1000); // 4 hours ago
    const validAttempts = [];
    for (const attempt of liveAttempts) {
      const attemptObj = attempt as any;
      if (attemptObj.updatedAt && attemptObj.updatedAt < cutoffTime) {
        // Abandoned attempt: create disqualified result
        const exam = attempt.examId as any;
        const totalMarks = exam?.questions?.reduce((acc: number, q: any) => acc + (q.marks || 1), 0) || 0;
        
        await Result.create({
          candidateId: attempt.candidateId,
          examId: attempt.examId,
          answers: attempt.answers || [],
          score: 0,
          totalMarks,
          violationReason: 'Abandoned due to inactivity',
          isReleased: true
        });

        // Delete the stuck attempt
        await ExamAttempt.findByIdAndDelete(attempt._id);
      } else {
        validAttempts.push(attempt);
      }
    }

    let filteredAttempts = validAttempts;
    if (req.user.role === 'Examiner') {
      console.log(`[DEBUG] Examiner ID: ${req.user._id.toString()}`);
      filteredAttempts = validAttempts.filter(attempt => {
        const exam = attempt.examId as any;
        if (!exam || !exam.creatorId) {
          console.log(`[DEBUG] Attempt ${attempt._id} missing exam or creatorId`);
          return false;
        }
        const examCreatorId = exam.creatorId._id ? exam.creatorId._id.toString() : exam.creatorId.toString();
        console.log(`[DEBUG] Attempt ${attempt._id}, Exam ${exam._id}, Creator: ${examCreatorId}, Matches? ${examCreatorId === req.user._id.toString()}`);
        return examCreatorId === req.user._id.toString();
      });
    }

    console.log(`[DEBUG] Returning ${filteredAttempts.length} attempts out of ${validAttempts.length} valid attempts.`);

    res.status(200).json(filteredAttempts);
  } catch (error: any) {
    res.status(500).json({ message: error.message || 'Server error' });
  }
};

// @desc    Clear all results for an exam
// @route   DELETE /api/attempts/:examId/results
// @access  Private/Examiner/Admin
export const clearExamResults = async (req: AuthRequest, res: Response): Promise<void> => {
  const { examId } = req.params;
  
  const exam = await Exam.findById(examId);
  if (!exam) {
    res.status(404).json({ message: 'Exam not found' });
    return;
  }
  
  if (req.user.role !== 'Admin' && exam.creatorId.toString() !== req.user._id.toString()) {
    res.status(403).json({ message: 'Not authorized' });
    return;
  }
  
  // Delete all results and exam attempts for this exam
  await Result.deleteMany({ examId });
  await ExamAttempt.deleteMany({ examId });
  
  res.status(200).json({ message: 'All results cleared successfully' });
};

// @desc    Delete a specific exam result
// @route   DELETE /api/attempts/result/:resultId
// @access  Private/Examiner/Admin
export const deleteExamResult = async (req: AuthRequest, res: Response): Promise<void> => {
  const { resultId } = req.params;
  
  const result = await Result.findById(resultId).populate('examId');
  if (!result) {
    res.status(404).json({ message: 'Result not found' });
    return;
  }
  
  const exam = result.examId as any;
  if (req.user.role !== 'Admin' && exam.creatorId.toString() !== req.user._id.toString()) {
    res.status(403).json({ message: 'Not authorized' });
    return;
  }
  
  await Result.findByIdAndDelete(resultId);
  // Also delete corresponding ExamAttempt to fully clear it
  await ExamAttempt.findOneAndDelete({ candidateId: result.candidateId, examId: result.examId });
  
  res.status(200).json({ message: 'Result deleted successfully' });
};

// @desc    Toggle individual result release
// @route   PUT /api/attempts/results/:resultId/release
// @access  Private/Examiner/Admin
export const toggleResultRelease = async (req: AuthRequest, res: Response): Promise<void> => {
  const { resultId } = req.params;
  
  const result = await Result.findById(resultId).populate('examId');
  if (!result) {
    res.status(404).json({ message: 'Result not found' });
    return;
  }
  
  const exam = result.examId as any;
  if (req.user.role !== 'Admin' && exam.creatorId.toString() !== req.user._id.toString()) {
    res.status(403).json({ message: 'Not authorized' });
    return;
  }
  
  result.isReleased = !result.isReleased;
  await result.save();
  
  res.status(200).json(result);
};

// @desc    Cancel an active attempt
// @route   POST /api/attempts/:id/cancel
// @access  Private/Examiner/Admin
export const cancelAttempt = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  const attempt = await ExamAttempt.findById(id).populate('examId');
  if (!attempt) {
    res.status(404).json({ message: 'Attempt not found' });
    return;
  }

  const exam = attempt.examId as any;
  if (req.user.role !== 'Admin' && exam.creatorId.toString() !== req.user._id.toString()) {
    res.status(403).json({ message: 'Not authorized' });
    return;
  }

  if (attempt.status !== 'In-Progress') {
    res.status(400).json({ message: 'Can only cancel in-progress attempts' });
    return;
  }

  // Create a disqualified Result instead of just deleting
  const result = await Result.create({
    candidateId: attempt.candidateId,
    examId: attempt.examId,
    answers: attempt.answers || [],
    score: 0,
    totalMarks: exam.questions?.reduce((acc: number, q: any) => acc + (q.marks || 1), 0) || 0,
    violationReason: 'Cancelled by examiner due to rule violation',
    isReleased: true // Release immediately so candidate sees it
  });

  // Delete the live attempt
  await ExamAttempt.findByIdAndDelete(id);

  res.status(200).json({ message: 'Attempt cancelled and disqualified successfully', result });
};
