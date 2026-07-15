import { Request, Response } from 'express';
import Exam from '../models/Exam';
import { AuthRequest } from '../middleware/authMiddleware';

// @desc    Get all exams
// @route   GET /api/exams
// @access  Private/Examiner/Admin
export const getExams = async (req: AuthRequest, res: Response) => {
  let exams;
  if (req.user.role === 'Admin') {
    exams = await Exam.find({}).populate('creatorId', 'name email');
  } else {
    // Examiner sees only their exams
    exams = await Exam.find({ creatorId: req.user._id }).populate('creatorId', 'name email');
  }
  res.json(exams);
};

// @desc    Get available exams for candidate
// @route   GET /api/exams/available
// @access  Private
export const getAvailableExams = async (req: AuthRequest, res: Response) => {
  const exams = await Exam.find({ status: 'Published' }).populate('creatorId', 'name');
  const formattedExams = exams.map(exam => {
    let maxScore = 0;
    exam.questions.forEach((q: any) => { maxScore += q.marks; });
    return {
      _id: exam._id,
      title: exam.title,
      description: exam.description,
      durationMinutes: exam.durationMinutes,
      status: exam.status,
      questionCount: exam.questions.length,
      maxScore,
      creatorName: exam.creatorId ? (exam.creatorId as any).name : 'Unknown',
    };
  });
  res.json(formattedExams);
};

// @desc    Create an exam
// @route   POST /api/exams
// @access  Private/Examiner/Admin
export const createExam = async (req: AuthRequest, res: Response) => {
  const { title, description, durationMinutes, durationUnit, passingMarks, scheduledStartDate, scheduledEndDate } = req.body;

  const exam = new Exam({
    title,
    description,
    durationMinutes,
    durationUnit: durationUnit || 'min',
    passingMarks: passingMarks || 50,
    scheduledStartDate,
    scheduledEndDate,
    creatorId: req.user._id,
  });

  const createdExam = await exam.save();
  res.status(201).json(createdExam);
};

// @desc    Get exam by ID
// @route   GET /api/exams/:id
// @access  Private
export const getExamById = async (req: AuthRequest, res: Response): Promise<void> => {
  const exam = await Exam.findById(req.params.id).populate('questions.questionId');

  if (exam) {
    res.json(exam);
  } else {
    res.status(404).json({ message: 'Exam not found' });
  }
};

// @desc    Update exam status
// @route   PUT /api/exams/:id/status
// @access  Private/Examiner/Admin
export const updateExamStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['Draft', 'Published', 'Archived'].includes(status)) {
    res.status(400).json({ message: 'Invalid status' });
    return;
  }

  const exam = await Exam.findById(id);

  if (!exam) {
    res.status(404).json({ message: 'Exam not found' });
    return;
  }

  // Authorization check
  if (req.user.role !== 'Admin' && exam.creatorId.toString() !== req.user._id.toString()) {
    res.status(403).json({ message: 'Not authorized to update this exam' });
    return;
  }

  exam.status = status;
  await exam.save();

  res.status(200).json(exam);
};
