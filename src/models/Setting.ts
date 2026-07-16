import mongoose, { Document, Schema } from 'mongoose';

export interface ISetting extends Document {
  platformName: string;
  supportEmail: string;
  maintenanceMode: boolean;
  termsUrl?: string;
  privacyUrl?: string;
  maxFailedLoginAttempts: number;
  require2FA: boolean;
  strictBrowserLockdown: boolean;
  defaultProctoringLevel: 'None' | 'Webcam' | 'AI Live';
}

const settingSchema = new Schema<ISetting>({
  platformName: {
    type: String,
    required: true,
    default: 'BSG CBT Portal'
  },
  supportEmail: {
    type: String,
    required: true,
    default: 'support@bsg-india.org'
  },
  maintenanceMode: {
    type: Boolean,
    required: true,
    default: false
  },
  termsUrl: { type: String, default: '' },
  privacyUrl: { type: String, default: '' },
  maxFailedLoginAttempts: { type: Number, default: 5 },
  require2FA: { type: Boolean, default: false },
  strictBrowserLockdown: { type: Boolean, default: false },
  defaultProctoringLevel: { 
    type: String, 
    enum: ['None', 'Webcam', 'AI Live'], 
    default: 'None' 
  }
}, {
  timestamps: true
});

const Setting = mongoose.model<ISetting>('Setting', settingSchema);

export default Setting;
