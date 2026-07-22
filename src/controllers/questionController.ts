import { Request, Response } from 'express';
import Question from '../models/Question';
import Exam from '../models/Exam';
import { AuthRequest } from '../middleware/authMiddleware';
import { GoogleGenAI } from '@google/genai';

const pdfParse = require('pdf-parse');
import mammoth from 'mammoth';

// We initialize inside the function so it doesn't crash on startup if the key is missing

import fs from 'fs';
import path from 'path';

// @desc    Add a question to an exam
// @route   POST /api/exams/:examId/questions
// @access  Private/Examiner/Admin
export const addQuestion = async (req: AuthRequest, res: Response): Promise<void> => {
  const { examId } = req.params;
  let { text, options, correctOptionIndex, category, section, translations, marks, type, acceptableAnswers, textHindi, optionsHindi } = req.body;
  let mediaUrl = req.body.mediaUrl;

  const exam = await Exam.findById(examId);

  if (!exam) {
    res.status(404).json({ message: 'Exam not found' });
    return;
  }

  // Authorization check (Admin or creator)
  if (req.user.role !== 'Admin' && exam.creatorId.toString() !== req.user._id.toString()) {
    res.status(403).json({ message: 'Not authorized to add questions to this exam' });
    return;
  }

  // Handle local file upload
  if (req.file) {
    const uploadDir = path.join(process.cwd(), 'public/uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const ext = path.extname(req.file.originalname);
    const filename = `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`;
    fs.writeFileSync(path.join(uploadDir, filename), req.file.buffer);
    mediaUrl = `/uploads/${filename}`;
  }

  // Parse strings back to arrays/objects if they were sent as form-data strings
  if (typeof options === 'string') options = JSON.parse(options);
  if (typeof acceptableAnswers === 'string') acceptableAnswers = JSON.parse(acceptableAnswers);
  if (typeof translations === 'string') translations = JSON.parse(translations);

  const question = new Question({
    examId,
    text,
    options: options || [],
    correctOptionIndex: correctOptionIndex ? Number(correctOptionIndex) : undefined,
    acceptableAnswers: acceptableAnswers || [],
    category,
    section,
    translations,
    type,
    mediaUrl,
    textHindi,
    optionsHindi: optionsHindi ? (typeof optionsHindi === 'string' ? JSON.parse(optionsHindi) : optionsHindi) : undefined,
  });

  const createdQuestion = await question.save();

  exam.questions.push({
    questionId: createdQuestion._id as any,
    marks: marks || 1,
  });

  await exam.save();

  res.status(201).json(createdQuestion);
};

// @desc    Import questions via AI (PDF/Docx text content extraction)
// @route   POST /api/exams/:examId/questions/import
// @access  Private/Examiner/Admin
export const importQuestions = async (req: AuthRequest, res: Response): Promise<void> => {
  const { examId } = req.params;
  const file = req.file;

  if (!file) {
    res.status(400).json({ message: 'No file uploaded' });
    return;
  }

  const exam = await Exam.findById(examId);

  if (!exam) {
    res.status(404).json({ message: 'Exam not found' });
    return;
  }

  if (req.user.role !== 'Admin' && exam.creatorId.toString() !== req.user._id.toString()) {
    res.status(403).json({ message: 'Not authorized to add questions to this exam' });
    return;
  }

  try {
    let fileContent = '';
    const mimeType = file.mimetype;
    const originalName = file.originalname.toLowerCase();

    let contentsPayload: any = [];
    const basePrompt = `Extract the multiple choice questions from the following text/image and format them as a JSON array of objects.
CRITICAL INSTRUCTIONS: 
1. If the provided document contains the correct answers, ensure the "correctOptionIndex" strictly matches the answer key.
2. If you absolutely cannot find any questions or readable text in the file, return a JSON object with a single key "error" explaining why (e.g. {"error": "The image is too blurry to read any text."}).
3. Otherwise, return a JSON array of objects, where each object has:
- "text": The question text
- "options": An array of 4 string options
- "correctOptionIndex": The 0-based index of the correct option
- "category": A guessed category based on the question (e.g. "Scouting", "First Aid", "Knots")
`;

    if (mimeType.startsWith('image/')) {
      contentsPayload = [
        basePrompt,
        {
          inlineData: {
            data: file.buffer.toString('base64'),
            mimeType: mimeType
          }
        }
      ];
    } else {
      if (mimeType === 'application/pdf' || originalName.endsWith('.pdf')) {
        const pdfData = await pdfParse(file.buffer);
        fileContent = pdfData.text;
      } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || originalName.endsWith('.docx')) {
        const docxData = await mammoth.extractRawText({ buffer: file.buffer });
        fileContent = docxData.value;
      } else {
        // Fallback to text
        fileContent = file.buffer.toString('utf-8');
      }
      
      if (!fileContent || fileContent.trim() === '') {
        res.status(400).json({ message: 'Could not extract text from the file.' });
        return;
      }

      contentsPayload = `${basePrompt}\n\nText to parse:\n${fileContent}`;
    }

    if (!process.env.GEMINI_API_KEY) {
      // Return a mock parsed question instead of throwing an error
      const mockQuestions = [
        {
          text: "Sample AI Extracted Question from Document?",
          options: ["Option A", "Option B", "Option C", "Option D"],
          correctOptionIndex: 0,
          category: "AI Generated"
        }
      ];
      
      const createdQuestions = [];
      for (const q of mockQuestions) {
        const question = new Question({
          examId,
          text: q.text,
          options: q.options,
          correctOptionIndex: q.correctOptionIndex,
          category: q.category,
        });
        const savedQ = await question.save();
        createdQuestions.push(savedQ);
        
        exam.questions.push({
          questionId: savedQ._id as any,
          marks: 1,
        });
      }
      await exam.save();
      res.status(201).json({ message: 'Questions imported successfully (Mock data used since API key is missing)', count: createdQuestions.length });
      return;
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    let response;
    let retries = 3;
    let delay = 2000;
    while (retries > 0) {
      try {
        response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: contentsPayload,
        });
        break; // Success
      } catch (err: any) {
        const isUnavailable = err?.status === 503 || err?.status === 'UNAVAILABLE' || (err?.message && err.message.includes('503'));
        if (isUnavailable) {
          retries--;
          if (retries === 0) throw err;
          await new Promise(res => setTimeout(res, delay));
          delay *= 2; // Exponential backoff
        } else {
          throw err;
        }
      }
    }

    const aiText = response?.text;
    
    // Attempt to parse JSON from the response (removing markdown code blocks if any)
    const jsonMatch = aiText?.match(/```(?:json)?([\s\S]*?)```/) || [null, aiText];
    const jsonString = jsonMatch[1]?.trim() || '[]';
    
    let parsedQuestions: any;
    try {
      parsedQuestions = JSON.parse(jsonString);
    } catch (parseError) {
      console.error('Error parsing JSON from AI response:', aiText);
      res.status(500).json({ message: 'AI returned invalid formatting. Please try again.' });
      return;
    }

    if (parsedQuestions && parsedQuestions.error) {
      res.status(400).json({ message: 'AI could not read file: ' + parsedQuestions.error });
      return;
    }

    if (!Array.isArray(parsedQuestions)) {
      res.status(500).json({ message: 'AI did not return a list of questions.' });
      return;
    }

    const createdQuestions = [];

    for (const q of parsedQuestions) {
      const question = new Question({
        examId,
        text: q.text,
        options: q.options,
        correctOptionIndex: q.correctOptionIndex,
        category: q.category,
      });
      const savedQ = await question.save();
      createdQuestions.push(savedQ);
      
      exam.questions.push({
        questionId: savedQ._id as any,
        marks: 1,
      });
    }

    await exam.save();

    res.status(201).json({ message: 'Questions imported successfully', count: createdQuestions.length });
  } catch (error: any) {
    console.error('Error importing questions:', error);
    res.status(500).json({ message: 'Error parsing questions with AI: ' + (error?.message || error) });
  }
};

import ExamAttempt from '../models/ExamAttempt';
import Result from '../models/Result';

// @desc    Edit a question
// @route   PUT /api/exams/:examId/questions/:questionId
// @access  Private/Examiner/Admin
export const editQuestion = async (req: AuthRequest, res: Response): Promise<void> => {
  const { examId, questionId } = req.params;
  let { text, options, correctOptionIndex, category, section, translations, type, acceptableAnswers } = req.body;
  let mediaUrl = req.body.mediaUrl;

  const exam = await Exam.findById(examId);

  if (!exam) {
    res.status(404).json({ message: 'Exam not found' });
    return;
  }

  // Authorization check
  if (req.user.role !== 'Admin' && exam.creatorId.toString() !== req.user._id.toString()) {
    res.status(403).json({ message: 'Not authorized' });
    return;
  }

  const question = await Question.findById(questionId);
  if (!question) {
    res.status(404).json({ message: 'Question not found' });
    return;
  }

  // Handle local file upload for updating media
  if (req.file) {
    const uploadDir = path.join(process.cwd(), 'public/uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const ext = path.extname(req.file.originalname);
    const filename = `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`;
    fs.writeFileSync(path.join(uploadDir, filename), req.file.buffer);
    mediaUrl = `/uploads/${filename}`;
  }

  if (typeof options === 'string') options = JSON.parse(options);
  if (typeof acceptableAnswers === 'string') acceptableAnswers = JSON.parse(acceptableAnswers);
  if (typeof translations === 'string') translations = JSON.parse(translations);

  question.text = text || question.text;
  question.options = options || question.options;
  
  let oldCorrectIndex = question.correctOptionIndex;
  let triggeredReevaluation = false;
  if (correctOptionIndex !== undefined) {
    const newCorrectIndex = Number(correctOptionIndex);
    if (newCorrectIndex !== oldCorrectIndex) {
      triggeredReevaluation = true;
    }
    question.correctOptionIndex = newCorrectIndex;
  }
  
  question.acceptableAnswers = acceptableAnswers || question.acceptableAnswers;
  question.category = category || question.category;
  question.textHindi = req.body.textHindi !== undefined ? req.body.textHindi : question.textHindi;
  question.optionsHindi = req.body.optionsHindi !== undefined ? req.body.optionsHindi : question.optionsHindi;
  question.type = type || question.type;
  if (mediaUrl !== undefined) question.mediaUrl = mediaUrl;

  const updatedQuestion = await question.save();
  
  if (triggeredReevaluation) {
    // Dynamic Re-evaluation Logic
    // Find all submitted attempts for this exam
    const submittedAttempts = await ExamAttempt.find({ 
      examId, 
      status: { $in: ['Submitted', 'Auto-Submitted'] } 
    });
    
    // Also need to fetch all questions for this exam to re-calculate score
    const fullExam = await Exam.findById(examId).populate('questions.questionId');
    
    if (fullExam && submittedAttempts.length > 0) {
      for (const attempt of submittedAttempts) {
        let score = 0;
        let totalMarks = 0;
        
        attempt.answers.forEach((ans) => {
          const examQuestion = fullExam.questions.find(
            (q: any) => q.questionId && q.questionId._id.toString() === ans.questionId.toString()
          );
          if (examQuestion && examQuestion.questionId) {
            totalMarks += examQuestion.marks;
            const correctIndex = (examQuestion.questionId as any).correctOptionIndex;
            if (
              ans.selectedOptionIndex !== undefined &&
              ans.selectedOptionIndex !== null &&
              ans.selectedOptionIndex === correctIndex
            ) {
              score += examQuestion.marks;
            }
          }
        });
        
        // Update the result document
        await Result.updateOne(
          { attemptId: attempt._id },
          { $set: { score, totalMarks } }
        );
      }
    }
  }

  res.status(200).json(updatedQuestion);
};

// @desc    Delete a question
// @route   DELETE /api/exams/:examId/questions/:questionId
// @access  Private/Examiner/Admin
export const deleteQuestion = async (req: AuthRequest, res: Response): Promise<void> => {
  const { examId, questionId } = req.params;

  const exam = await Exam.findById(examId);

  if (!exam) {
    res.status(404).json({ message: 'Exam not found' });
    return;
  }

  // Authorization check
  if (req.user.role !== 'Admin' && exam.creatorId.toString() !== req.user._id.toString()) {
    res.status(403).json({ message: 'Not authorized' });
    return;
  }
  
  // Security Fix: Prevent deletion if there are active candidates
  const activeAttempts = await ExamAttempt.findOne({ examId: examId, status: 'In-Progress' });
  if (activeAttempts) {
    res.status(400).json({ message: 'Cannot delete questions while candidates are currently taking the exam.' });
    return;
  }

  const question = await Question.findById(questionId);
  if (!question) {
    res.status(404).json({ message: 'Question not found' });
    return;
  }

  // Remove from exam questions array
  exam.questions = exam.questions.filter((q: any) => q.questionId.toString() !== questionId);
  await exam.save();

  await Question.findByIdAndDelete(questionId);

  res.status(200).json({ message: 'Question removed successfully' });
};

// @desc    Auto translate text
// @route   POST /api/exams/translate
// @access  Private/Examiner/Admin
export const autoTranslate = async (req: AuthRequest, res: Response): Promise<void> => {
  const { text, targetLanguage = 'Hindi' } = req.body;
  if (!text) {
    res.status(400).json({ message: 'No text provided' });
    return;
  }
  
  if (!process.env.GEMINI_API_KEY) {
    res.status(200).json({ translatedText: text + ` (Translation API missing)` });
    return;
  }
  
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Translate the following text to ${targetLanguage}. Only return the translated ${targetLanguage} text without any formatting, quotes, or markdown. Text to translate:\n\n${text}`,
    });
    res.status(200).json({ translatedText: response.text?.trim() });
  } catch (error: any) {
    console.error('Translation error:', error);
    res.status(500).json({ message: 'Translation failed: ' + (error?.message || error) });
  }
};

