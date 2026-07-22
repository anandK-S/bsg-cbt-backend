import { Request, Response } from 'express';
import Exam from '../models/Exam';
import Question from '../models/Question';
import { generateAIContent } from '../utils/aiService';

interface AuthRequest extends Request {
  user?: any;
}

export const auditExam = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { examId } = req.params;

    const exam = await Exam.findById(examId);
    if (!exam) {
      res.status(404).json({ message: 'Exam not found' });
      return;
    }

    if (req.user.role !== 'Admin' && exam.creatorId.toString() !== req.user._id.toString()) {
      res.status(403).json({ message: 'Not authorized to audit this exam' });
      return;
    }

    // Fetch questions associated with this exam
    const questions = await Question.find({ examId }).lean();

    // Prepare data payload for AI (minimize token usage by excluding heavy fields like mediaUrls if unnecessary)
    const examData = {
      title: exam.title,
      description: exam.description,
      category: exam.category,
      durationMinutes: exam.durationMinutes,
      status: exam.status,
      scheduledStartDate: exam.scheduledStartDate,
      allowMultipleAttempts: exam.allowMultipleAttempts,
      releaseResultsInstantly: exam.releaseResultsInstantly,
      issueCertificate: exam.issueCertificate,
      questions: questions.map(q => ({
        id: q._id.toString(),
        text: q.text,
        textHindi: q.textHindi,
        options: q.options,
        optionsHindi: q.optionsHindi,
        type: q.type
      }))
    };

    const systemPrompt = `You are Anand AI, a master exam auditor and assistant. You are reviewing an exam's configuration and its questions to ensure maximum quality.
    
CRITICAL INSTRUCTIONS:
1. Review the Exam's 'title', 'description', and 'category'. If they are poorly written, too short, or missing, provide better ones.
2. Review the Schedule: If 'scheduledStartDate' is within the next 24 hours (or past) but the status is 'Draft', recommend changing status to 'Published'.
3. Review every single Question:
   - Check if English 'text' or 'options' are missing, grammatically broken, or incomplete.
   - Check if Hindi 'textHindi' or 'optionsHindi' are missing, completely broken, or use legacy font gibberish.
   - Fix all missing or broken translations. Translate accurately between Hindi and English where necessary.
4. Return a STRICT JSON object in this exact format (do not include markdown codeblocks or any other text):
{
  "generalFeedback": "A professional 2-3 sentence summary of what you found and fixed.",
  "examUpdates": {
    "title": "Improved Title (or original if fine)",
    "description": "Improved Description (or original if fine)",
    "category": "Improved Category",
    "status": "Published" // Only include 'status' if you recommend publishing it due to schedule
  },
  "questionUpdates": [
    {
      "questionId": "The question's ID string",
      "text": "Fixed English Text",
      "textHindi": "Fixed Hindi Text",
      "options": ["Opt1", "Opt2", "Opt3", "Opt4"],
      "optionsHindi": ["विकल्प 1", "विकल्प 2", "विकल्प 3", "विकल्प 4"]
    }
  ]
}
IMPORTANT: Only include questions in 'questionUpdates' if they actually needed fixing. If a question is perfect, omit it from the array to save space.
`;

    const aiText = await generateAIContent({
      systemPrompt,
      userPrompt: `Audit this exam JSON data:\n${JSON.stringify(examData, null, 2)}`,
      jsonMode: true
    });

    const jsonMatch = aiText?.match(/```(?:json)?([\s\S]*?)```/) || [null, aiText];
    const jsonString = jsonMatch[1]?.trim() || '{}';
    
    let parsedAudit: any;
    try {
      parsedAudit = JSON.parse(jsonString);
    } catch (parseError) {
      console.error('Error parsing JSON from Anand AI response:', aiText);
      res.status(500).json({ message: 'Anand AI returned invalid formatting. Please try again.' });
      return;
    }

    res.status(200).json(parsedAudit);
  } catch (error: any) {
    console.error('Anand AI Audit Error:', error);
    res.status(500).json({ message: 'Anand AI encountered an error during audit.' });
  }
};

export const applyAuditFixes = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { examId } = req.params;
    const { examUpdates, questionUpdates } = req.body;

    const exam = await Exam.findById(examId);
    if (!exam) {
      res.status(404).json({ message: 'Exam not found' });
      return;
    }

    if (req.user.role !== 'Admin' && exam.creatorId.toString() !== req.user._id.toString()) {
      res.status(403).json({ message: 'Not authorized to modify this exam' });
      return;
    }

    // Apply exam updates
    if (examUpdates) {
      if (examUpdates.title) exam.title = examUpdates.title;
      if (examUpdates.description) exam.description = examUpdates.description;
      if (examUpdates.category) exam.category = examUpdates.category;
      if (examUpdates.status) exam.status = examUpdates.status;
      await exam.save();
    }

    // Apply question updates
    if (questionUpdates && Array.isArray(questionUpdates)) {
      for (const update of questionUpdates) {
        if (!update.questionId) continue;
        const q = await Question.findOne({ _id: update.questionId, examId });
        if (q) {
          if (update.text) q.text = update.text;
          if (update.textHindi) q.textHindi = update.textHindi;
          if (update.options && Array.isArray(update.options)) q.options = update.options;
          if (update.optionsHindi && Array.isArray(update.optionsHindi)) q.optionsHindi = update.optionsHindi;
          await q.save();
        }
      }
    }

    res.status(200).json({ message: 'All Anand AI fixes applied successfully!' });
  } catch (error: any) {
    console.error('Anand AI Apply Error:', error);
    res.status(500).json({ message: 'Failed to apply Anand AI fixes.' });
  }
};
