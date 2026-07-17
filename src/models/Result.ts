import mongoose, { Schema, Document } from 'mongoose';

export interface IResult extends Document {
  attemptId: mongoose.Types.ObjectId;
  candidateId: mongoose.Types.ObjectId;
  examId: mongoose.Types.ObjectId;
  score: number;
  totalMarks: number;
  aiFeedback?: string;
  violationReason?: string;
  timeTakenSeconds?: number;
  submittedAt: Date;
}

const resultSchema: Schema = new Schema(
  {
    attemptId: { type: Schema.Types.ObjectId, ref: 'ExamAttempt', required: true },
    candidateId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    examId: { type: Schema.Types.ObjectId, ref: 'Exam', required: true },
    score: { type: Number, required: true },
    totalMarks: { type: Number, required: true },
    aiFeedback: { type: String },
    violationReason: { type: String },
    timeTakenSeconds: { type: Number },
    submittedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const Result = mongoose.model<IResult>('Result', resultSchema);
export default Result;
