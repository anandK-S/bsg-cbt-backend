import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { AuthRequest } from '../middleware/authMiddleware';
import { generateAIContent } from '../utils/aiService';

const pdfParse = require('pdf-parse');
import mammoth from 'mammoth';
import fs from 'fs';
import path from 'path';

// @desc    Add a question to an exam
// @route   POST /api/exams/:examId/questions
// @access  Private/Examiner/Admin
export const addQuestion = async (req: AuthRequest, res: Response): Promise<void> => {
  const { examId } = req.params;
  let { text, options, correctOptionIndex, category, section, translations, marks, type, acceptableAnswers, textHindi, optionsHindi } = req.body;
  let mediaUrl = req.body.mediaUrl;

  const { data: exam, error: examError } = await supabase.from('exams').select('creator_id').eq('id', examId).single();

  if (examError || !exam) {
    res.status(404).json({ message: 'Exam not found' }); return;
  }

  // Authorization check (Admin or creator)
  if (req.user.role !== 'Admin' && exam.creator_id !== req.user._id) {
    res.status(403).json({ message: 'Not authorized to add questions to this exam' }); return;
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
  if (typeof optionsHindi === 'string') optionsHindi = JSON.parse(optionsHindi);

  // Duplicate Protection Check
  const { data: existing } = await supabase.from('questions').select('id').eq('exam_id', examId).eq('text', text).maybeSingle();
  if (existing) {
    res.status(400).json({ message: 'A question with this exact text already exists in this exam.' }); return;
  }

  const { data: createdQuestion, error: qError } = await supabase.from('questions').insert({
    exam_id: examId,
    text,
    options: options || [],
    correct_option_index: correctOptionIndex ? Number(correctOptionIndex) : 0,
    acceptable_answers: acceptableAnswers || [],
    category,
    section,
    translations,
    type,
    media_url: mediaUrl,
    text_hindi: textHindi,
    options_hindi: optionsHindi,
    marks: marks || 1
  }).select().single();

  if (qError) {
    res.status(500).json({ message: qError.message }); return;
  }

  res.status(201).json({ ...createdQuestion, _id: createdQuestion.id }); return;
};

// @desc    Import questions via AI (PDF/Docx text content extraction)
// @route   POST /api/exams/:examId/questions/import
// @access  Private/Examiner/Admin
export const importQuestions = async (req: AuthRequest, res: Response): Promise<void> => {
  const { examId } = req.params;
  const file = req.file;

  if (!file) {
    res.status(400).json({ message: 'No file uploaded' }); return;
  }

  const { data: exam } = await supabase.from('exams').select('creator_id').eq('id', examId).single();
  if (!exam) {
    res.status(404).json({ message: 'Exam not found' }); return;
  }
  if (req.user.role !== 'Admin' && exam.creator_id !== req.user._id) {
    res.status(403).json({ message: 'Not authorized to add questions to this exam' }); return;
  }

  try {
    let fileContent = '';
    const mimeType = file.mimetype;
    const originalName = file.originalname.toLowerCase();

    let contentsPayload: any = [];
    const basePrompt = `Extract the multiple choice questions from the following text/image and format them as a JSON object containing a "questions" array.
CRITICAL INSTRUCTIONS: 
1. If the provided document contains the correct answers, ensure the "correctOptionIndex" strictly matches the answer key.
2. If you absolutely cannot find any questions or readable text in the file, return a JSON object with a single key "error" explaining why.
3. Otherwise, return a JSON object with a single key "questions" containing an array of objects, where each object has:
- "text": The question text in strictly ENGLISH. (Translate it to English if the original document is in another language).
- "options": An array of 4 string options in strictly ENGLISH. (Translate to English if necessary).
- "textHindi": The exact HINDI translation of the question text. (Translate to Hindi if the original document is in another language).
- "optionsHindi": An array of 4 string options in strictly HINDI. (Translate to Hindi if necessary).
- "correctOptionIndex": The 0-based index of the correct option (must match for both languages).
- "category": A guessed category based on the question (e.g. "Scouting", "First Aid", "Knots").

IMPORTANT HINDI ENCODING RULE: If the original Hindi text looks like gibberish or uses legacy font encoding, DO NOT return the broken text! Instead, completely ignore the broken Hindi and accurately translate the English question back to standard Unicode Hindi.
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
        fileContent = file.buffer.toString('utf-8');
      }
      
      if (!fileContent || fileContent.trim() === '') {
        res.status(400).json({ message: 'Could not extract text from the file.' }); return;
      }
      contentsPayload = `${fileContent}`;
    }

    if (!process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY_2 && !process.env.OPENAI_API_KEY && !process.env.GROQ_API_KEY) {
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
        const { data: savedQ } = await supabase.from('questions').insert({
          exam_id: examId,
          text: q.text,
          options: q.options,
          correct_option_index: q.correctOptionIndex,
          category: q.category,
          marks: 1
        }).select().single();
        createdQuestions.push(savedQ);
      }
      res.status(201).json({ message: 'Questions imported successfully (Mock data used since no AI keys are missing)', count: createdQuestions.length }); return;
    }

    let allParsedQuestions: any[] = [];

    try {
      if (mimeType.startsWith('image/')) {
        const aiText = await generateAIContent({
          systemPrompt: basePrompt,
          userPrompt: 'Extract questions from this image.',
          image: {
            base64: file.buffer.toString('base64'),
            mimeType: mimeType
          },
          jsonMode: true
        });
        
        const jsonMatch = aiText?.match(/```(?:json)?([\s\S]*?)```/) || [null, aiText];
        const jsonString = jsonMatch[1]?.trim() || '[]';
        const parsed = JSON.parse(jsonString);
        const questionArray = parsed.questions || parsed;
        if (Array.isArray(questionArray)) {
          allParsedQuestions.push(...questionArray);
        }
      } else {
        let chunks = [];
        let currentChunk = '';
        const MAX_LENGTH = 3500; 
        
        const lines = fileContent.split('\n');
        for (const line of lines) {
          if (currentChunk.length + line.length > MAX_LENGTH) {
            chunks.push(currentChunk);
            currentChunk = line + '\n';
          } else {
            currentChunk += line + '\n';
          }
        }
        if (currentChunk.trim()) chunks.push(currentChunk);

        for (const chunk of chunks) {
          if (!chunk.trim()) continue;
          const aiText = await generateAIContent({
            systemPrompt: basePrompt,
            userPrompt: `Text to parse:\n${chunk}`,
            jsonMode: true
          });
          
          const jsonMatch = aiText?.match(/```(?:json)?([\s\S]*?)```/) || [null, aiText];
          const jsonString = jsonMatch[1]?.trim() || '[]';
          try {
            const parsed = JSON.parse(jsonString);
            const questionArray = parsed.questions || parsed;
            if (Array.isArray(questionArray)) {
              allParsedQuestions.push(...questionArray);
            }
          } catch(e) {
            console.error('Failed to parse chunk JSON, skipping chunk.');
          }
        }
      }
    } catch (err: any) {
      console.error('AI Generation Error:', err);
      res.status(500).json({ message: 'AI failed to process the document: ' + err.message }); return;
    }
    
    if (allParsedQuestions.length === 0) {
      res.status(500).json({ message: 'AI did not return a valid list of questions. The document might be unreadable.' }); return;
    }

    const createdQuestions = [];
    let duplicatesSkipped = 0;

    for (const q of allParsedQuestions) {
      const { data: existing } = await supabase.from('questions').select('id').eq('exam_id', examId).eq('text', q.text).maybeSingle();
      if (existing) {
        duplicatesSkipped++;
        continue;
      }

      const { data: savedQ } = await supabase.from('questions').insert({
        exam_id: examId,
        text: q.text,
        options: q.options,
        text_hindi: q.textHindi,
        options_hindi: q.optionsHindi,
        correct_option_index: q.correctOptionIndex,
        category: q.category,
        marks: 1
      }).select().single();
      createdQuestions.push(savedQ);
    }

    let msg = `Successfully imported ${createdQuestions.length} questions.`;
    if (duplicatesSkipped > 0) {
      msg += ` Skipped ${duplicatesSkipped} duplicates.`;
    }

    res.status(201).json({ 
      message: msg, 
      count: createdQuestions.length,
      duplicatesSkipped
    });
  } catch (error: any) {
    console.error('Error importing questions:', error);
    res.status(500).json({ message: 'Error parsing questions with AI: ' + (error?.message || error) }); return;
  }
};


// @desc    Edit a question
// @route   PUT /api/exams/:examId/questions/:questionId
// @access  Private/Examiner/Admin
export const editQuestion = async (req: AuthRequest, res: Response): Promise<void> => {
  const { examId, questionId } = req.params;
  let { text, options, correctOptionIndex, category, section, translations, type, acceptableAnswers } = req.body;
  let mediaUrl = req.body.mediaUrl;

  const { data: exam } = await supabase.from('exams').select('creator_id').eq('id', examId).single();
  if (!exam) {
    res.status(404).json({ message: 'Exam not found' }); return;
  }

  if (req.user.role !== 'Admin' && exam.creator_id !== req.user._id) {
    res.status(403).json({ message: 'Not authorized' }); return;
  }

  const { data: question } = await supabase.from('questions').select('*').eq('id', questionId).single();
  if (!question) {
    res.status(404).json({ message: 'Question not found' }); return;
  }

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
  if (typeof req.body.optionsHindi === 'string') req.body.optionsHindi = JSON.parse(req.body.optionsHindi);

  const updates: any = {};
  if (text) updates.text = text;
  if (options) updates.options = options;
  
  let oldCorrectIndex = question.correct_option_index;
  let triggeredReevaluation = false;
  if (correctOptionIndex !== undefined) {
    const newCorrectIndex = Number(correctOptionIndex);
    if (newCorrectIndex !== oldCorrectIndex) {
      triggeredReevaluation = true;
    }
    updates.correct_option_index = newCorrectIndex;
  }
  
  if (acceptableAnswers) updates.acceptable_answers = acceptableAnswers;
  if (category) updates.category = category;
  if (req.body.textHindi !== undefined) updates.text_hindi = req.body.textHindi;
  if (req.body.optionsHindi !== undefined) updates.options_hindi = req.body.optionsHindi;
  if (type) updates.type = type;
  if (mediaUrl !== undefined) updates.media_url = mediaUrl;

  const { data: updatedQuestion, error } = await supabase.from('questions').update(updates).eq('id', questionId).select().single();
  if (error) {
     res.status(500).json({ message: error.message }); return;
  }
  
  if (triggeredReevaluation) {
    // Dynamic Re-evaluation Logic
    const { data: submittedAttempts } = await supabase.from('exam_attempts').select('*').eq('exam_id', examId).in('status', ['Submitted', 'Auto-Submitted']);
    const { data: allQuestions } = await supabase.from('questions').select('*').eq('exam_id', examId);
    
    if (allQuestions && submittedAttempts && submittedAttempts.length > 0) {
      for (const attempt of submittedAttempts) {
        let score = 0;
        let totalMarks = 0;
        
        attempt.answers.forEach((ans: any) => {
          const examQuestion = allQuestions.find(q => q.id === ans.questionId);
          if (examQuestion) {
            totalMarks += (examQuestion.marks || 1);
            if (ans.selectedOptionIndex !== undefined && ans.selectedOptionIndex !== null && ans.selectedOptionIndex === examQuestion.correct_option_index) {
              score += (examQuestion.marks || 1);
            }
          }
        });
        
        await supabase.from('results').update({ score, total_marks: totalMarks }).eq('attempt_id', attempt.id);
      }
    }
  }

  res.status(200).json({ ...updatedQuestion, _id: updatedQuestion.id }); return;
};

// @desc    Delete all questions for an exam
// @route   DELETE /api/exams/:examId/questions/all
// @access  Private/Examiner/Admin
export const deleteAllQuestions = async (req: AuthRequest, res: Response): Promise<void> => {
  const { examId } = req.params;

  const { data: exam } = await supabase.from('exams').select('creator_id').eq('id', examId).single();
  if (!exam) {
    res.status(404).json({ message: 'Exam not found' }); return;
  }

  if (req.user.role !== 'Admin' && exam.creator_id !== req.user._id) {
    res.status(403).json({ message: 'Not authorized' }); return;
  }
  
  const { data: activeAttempts } = await supabase.from('exam_attempts').select('id').eq('exam_id', examId).eq('status', 'In-Progress').limit(1);
  if (activeAttempts && activeAttempts.length > 0) {
    res.status(400).json({ message: 'Cannot delete questions while candidates are currently taking the exam.' }); return;
  }

  await supabase.from('questions').delete().eq('exam_id', examId);

  res.status(200).json({ message: 'All questions deleted successfully' }); return;
};

// @desc    Delete a question
// @route   DELETE /api/exams/:examId/questions/:questionId
// @access  Private/Examiner/Admin
export const deleteQuestion = async (req: AuthRequest, res: Response): Promise<void> => {
  const { examId, questionId } = req.params;

  const { data: exam } = await supabase.from('exams').select('creator_id').eq('id', examId).single();
  if (!exam) {
    res.status(404).json({ message: 'Exam not found' }); return;
  }

  if (req.user.role !== 'Admin' && exam.creator_id !== req.user._id) {
    res.status(403).json({ message: 'Not authorized' }); return;
  }
  
  const { data: activeAttempts } = await supabase.from('exam_attempts').select('id').eq('exam_id', examId).eq('status', 'In-Progress').limit(1);
  if (activeAttempts && activeAttempts.length > 0) {
    res.status(400).json({ message: 'Cannot delete questions while candidates are currently taking the exam.' }); return;
  }

  await supabase.from('questions').delete().eq('id', questionId);

  res.status(200).json({ message: 'Question removed successfully' }); return;
};

// @desc    Auto translate text
// @route   POST /api/exams/translate
// @access  Private/Examiner/Admin
export const autoTranslate = async (req: AuthRequest, res: Response): Promise<void> => {
  const { text, targetLanguage = 'Hindi' } = req.body;
  if (!text) {
    res.status(400).json({ message: 'No text provided' }); return;
  }
  
  if (!process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY_2 && !process.env.OPENAI_API_KEY && !process.env.GROQ_API_KEY) {
    res.status(200).json({ translatedText: text + ` (Translation API missing)` }); return;
  }
  
  try {
    const aiText = await generateAIContent({
      userPrompt: `Translate the following text to ${targetLanguage}. Only return the translated ${targetLanguage} text without any formatting, quotes, or markdown. Text to translate:\n\n${text}`
    });
    res.status(200).json({ translatedText: aiText?.trim() }); return;
  } catch (error: any) {
    res.status(500).json({ message: 'Translation failed: ' + (error?.message || error) }); return;
  }
};
