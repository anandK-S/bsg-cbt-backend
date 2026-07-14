import mongoose, { Schema, Document } from 'mongoose';

export interface IExam extends Document {
  title: string;
  description: string;
  creatorId: mongoose.Types.ObjectId;
  durationMinutes: number;
  startTime?: Date;
  endTime?: Date;
  status: 'Draft' | 'Published' | 'Archived';
  questions: { questionId: mongoose.Types.ObjectId; marks: number }[];
}

const examSchema: Schema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String },
    creatorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    durationMinutes: { type: Number, required: true },
    startTime: { type: Date },
    endTime: { type: Date },
    status: { type: String, enum: ['Draft', 'Published', 'Archived'], default: 'Draft' },
    questions: [
      {
        questionId: { type: Schema.Types.ObjectId, ref: 'Question' },
        marks: { type: Number, default: 1 },
      },
    ],
  },
  { timestamps: true }
);

const Exam = mongoose.model<IExam>('Exam', examSchema);
export default Exam;
