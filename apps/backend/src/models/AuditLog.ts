// ============================================
// ملف: models/AuditLog.ts
// الوظيفة: سجل أحداث (RBAC/ATS) — مطلوب لـ compliance + تتبع enterprise.
// ============================================

import mongoose, { Schema, Document } from 'mongoose';

export interface IAuditLog extends Document {
    organizationId: string;
    actorClerkUserId: string;
    actorEmail?: string;
    /** مثال: 'candidate.deleted', 'interview.created', 'role.updated'. */
    action: string;
    /** مثال: 'candidate', 'session', 'campaign', 'user'. */
    targetType: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
    ip?: string;
    userAgent?: string;
    createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
    {
        organizationId: { type: String, required: true, index: true },
        actorClerkUserId: { type: String, required: true, index: true },
        actorEmail: { type: String, trim: true },
        action: { type: String, required: true, index: true },
        targetType: { type: String, required: true, index: true },
        targetId: { type: String, index: true },
        metadata: { type: Schema.Types.Mixed },
        ip: { type: String },
        userAgent: { type: String },
    },
    {
        timestamps: { createdAt: true, updatedAt: false },
        collection: 'audit_logs',
    }
);

AuditLogSchema.index({ organizationId: 1, createdAt: -1 });
AuditLogSchema.index({ organizationId: 1, actorClerkUserId: 1, createdAt: -1 });
AuditLogSchema.index({ organizationId: 1, targetType: 1, targetId: 1, createdAt: -1 });

export default mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
