import mongoose, { Schema, Document } from 'mongoose';

export interface IExam extends Document {
  title: string;
  description: string;
  category?: string;
  creatorId: mongoose.Types.ObjectId;
  durationMinutes: number; // Deprecated, keeping for backwards compatibility
  durationSeconds?: number;
  durationUnit: 'sec' | 'min' | 'hour';
  passingMarks: number;
  scheduledStartDate?: Date;
  scheduledEndDate?: Date;
  startTime?: Date;
  endTime?: Date;
  status: 'Draft' | 'Published' | 'Archived';
  issueCertificate: boolean;
  allowMultipleAttempts: boolean;
  releaseResultsInstantly: boolean;
  testKey?: string;
  questions: { questionId: mongoose.Types.ObjectId; marks: number }[];
  createdAt?: Date;
  updatedAt?: Date;
}

const examSchema: Schema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String },
    category: { type: String },
    creatorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    durationMinutes: { type: Number, required: true, default: 0 },
    durationSeconds: { type: Number },
    durationUnit: { type: String, enum: ['sec', 'min', 'hour'], default: 'min' },
    passingMarks: { type: Number, default: 50 },
    scheduledStartDate: { type: Date },
    scheduledEndDate: { type: Date },
    startTime: { type: Date },
    endTime: { type: Date },
    status: { type: String, enum: ['Draft', 'Published', 'Archived'], default: 'Draft' },
    allowMultipleAttempts: { type: Boolean, default: false },
    issueCertificate: { type: Boolean, default: false },
    releaseResultsInstantly: { type: Boolean, default: false },
    testKey: { type: String },
    questions: [
      {
        questionId: { type: Schema.Types.ObjectId, ref: 'Question' },
        marks: { type: Number, default: 1 },
      },
    ],
  },
  { timestamps: true }
);

examSchema.index({ creatorId: 1 });
examSchema.index({ status: 1 });

const Exam = mongoose.model<IExam>('Exam', examSchema);
export default Exam;
