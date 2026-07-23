import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { AuthRequest } from '../middleware/authMiddleware';

// @desc    Get all exams
// @route   GET /api/exams
// @access  Private/Examiner/Admin
export const getExams = async (req: AuthRequest, res: Response) => {
  let query = supabase.from('exams').select('*, creator:creator_id(name, email), questions(id)');
  
  if (req.user.role !== 'Admin') {
    query = query.eq('creator_id', req.user._id);
  }
  
  const { data: exams, error } = await query;
  if (error) res.status(500).json({ message: error.message }); return;

  const examIds = (exams || []).map(e => e.id);
  
  let attemptCountMap = new Map();
  if (examIds.length > 0) {
    const { data: attempts } = await supabase.from('exam_attempts').select('exam_id').in('exam_id', examIds).neq('status', 'In-Progress');
    if (attempts) {
      (attempts || []).forEach(a => {
        attemptCountMap.set(a.exam_id, (attemptCountMap.get(a.exam_id) || 0) + 1);
      });
    }
  }
  
  const formattedExams = (exams || []).map((exam: any) => ({
    ...exam,
    _id: exam.id,
    creatorId: exam.creator,
    questionCount: exam.questions ? exam.questions.length : 0,
    attemptCount: attemptCountMap.get(exam.id) || 0,
    durationMinutes: exam.duration_minutes,
    durationSeconds: exam.duration_seconds,
    durationUnit: exam.duration_unit,
    passingMarks: exam.passing_marks,
    passingCriteriaType: exam.passing_criteria_type,
    scheduledStartDate: exam.scheduled_start_date,
    scheduledEndDate: exam.scheduled_end_date,
    allowMultipleAttempts: exam.allow_multiple_attempts,
    releaseResultsInstantly: exam.release_results_instantly,
    issueCertificate: exam.issue_certificate,
    testKey: exam.test_key,
    createdAt: exam.created_at,
  }));
  
  res.json(formattedExams);
};

// @desc    Get available exams for candidate
// @route   GET /api/exams/available
// @access  Private
export const getAvailableExams = async (req: AuthRequest, res: Response) => {
  const now = new Date().toISOString();
  
  const { data: exams, error } = await supabase
    .from('exams')
    .select('*, creator:creator_id(name), questions(marks)')
    .or(`status.eq.Published,and(scheduled_start_date.lte.${now},scheduled_end_date.gte.${now})`);

  if (error) res.status(500).json({ message: error.message }); return;

  const formattedExams = (exams || []).map(exam => {
    let maxScore = 0;
    if (exam.questions) {
      exam.questions.forEach((q: any) => { maxScore += (q.marks || 1); });
    }
    return {
      _id: exam.id,
      title: exam.title,
      description: exam.description,
      durationMinutes: exam.duration_minutes,
      durationSeconds: exam.duration_seconds,
      status: exam.status,
      questionCount: exam.questions ? exam.questions.length : 0,
      maxScore,
      creatorName: exam.creator ? exam.creator.name : 'Unknown',
      scheduledStartDate: exam.scheduled_start_date,
      scheduledEndDate: exam.scheduled_end_date,
      createdAt: exam.created_at,
    };
  });
  res.json(formattedExams);
};

// @desc    Create an exam
// @route   POST /api/exams
// @access  Private/Examiner/Admin
export const createExam = async (req: AuthRequest, res: Response) => {
  const { title, description, category, durationMinutes, durationSeconds, durationUnit, passingMarks, passingCriteriaType, scheduledStartDate, scheduledEndDate, allowMultipleAttempts, releaseResultsInstantly, issueCertificate, testKey } = req.body;

  const { data: exam, error } = await supabase.from('exams').insert({
    title,
    description,
    category,
    duration_minutes: durationMinutes || 0,
    duration_seconds: durationSeconds || 0,
    duration_unit: durationUnit || 'min',
    passing_marks: passingMarks || 50,
    passing_criteria_type: passingCriteriaType || 'percentage',
    scheduled_start_date: scheduledStartDate,
    scheduled_end_date: scheduledEndDate,
    allow_multiple_attempts: allowMultipleAttempts || false,
    release_results_instantly: releaseResultsInstantly !== undefined ? releaseResultsInstantly : false,
    issue_certificate: issueCertificate !== undefined ? issueCertificate : false,
    test_key: testKey,
    creator_id: req.user._id,
  }).select().single();

  if (error) res.status(500).json({ message: error.message }); return;

  res.status(201).json({ ...exam, _id: exam.id }); return;
};

// @desc    Get exam by ID
// @route   GET /api/exams/:id
// @access  Private
export const getExamById = async (req: AuthRequest, res: Response): Promise<void> => {
  const { data: exam, error } = await supabase
    .from('exams')
    .select('*, questions(*)')
    .eq('id', req.params.id)
    .single();

  if (error || !exam) {
    res.status(404).json({ message: 'Exam not found' }); return;
    return;
  }

  const examObj: any = {
    ...exam,
    _id: exam.id,
    creatorId: exam.creator_id,
    durationMinutes: exam.duration_minutes,
    durationSeconds: exam.duration_seconds,
    durationUnit: exam.duration_unit,
    passingMarks: exam.passing_marks,
    passingCriteriaType: exam.passing_criteria_type,
    scheduledStartDate: exam.scheduled_start_date,
    scheduledEndDate: exam.scheduled_end_date,
    allowMultipleAttempts: exam.allow_multiple_attempts,
    releaseResultsInstantly: exam.release_results_instantly,
    issueCertificate: exam.issue_certificate,
    testKey: exam.test_key,
    questions: exam.questions.map((q: any) => ({ ...q, _id: q.id, questionId: { ...q, _id: q.id } }))
  };

  const hasTestKey = !!examObj.testKey;
  if (req.user.role === 'Candidate') {
    delete examObj.testKey;
  }

  res.json({ ...examObj, hasTestKey });
};

// @desc    Update exam status
// @route   PUT /api/exams/:id/status
// @access  Private/Examiner/Admin
export const updateExamStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['Draft', 'Published', 'Archived'].includes(status)) {
    res.status(400).json({ message: 'Invalid status' }); return;
    return;
  }

  const { data: exam } = await supabase.from('exams').select('creator_id').eq('id', id).single();
  if (!exam) {
    res.status(404).json({ message: 'Exam not found' }); return;
    return;
  }

  if (req.user.role !== 'Admin' && exam.creator_id !== req.user._id) {
    res.status(403).json({ message: 'Not authorized to update this exam' }); return;
    return;
  }

  const { data: updatedExam, error } = await supabase.from('exams').update({ status }).eq('id', id).select().single();
  if (error) {
     res.status(500).json({ message: error.message }); return;
     return;
  }
  res.json({ message: 'Status updated', exam: { ...updatedExam, _id: updatedExam.id } });
};

// @desc    Update exam details
// @route   PUT /api/exams/:id
// @access  Private/Examiner/Admin
export const updateExam = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { title, description, category, durationMinutes, durationSeconds, durationUnit, passingMarks, passingCriteriaType, scheduledStartDate, scheduledEndDate, allowMultipleAttempts, releaseResultsInstantly, issueCertificate, testKey } = req.body;

  const { data: exam } = await supabase.from('exams').select('creator_id').eq('id', id).single();
  if (!exam) {
    res.status(404).json({ message: 'Exam not found' }); return;
    return;
  }

  if (req.user.role !== 'Admin' && exam.creator_id !== req.user._id) {
    res.status(403).json({ message: 'Not authorized to update this exam' }); return;
    return;
  }

  const updates: any = {};
  if (title) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (category !== undefined) updates.category = category;
  if (durationMinutes !== undefined) updates.duration_minutes = durationMinutes;
  if (durationSeconds !== undefined) updates.duration_seconds = durationSeconds;
  if (durationUnit) updates.duration_unit = durationUnit;
  if (passingMarks !== undefined) updates.passing_marks = passingMarks;
  if (passingCriteriaType !== undefined) updates.passing_criteria_type = passingCriteriaType;
  if (scheduledStartDate !== undefined) updates.scheduled_start_date = scheduledStartDate || null;
  if (scheduledEndDate !== undefined) updates.scheduled_end_date = scheduledEndDate || null;
  if (allowMultipleAttempts !== undefined) updates.allow_multiple_attempts = allowMultipleAttempts;
  if (releaseResultsInstantly !== undefined) updates.release_results_instantly = releaseResultsInstantly;
  if (issueCertificate !== undefined) updates.issue_certificate = issueCertificate;
  if (testKey !== undefined) updates.test_key = testKey;

  const { data: updatedExam, error } = await supabase.from('exams').update(updates).eq('id', id).select().single();
  if (error) res.status(500).json({ message: error.message }); return;

  res.json({ message: 'Exam updated', exam: { ...updatedExam, _id: updatedExam.id } });
};

// @desc    Delete exam
// @route   DELETE /api/exams/:id
// @access  Private/Examiner/Admin
export const deleteExam = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  const { data: exam } = await supabase.from('exams').select('creator_id').eq('id', id).single();
  if (!exam) {
    res.status(404).json({ message: 'Exam not found' }); return;
    return;
  }

  if (req.user.role !== 'Admin' && exam.creator_id !== req.user._id) {
    res.status(403).json({ message: 'Not authorized to delete this exam' }); return;
    return;
  }
  
  const { data: activeAttempts } = await supabase.from('exam_attempts').select('id').eq('exam_id', id).eq('status', 'In-Progress').limit(1);
  if (activeAttempts && activeAttempts.length > 0) {
    res.status(400).json({ message: 'Cannot delete this exam because candidates are currently taking it.' }); return;
    return;
  }

  await supabase.from('exams').delete().eq('id', id);
  res.json({ message: 'Exam removed successfully' });
};
