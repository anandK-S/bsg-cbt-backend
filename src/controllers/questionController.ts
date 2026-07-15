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
  let { text, options, correctOptionIndex, category, translations, marks, type, acceptableAnswers } = req.body;
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
    const uploadDir = path.join(__dirname, '../../public/uploads');
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
    translations,
    type,
    mediaUrl,
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

    const prompt = `Extract the multiple choice questions from the following text and format them as a JSON array of objects.
Each object must have the following keys:
- "text": The question text
- "options": An array of 4 string options
- "correctOptionIndex": The 0-based index of the correct option
- "category": A guessed category based on the question (e.g. "First Aid", "Knots")

Text to parse:
${fileContent.substring(0, 5000)} // Limiting to prevent token explosion for this example
    `;

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
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    const aiText = response.text;
    
    // Attempt to parse JSON from the response (removing markdown code blocks if any)
    const jsonMatch = aiText?.match(/```(?:json)?([\s\S]*?)```/) || [null, aiText];
    const jsonString = jsonMatch[1]?.trim() || '[]';
    
    const parsedQuestions = JSON.parse(jsonString);

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

// @desc    Edit a question
// @route   PUT /api/exams/:examId/questions/:questionId
// @access  Private/Examiner/Admin
export const editQuestion = async (req: AuthRequest, res: Response): Promise<void> => {
  const { examId, questionId } = req.params;
  let { text, options, correctOptionIndex, category, translations, type, acceptableAnswers } = req.body;
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
    const uploadDir = path.join(__dirname, '../../public/uploads');
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
  if (correctOptionIndex !== undefined) question.correctOptionIndex = Number(correctOptionIndex);
  question.acceptableAnswers = acceptableAnswers || question.acceptableAnswers;
  question.category = category || question.category;
  question.translations = translations || question.translations;
  question.type = type || question.type;
  if (mediaUrl !== undefined) question.mediaUrl = mediaUrl;

  const updatedQuestion = await question.save();
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
