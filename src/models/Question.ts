import mongoose, { Schema, Document } from 'mongoose';

export interface IQuestion extends Document {
  examId: mongoose.Types.ObjectId;
  text: string;
  options: string[];
  correctOptionIndex?: number;
  acceptableAnswers?: string[];
  type?: 'SingleChoice' | 'MultipleChoice' | 'Subjective';
  marks?: number;
  mediaUrl?: string;
  category?: string;
  textHindi?: string;
  optionsHindi?: string[];
}

const questionSchema: Schema = new Schema(
  {
    examId: { type: Schema.Types.ObjectId, ref: 'Exam', required: true },
    text: { type: String, required: true },
    options: [{ type: String }],
    correctOptionIndex: { type: Number },
    acceptableAnswers: [{ type: String }],
    type: { type: String, enum: ['SingleChoice', 'MultipleChoice', 'Subjective'], default: 'SingleChoice' },
    marks: { type: Number, default: 1 },
    mediaUrl: { type: String },
    textHindi: { type: String },
    optionsHindi: [{ type: String }],
    category: { type: String },
  },
  { timestamps: true }
);

const Question = mongoose.model<IQuestion>('Question', questionSchema);
export default Question;
