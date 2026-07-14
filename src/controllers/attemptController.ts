import { Response } from 'express';
import ExamAttempt from '../models/ExamAttempt';
import Exam from '../models/Exam';
import Result from '../models/Result';
import { AuthRequest } from '../middleware/authMiddleware';
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

  // Check if attempt already exists and is in-progress
  let attempt = await ExamAttempt.findOne({ candidateId: req.user._id, examId: id, status: 'In-Progress' });

  if (!attempt) {
    attempt = new ExamAttempt({
      candidateId: req.user._id,
      examId: id,
      timeRemaining: exam.durationMinutes * 60,
      answers: exam.questions.map((q: any) => ({
        questionId: q.questionId._id,
        status: 'Unanswered',
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
  const { answers, timeRemaining, warnings } = req.body;

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
  const { answers, timeRemaining } = req.body;

  const attempt = await ExamAttempt.findById(id);

  if (!attempt) {
    res.status(404).json({ message: 'Attempt not found' });
    return;
  }

  if (attempt.status === 'Submitted') {
    res.status(400).json({ message: 'Exam already submitted' });
    return;
  }

  // Save final state if provided
  if (answers) {
    attempt.answers = answers;
  }
  if (timeRemaining !== undefined) {
    attempt.timeRemaining = timeRemaining;
  }

  const exam = await Exam.findById(attempt.examId).populate('questions.questionId');

  let score = 0;
  let totalMarks = 0;

  // Calculate Score
  attempt.answers.forEach((ans) => {
    const examQuestion = exam?.questions.find(
      (q: any) => q.questionId && q.questionId._id.toString() === ans.questionId.toString()
    );
    if (examQuestion && examQuestion.questionId) {
      totalMarks += examQuestion.marks;
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

  let aiFeedback = "AI Feedback generation failed.";
  
  try {
    const prompt = `The candidate just completed a multiple-choice exam. They scored ${score} out of ${totalMarks}.
Analyze their performance and give a brief, encouraging qualitative summary pointing out areas of strength and areas to improve based on the category of questions they got right/wrong.
Do not provide a generic response; write directly to the candidate as a supportive tutor. Keep it under 3 sentences.`;

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || 'mock_key' });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    
    aiFeedback = response.text || aiFeedback;
  } catch (error) {
    console.error("AI feedback generation failed:", error);
  }

  const result = new Result({
    attemptId: attempt._id,
    candidateId: attempt.candidateId,
    examId: attempt.examId,
    score,
    totalMarks,
    aiFeedback,
  });

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
      options: qObj.options,
      correctOptionIndex: qObj.correctOptionIndex,
      marks: q.marks,
      candidateAnswerIndex: candidateAnswer?.selectedOptionIndex ?? null,
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
    result = await Result.findOne({ candidateId: req.user._id, examId }).populate('examId', 'title');
  } else {
    // If Admin/Examiner wants to see it, they can pass attemptId or we just return all results for the exam
    // For now, this route is mostly for the candidate. But we can allow admins to view specific candidate results if we passed candidateId in query.
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

  const results = await Result.find({ candidateId: req.user._id })
    .populate('examId', 'title durationMinutes category')
    .sort({ createdAt: -1 });

  res.status(200).json(results);
};
