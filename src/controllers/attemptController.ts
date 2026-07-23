import { Response } from 'express';
import { supabase } from '../config/supabase';
import { AuthRequest } from '../middleware/authMiddleware';
import { generateAIContent } from '../utils/aiService';

// @desc    Start an exam attempt
// @route   POST /api/exams/:id/start
// @access  Private/Candidate
export const startExam = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { data: exam } = await supabase.from('exams').select('*, questions(*)').eq('id', id).single();

  if (!exam) {
    res.status(404).json({ message: 'Exam not found' }); return;
  }

  const { data: settings } = await supabase.from('settings').select('*').single();
  if (settings?.maintenance_mode && req.user.role === 'Candidate') {
    res.status(503).json({ message: 'The platform is currently under maintenance. New exams cannot be started.' }); return;
  }

  const now = new Date();
  if (exam.scheduled_start_date && new Date(exam.scheduled_start_date) > now) {
    res.status(403).json({ message: 'Exam has not started yet', availableFrom: exam.scheduled_start_date }); return;
  }
  if (exam.scheduled_end_date && new Date(exam.scheduled_end_date) < now) {
    res.status(403).json({ message: 'Exam has already ended' }); return;
  }

  if (exam.test_key && exam.test_key.trim() !== '') {
    if (req.body.testKey !== exam.test_key) {
      res.status(401).json({ message: 'Invalid or missing test password.' }); return;
    }
  }

  if (!exam.allow_multiple_attempts) {
    const { data: existingCompleted } = await supabase.from('exam_attempts')
      .select('id').eq('candidate_id', req.user._id).eq('exam_id', id)
      .in('status', ['Submitted', 'Auto-Submitted', 'Blocked']).maybeSingle();
      
    if (existingCompleted) {
      res.status(403).json({ message: 'You have already submitted this exam and multiple attempts are not allowed.' }); return;
    }
  }

  let { data: attempt } = await supabase.from('exam_attempts')
    .select('*').eq('candidate_id', req.user._id).eq('exam_id', id).eq('status', 'In-Progress').maybeSingle();

  if (!attempt) {
    const totalSeconds = exam.duration_seconds ? exam.duration_seconds : (exam.duration_minutes * 60);
    const initialAnswers = exam.questions.map((q: any) => ({
      questionId: q.id,
      status: 'NotVisited',
    }));

    const { data: newAttempt, error } = await supabase.from('exam_attempts').insert({
      candidate_id: req.user._id,
      exam_id: id,
      time_remaining: totalSeconds,
      answers: initialAnswers,
      status: 'In-Progress'
    }).select().single();
    
    if (error) {
      res.status(500).json({ message: error.message }); return;
    }
    attempt = newAttempt;
  }

  const sanitizedQuestions = exam.questions.map((q: any) => {
    const { correct_option_index, ...rest } = q;
    return { ...rest, _id: rest.id };
  });

  res.status(200).json({ 
    attempt: { 
      ...attempt, 
      _id: attempt.id, 
      timeRemaining: attempt.time_remaining,
      timeSpentAnalytics: attempt.time_spent_analytics,
      startTime: attempt.start_time,
      endTime: attempt.end_time,
      examId: attempt.exam_id,
      candidateId: attempt.candidate_id
    }, 
    questions: sanitizedQuestions, 
    examTitle: exam.title, 
    durationMinutes: exam.duration_minutes 
  });
};

// @desc    Heartbeat sync (save state)
// @route   POST /api/attempts/:id/heartbeat
// @access  Private/Candidate
export const heartbeatSync = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { answers, timeRemaining, warnings, timeSpentAnalytics } = req.body;

  const { data: attempt } = await supabase.from('exam_attempts').select('*').eq('id', id).single();

  if (!attempt) {
    res.status(404).json({ message: 'Attempt not found' }); return;
  }

  if (attempt.status !== 'In-Progress') {
    res.status(400).json({ message: 'Exam already submitted or blocked' }); return;
  }

  const updates: any = {};
  if (answers) updates.answers = answers;
  if (timeRemaining !== undefined) updates.time_remaining = timeRemaining;
  if (timeSpentAnalytics) updates.time_spent_analytics = timeSpentAnalytics;
  
  if (warnings !== undefined) {
    updates.warnings = warnings;
    if (warnings >= 1) {
      updates.status = 'Blocked';
    }
  }

  const { data: updatedAttempt, error } = await supabase.from('exam_attempts').update(updates).eq('id', id).select().single();
  
  if (error) {
    res.status(500).json({ message: error.message }); return;
  }

  res.status(200).json({ message: 'Sync successful', status: updatedAttempt.status }); return;
};

// @desc    Submit exam
// @route   POST /api/attempts/:id/submit
// @access  Private/Candidate
export const submitExam = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { answers, timeRemaining, timeSpentAnalytics, violationReason } = req.body;

  const { data: attempt } = await supabase.from('exam_attempts').select('*').eq('id', id).single();

  if (!attempt) {
    res.status(404).json({ message: 'Attempt not found' }); return;
  }

  if (attempt.status === 'Submitted') {
    res.status(400).json({ message: 'Exam already submitted' }); return;
  }

  const updates: any = {
    status: 'Submitted',
    end_time: new Date().toISOString()
  };
  
  if (answers) updates.answers = answers;
  if (timeRemaining !== undefined) updates.time_remaining = timeRemaining;
  if (timeSpentAnalytics) updates.time_spent_analytics = timeSpentAnalytics;
  if (violationReason) updates.violation_reason = violationReason;

  const { data: updatedAttempt, error: updateError } = await supabase.from('exam_attempts').update(updates).eq('id', id).select().single();
  if (updateError) { res.status(500).json({ message: updateError.message }); return; }
  
  const finalAnswers = answers || attempt.answers || [];

  const { data: exam } = await supabase.from('exams').select('*, questions(*)').eq('id', attempt.exam_id).single();

  let score = 0;
  let totalMarks = 0;

  exam?.questions.forEach((q: any) => {
    totalMarks += q.marks || 1;
  });

  finalAnswers.forEach((ans: any) => {
    const examQuestion = exam?.questions.find((q: any) => q.id === ans.questionId);
    if (examQuestion) {
      if (ans.selectedOptionIndex !== undefined && ans.selectedOptionIndex !== null && Number(ans.selectedOptionIndex) === Number(examQuestion.correct_option_index)) {
        score += (examQuestion.marks || 1);
      }
    }
  });

  let aiFeedback = "Good job on completing the exam! Review your correct and incorrect answers to improve your score next time.";
  if (process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_2 || process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY) {
    try {
      const aiText = await generateAIContent({
        userPrompt: `The candidate just completed a multiple-choice exam. They scored ${score} out of ${totalMarks}. Analyze their performance and give a brief, encouraging qualitative summary. Keep it under 3 sentences.`
      });
      if (aiText) aiFeedback = aiText;
    } catch (error) {}
  }

  const { data: result, error: resultError } = await supabase.from('results').insert({
    attempt_id: id,
    candidate_id: attempt.candidate_id,
    exam_id: attempt.exam_id,
    score,
    total_marks: totalMarks,
    ai_feedback: aiFeedback,
    violation_reason: violationReason,
    answers: finalAnswers
  }).select().single();

  if (resultError) { res.status(500).json({ message: resultError?.message }); return; }

  res.status(200).json({ ...result, _id: result.id }); return;
};

// @desc    Get detailed result by result ID
// @route   GET /api/attempts/results/:resultId/detailed
// @access  Private/Candidate/Examiner/Admin
export const getDetailedResult = async (req: AuthRequest, res: Response): Promise<void> => {
  const { resultId } = req.params;
  
  const { data: result } = await supabase.from('results').select('*, exam:exam_id(title, description, duration_minutes)').eq('id', resultId).single();
  if (!result) {
    res.status(404).json({ message: 'Result not found' }); return;
  }
  
  if (req.user.role === 'Candidate' && result.candidate_id !== req.user._id) {
    res.status(403).json({ message: 'Not authorized to view this result' }); return;
  }
  
  const { data: attempt } = await supabase.from('exam_attempts').select('answers').eq('id', result.attempt_id).single();
  const { data: questions } = await supabase.from('questions').select('*').eq('exam_id', result.exam_id);
  
  const attemptAnswers = result.answers || attempt?.answers || [];
  
  const questionDetails = (questions || []).map((q: any) => {
    const candidateAnswer = attemptAnswers.find((a: any) => a.questionId === q.id);
    return {
      _id: q.id,
      text: q.text,
      textHindi: q.text_hindi,
      options: q.options,
      optionsHindi: q.options_hindi,
      correctOptionIndex: q.correct_option_index,
      marks: q.marks || 1,
      candidateAnswerIndex: candidateAnswer?.selectedOptionIndex ?? null,
      viewedLanguage: candidateAnswer?.viewedLanguage || 'en',
      isCorrect: candidateAnswer?.selectedOptionIndex === q.correct_option_index
    };
  });
  
  res.status(200).json({
    result: { ...result, _id: result.id, examId: result.exam },
    questionDetails
  });
};

// @desc    Get result by exam ID
// @route   GET /api/attempts/:examId/result
// @access  Private/Candidate/Examiner/Admin
export const getResult = async (req: AuthRequest, res: Response): Promise<void> => {
  const { examId } = req.params;
  
  if (req.user.role === 'Candidate') {
    const { data: result } = await supabase.from('results').select('*, exam:exam_id(title, release_results_instantly)').eq('candidate_id', req.user._id).eq('exam_id', examId).maybeSingle();
    
    if (result && result.exam && (result.exam as any).release_results_instantly === false && !result.is_released) {
      res.status(403).json({ message: 'Results for this exam have not been released yet.' }); return;
    }
    if (!result) { res.status(404).json({ message: 'Result not found' }); return; }
    res.status(200).json({ ...result, _id: result.id, examId: result.exam }); return;
  } else {
    let query = supabase.from('results').select('*, exam:exam_id(title), candidate:candidate_id(name, email, bsgid, role)').eq('exam_id', examId);
    if (req.query.candidateId) {
      query = query.eq('candidate_id', req.query.candidateId);
    }
    const { data: allResults } = await query;
    const candidatesResults = (allResults || []).filter((r: any) => r.candidate?.role === 'Candidate').map(r => ({ ...r, _id: r.id, examId: r.exam, candidateId: r.candidate }));
    res.status(200).json(candidatesResults); return;
  }
};

// @desc    Get all results for logged in candidate
// @route   GET /api/attempts/results/me
// @access  Private/Candidate
export const getMyResults = async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user.role !== 'Candidate') {
    res.status(403).json({ message: 'Only candidates can view their past results' }); return;
  }

  const { data: results, error } = await supabase
    .from('results')
    .select('*, exam:exam_id(title, duration_minutes, duration_seconds, category, release_results_instantly, creator_id), attempt:attempt_id(time_remaining, start_time, end_time)')
    .eq('candidate_id', req.user._id)
    .order('created_at', { ascending: false });

  if (error) { res.status(500).json({ message: error.message }); return; }

  const filtered = (results || []).filter((r: any) => r.is_released || (r.exam && r.exam.release_results_instantly !== false));

  res.status(200).json(filtered.map(r => ({ ...r, _id: r.id, examId: r.exam, attemptId: r.attempt }))); return;
};

// @desc    Get Global Leaderboard
// @route   GET /api/attempts/leaderboard
// @access  Private (All Authenticated)
export const getLeaderboard = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { examId, startDate, endDate } = req.query;
    
    let query = supabase.from('results').select('*, candidate:candidate_id(id, name, bsgid, section, role, district)');
    
    if (examId && examId !== 'All') query = query.eq('exam_id', examId);
    if (startDate) query = query.gte('created_at', new Date(startDate as string).toISOString());
    if (endDate) {
      const end = new Date(endDate as string);
      end.setHours(23, 59, 59, 999);
      query = query.lte('created_at', end.toISOString());
    }
    
    const { data: results, error } = await query;
    if (error) throw error;

    const candidateMap = new Map();

    results.forEach((r: any) => {
      if (!r.candidate || r.candidate.role !== 'Candidate') return;
      
      const cid = r.candidate.id;
      if (!candidateMap.has(cid)) {
        candidateMap.set(cid, {
          _id: cid,
          name: r.candidate.name,
          bsgId: r.candidate.bsgid,
          section: r.candidate.section,
          district: r.candidate.district,
          totalScore: 0,
          totalMarksPossible: 0,
          examsTaken: 0,
        });
      }

      const stats = candidateMap.get(cid);
      stats.totalScore += r.score;
      stats.totalMarksPossible += r.total_marks;
      stats.examsTaken += 1;
    });

    const leaderboard = Array.from(candidateMap.values())
      .map(c => ({
        ...c,
        percentage: c.totalMarksPossible > 0 ? ((c.totalScore / c.totalMarksPossible) * 100).toFixed(1) : 0
      }))
      .sort((a, b) => {
        if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
        return Number(b.percentage) - Number(a.percentage);
      });

    res.status(200).json(leaderboard); return;
  } catch (error: any) {
    res.status(500).json({ message: error.message || 'Server error' }); return;
  }
};

// @desc    Delete an exam attempt and its result
// @route   DELETE /api/attempts/:id
// @access  Private/Admin
export const deleteAttempt = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await supabase.from('results').delete().eq('attempt_id', req.params.id);
    await supabase.from('exam_attempts').delete().eq('id', req.params.id);
    res.status(200).json({ message: 'Attempt and associated result deleted successfully' }); return;
  } catch (error: any) {
    res.status(500).json({ message: error.message || 'Server error' }); return;
  }
};

// @desc    Get live attempts for monitoring
// @route   GET /api/attempts/live
// @access  Private/Examiner/Admin
export const getLiveAttempts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data: liveAttempts, error } = await supabase
      .from('exam_attempts')
      .select('*, candidate:candidate_id(name, bsgid, section, district), exam:exam_id(title, creator_id, questions(marks))')
      .eq('status', 'In-Progress')
      .order('updated_at', { ascending: false });

    if (error) throw error;

    const cutoffTime = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const validAttempts = [];
    
    for (const attempt of (liveAttempts || [])) {
      if (attempt.updated_at && new Date(attempt.updated_at) < cutoffTime) {
        const totalMarks = attempt.exam?.questions?.reduce((acc: number, q: any) => acc + (q.marks || 1), 0) || 0;
        await supabase.from('results').insert({
          candidate_id: attempt.candidate_id,
          exam_id: attempt.exam_id,
          attempt_id: attempt.id,
          answers: attempt.answers || [],
          score: 0,
          total_marks: totalMarks,
          violation_reason: 'Abandoned due to inactivity',
          is_released: true
        });
        await supabase.from('exam_attempts').delete().eq('id', attempt.id);
      } else {
        validAttempts.push({ ...attempt, _id: attempt.id, candidateId: attempt.candidate, examId: { ...attempt.exam, _id: attempt.exam_id } });
      }
    }

    let filteredAttempts = validAttempts;
    if (req.user.role === 'Examiner') {
      filteredAttempts = validAttempts.filter(attempt => {
        return attempt.exam?.creator_id === req.user._id;
      });
    }

    res.status(200).json(filteredAttempts); return;
  } catch (error: any) {
    res.status(500).json({ message: error.message || 'Server error' }); return;
  }
};

// @desc    Clear all results for an exam
// @route   DELETE /api/attempts/:examId/results
// @access  Private/Examiner/Admin
export const clearExamResults = async (req: AuthRequest, res: Response): Promise<void> => {
  const { examId } = req.params;
  const { data: exam } = await supabase.from('exams').select('creator_id').eq('id', examId).single();
  if (!exam) {
    res.status(404).json({ message: 'Exam not found' }); return;
  }
  if (req.user.role !== 'Admin' && exam.creator_id !== req.user._id) {
    res.status(403).json({ message: 'Not authorized' }); return;
  }
  
  await supabase.from('results').delete().eq('exam_id', examId);
  await supabase.from('exam_attempts').delete().eq('exam_id', examId);
  
  res.status(200).json({ message: 'All results cleared successfully' }); return;
};

// @desc    Delete a specific exam result
// @route   DELETE /api/attempts/result/:resultId
// @access  Private/Examiner/Admin
export const deleteExamResult = async (req: AuthRequest, res: Response): Promise<void> => {
  const { resultId } = req.params;
  
  const { data: result } = await supabase.from('results').select('*, exam:exam_id(creator_id)').eq('id', resultId).single();
  if (!result) {
    res.status(404).json({ message: 'Result not found' }); return;
  }
  
  if (req.user.role !== 'Admin' && result.exam?.creator_id !== req.user._id) {
    res.status(403).json({ message: 'Not authorized' }); return;
  }
  
  await supabase.from('results').delete().eq('id', resultId);
  await supabase.from('exam_attempts').delete().eq('candidate_id', result.candidate_id).eq('exam_id', result.exam_id);
  
  res.status(200).json({ message: 'Result deleted successfully' }); return;
};

// @desc    Toggle individual result release
// @route   PUT /api/attempts/results/:resultId/release
// @access  Private/Examiner/Admin
export const toggleResultRelease = async (req: AuthRequest, res: Response): Promise<void> => {
  const { resultId } = req.params;
  const { data: result } = await supabase.from('results').select('*, exam:exam_id(creator_id)').eq('id', resultId).single();
  if (!result) { res.status(404).json({ message: 'Result not found' }); return; }
  if (req.user.role !== 'Admin' && result.exam?.creator_id !== req.user._id) { res.status(403).json({ message: 'Not authorized' }); return; }
  
  const { data: updatedResult } = await supabase.from('results').update({ is_released: !result.is_released }).eq('id', resultId).select().single();
  res.status(200).json(updatedResult); return;
};

// @desc    Cancel an active attempt
// @route   POST /api/attempts/:id/cancel
// @access  Private/Examiner/Admin
export const cancelAttempt = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  const { data: attempt } = await supabase.from('exam_attempts').select('*, exam:exam_id(creator_id, questions(marks))').eq('id', id).single();
  if (!attempt) { res.status(404).json({ message: 'Attempt not found' }); return; }
  if (req.user.role !== 'Admin' && attempt.exam?.creator_id !== req.user._id) { res.status(403).json({ message: 'Not authorized' }); return; }

  if (attempt.status !== 'In-Progress') { res.status(400).json({ message: 'Can only cancel in-progress attempts' }); return; }

  const totalMarks = attempt.exam?.questions?.reduce((acc: number, q: any) => acc + (q.marks || 1), 0) || 0;
  const { data: result } = await supabase.from('results').insert({
    candidate_id: attempt.candidate_id,
    exam_id: attempt.exam_id,
    attempt_id: id,
    answers: attempt.answers || [],
    score: 0,
    total_marks: totalMarks,
    violation_reason: 'Cancelled by examiner due to rule violation',
    is_released: true
  }).select().single();

  await supabase.from('exam_attempts').delete().eq('id', id);
  res.status(200).json({ message: 'Attempt cancelled and disqualified successfully', result }); return;
};
