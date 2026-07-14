import { Request, Response } from 'express';
import Question from '../models/Question';
import Exam from '../models/Exam';
import { AuthRequest } from '../middleware/authMiddleware';
import { GoogleGenAI } from '@google/genai';

const pdfParse = require('pdf-parse');
import mammoth from 'mammoth';

// We initialize inside the function so it doesn't crash on startup if the key is missing

// @desc    Add a question to an exam
// @route   POST /api/exams/:examId/questions
// @access  Private/Examiner/Admin
export const addQuestion = async (req: AuthRequest, res: Response): Promise<void> => {
  const { examId } = req.params;
  const { text, options, correctOptionIndex, category, translations, marks } = req.body;

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

  const question = new Question({
    examId,
    text,
    options,
    correctOptionIndex,
    category,
    translations,
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

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || 'mock_key' });
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
