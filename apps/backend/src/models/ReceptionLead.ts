// ============================================
// ملف: models/ReceptionLead.ts
// الوظيفة: تخزين بيانات زائري تجربة استقبال Evaalo (مفصولة عن جلسة LiveKit).
// النموذج يُستخدم في POST /api/reception-demo/start فقط، fire-and-forget،
// بحيث لا تُحقن بيانات النموذج داخل metadata الخاصة بـ AgentSession.
// ============================================

import mongoose, { Schema, Document } from 'mongoose';

export interface IReceptionLead extends Document {
    visitorId: string;
    sessionId?: string;
    firstName: string;
    lastName: string;
    email: string;
    company?: string;
    /** أول جلسة تم بدؤها لهذا الزائر (للأرشيف فقط — ليست مرتبطة بجلسة LiveKit حية) */
    startedAt: Date;
    /** تحديث آخر مرة عاد فيها نفس الزائر (نفس visitorId) */
    lastSeenAt: Date;
    /** عدد مرات بدء التجربة من نفس visitorId */
    attempts: number;
    /** بيانات بيئية اختيارية للتشخيص */
    userAgent?: string;
    locale?: string;
    createdAt: Date;
    updatedAt: Date;
}

const ReceptionLeadSchema = new Schema<IReceptionLead>(
    {
        visitorId: { type: String, required: true, trim: true, index: true, maxlength: 220 },
        sessionId: { type: String, trim: true, index: true, maxlength: 220 },
        firstName: { type: String, required: true, trim: true, maxlength: 80 },
        lastName: { type: String, required: true, trim: true, maxlength: 80 },
        email: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            maxlength: 160,
            index: true,
            // فلترة على مستوى Schema (validation API يفحص أيضاً)
            match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        },
        company: { type: String, trim: true, maxlength: 200 },
        startedAt: { type: Date, default: () => new Date() },
        lastSeenAt: { type: Date, default: () => new Date(), index: true },
        attempts: { type: Number, default: 1, min: 1 },
        userAgent: { type: String, trim: true, maxlength: 500 },
        locale: { type: String, trim: true, maxlength: 32 },
    },
    {
        timestamps: true,
        collection: 'reception_leads',
    }
);

// أي استعلام بحسب البريد + visitorId سيكون شائعاً (تتبع المستخدم نفسه عبر الجلسات)
ReceptionLeadSchema.index({ email: 1, visitorId: 1 });

const ReceptionLead =
    (mongoose.models.ReceptionLead as mongoose.Model<IReceptionLead>) ||
    mongoose.model<IReceptionLead>('ReceptionLead', ReceptionLeadSchema);

export default ReceptionLead;
