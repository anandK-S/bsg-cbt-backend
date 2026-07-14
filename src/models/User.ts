import mongoose, { Schema, Document } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IUser extends Document {
  name: string;
  email: string;
  passwordHash: string;
  role: 'Candidate' | 'Examiner' | 'Admin';
  bsgId?: string; // Optional for non-candidates
  profileImage?: string; // URL for profile picture
  status: 'Active' | 'Blocked';
  matchPassword(enteredPassword: string): Promise<boolean>;
}

const userSchema: Schema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['Candidate', 'Examiner', 'Admin'], default: 'Candidate' },
    bsgId: { type: String }, // e.g., Scout/Guide ID
    profileImage: { type: String },
    status: { type: String, enum: ['Active', 'Blocked'], default: 'Active' },
  },
  { timestamps: true }
);

userSchema.methods.matchPassword = async function (enteredPassword: string) {
  return await bcrypt.compare(enteredPassword, this.passwordHash);
};

// Pre-save hook to hash password
userSchema.pre('save', async function () {
  if (!this.isModified('passwordHash')) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.passwordHash = await bcrypt.hash(this.passwordHash as string, salt);
});

const User = mongoose.model<IUser>('User', userSchema);
export default User;
