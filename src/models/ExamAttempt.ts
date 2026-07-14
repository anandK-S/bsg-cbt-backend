import mongoose, { Schema, Document } from 'mongoose';

export interface IExamAttempt extends Document {
  candidateId: mongoose.Types.ObjectId;
  examId: mongoose.Types.ObjectId;
  status: 'In-Progress' | 'Submitted' | 'Blocked' | 'Auto-Submitted';
  startTime: Date;
  endTime?: Date;
  answers: {
    questionId: mongoose.Types.ObjectId;
    selectedOptionIndex?: number;
    status: 'Answered' | 'MarkedForReview' | 'Unanswered';
  }[];
  timeRemaining: number;
  warnings: number;
}

const examAttemptSchema: Schema = new Schema(
  {
    candidateId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    examId: { type: Schema.Types.ObjectId, ref: 'Exam', required: true },
    status: {
      type: String,
      enum: ['In-Progress', 'Submitted', 'Blocked', 'Auto-Submitted'],
      default: 'In-Progress',
    },
    startTime: { type: Date, default: Date.now },
    endTime: { type: Date },
    answers: [
      {
        questionId: { type: Schema.Types.ObjectId, ref: 'Question', required: true },
        selectedOptionIndex: { type: Number },
        status: { type: String, enum: ['Answered', 'MarkedForReview', 'Unanswered'], default: 'Unanswered' },
      },
    ],
    timeRemaining: { type: Number, required: true },
    warnings: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const ExamAttempt = mongoose.model<IExamAttempt>('ExamAttempt', examAttemptSchema);
export default ExamAttempt;
