import mongoose, { Schema, Document } from 'mongoose';

export interface IAuditLog extends Document {
  userId: mongoose.Types.ObjectId;
  action: string;
  entityId?: mongoose.Types.ObjectId;
  details: string;
  timestamp: Date;
}

const auditLogSchema: Schema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId },
    details: { type: String },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const AuditLog = mongoose.model<IAuditLog>('AuditLog', auditLogSchema);
export default AuditLog;
