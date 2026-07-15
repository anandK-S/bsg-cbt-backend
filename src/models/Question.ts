import mongoose, { Schema, Document } from 'mongoose';

export interface IQuestion extends Document {
  examId: mongoose.Types.ObjectId;
  text: string;
  options: string[];
  correctOptionIndex: number;
  type?: 'SingleChoice' | 'MultipleChoice' | 'Subjective';
  marks?: number;
  mediaUrl?: string;
  translations?: {
    hi?: {
      text: string;
      options: string[];
    };
  };
  category?: string;
}

const questionSchema: Schema = new Schema(
  {
    examId: { type: Schema.Types.ObjectId, ref: 'Exam', required: true },
    text: { type: String, required: true },
    options: [{ type: String, required: true }],
    correctOptionIndex: { type: Number, required: true },
    type: { type: String, enum: ['SingleChoice', 'MultipleChoice', 'Subjective'], default: 'SingleChoice' },
    marks: { type: Number, default: 1 },
    mediaUrl: { type: String },
    translations: {
      hi: {
        text: { type: String },
        options: [{ type: String }],
      },
    },
    category: { type: String },
  },
  { timestamps: true }
);

const Question = mongoose.model<IQuestion>('Question', questionSchema);
export default Question;
