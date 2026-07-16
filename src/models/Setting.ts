import mongoose, { Document, Schema } from 'mongoose';

export interface ISetting extends Document {
  platformName: string;
  supportEmail: string;
  maintenanceMode: boolean;
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
  }
}, {
  timestamps: true
});

const Setting = mongoose.model<ISetting>('Setting', settingSchema);

export default Setting;
