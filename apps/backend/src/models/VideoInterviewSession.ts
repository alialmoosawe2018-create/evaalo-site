// ============================================
// ملف: models/VideoInterviewSession.ts
// الوظيفة: Model لتخزين جلسات المقابلات المرئية
// ============================================

import mongoose, { Schema, Document } from 'mongoose';
import { DEFAULT_ORG_ID, SYSTEM_ACTOR_ID } from '../config/multiTenant.js';
import { tenantGuardPlugin } from './plugins/tenantGuard.js';

// Interface لرسالة في المحادثة
export interface IConversationMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

// Interface لجلسة المقابلة المرئية
// ملاحظة: organizationId/createdByClerkUserId مطلوبين على مستوى الـ schema (بـ defaults)
// لكن نُعلنهما optional في الـ interface لأن mongoose يحقنهما تلقائيًا عند الـ save،
// والكود الموجود الذي ينشئ mock sessions في الذاكرة لا يمررهما.
export interface IVideoInterviewSession extends Document {
    organizationId?: string;
    createdByClerkUserId?: string;
    sessionId: string;
    candidateId: mongoose.Types.ObjectId;
    campaignId?: string;
    /** applicationId العام (CandidateApplication) — لعزل قفل الرابط لكل تقديم */
    applicationId?: string;
    conversationHistory: IConversationMessage[];
    status: 'active' | 'completed' | 'cancelled';
    /** وضع المقابلة من الواجهة: فيديو، صوت، أو مشاركة شاشة */
    interviewMode?: 'video' | 'voice' | 'screen';
    /** لغة رابط المشاركة التي اختارها الموظف (ar/en/ku) — تُمرَّر لـ n8n لإخراج التقييم بنفس اللغة. */
    language?: string;
    /**
     * مصدر المرشح وقت بدء الجلسة (مثل `public_screening`) — يُلتقط من المرشح كي يعرف `/end`
     * أنّ هذا مسار عام دون إعادة تحميل المرشح.
     */
    sourceType?: string;
    /**
     * لقطة (Snapshot) لمعايير الحملة وقت بدء المقابلة — تُستخدم في حقن الوكيل وفي إرسال n8n.
     * تتجنّب سباق «HR يعدّل الحملة أثناء المقابلة» (الوكيل يستخدم A وn8n يستلم B).
     */
    jobCriteriaSnapshot?: Record<string, any>;
    /** نص ROLE CONTEXT المختصر الجاهز (يُرسل للوكيل عبر metadata ويُخزَّن للاتساق). */
    roleContextSnapshot?: string;
    /**
     * لقطة Blueprint الحملة وقت بدء المقابلة (إن وُجد blueprint مقفل) — لثبات المقابلة
     * لكل المرشحين ولاستخدامها في التقييم بالكفاءات لاحقاً، دون التأثّر بأي تغيير لاحق.
     */
    blueprintSnapshot?: {
        blueprintId?: string;
        profileId?: string;
        version?: number;
        blueprintContentVersion?: string;
        packVersion?: string;
        packMatchConfidence?: string;
        blueprintGeneratedAt?: string;
        language?: string;
        knowledgeDepth?: string;
        roleResolution?: {
            roleKey?: string | null;
            careerLevel?: string;
            managementTrack?: string;
            matchSource?: string;
            confidence?: number;
            labelKey?: string;
        };
        anchorQuestions?: string[];
        competencies?: Array<Record<string, any>>;
        domainPackKey?: string;
        specialization?: string;
        terminology?: string[];
        experienceTrackKeys?: string[];
        interviewPathKeys?: string[];
    };
    startedAt: Date;
    endedAt?: Date;
    // ── Video billing (V2) ────────────────────────────────────────────────
    /** Server-authoritative billing clock start (set when the room actually begins). */
    billingStartedAt?: Date;
    /** Server-authoritative real end time (agent end / candidate left / disconnect / forced). */
    billingEndedAt?: Date;
    /** Hard cap (seconds) computed and frozen at /start; enforced regardless of later changes. */
    maxAllowedVideoSeconds?: number;
    /** Remaining included video seconds available to the org at /start (snapshot). */
    includedVideoSecondsAtStart?: number;
    /** Remaining purchased video seconds available to the org at /start (snapshot). */
    purchasedVideoSecondsAtStart?: number;
    /** Billing lifecycle: active → settled, or active → forced_ended → settled. */
    billingStatus?: 'active' | 'forced_ended' | 'settled';
    /** Set once the evaluation-failure monitor has alerted for this session — prevents repeat alerts. */
    evaluationAlertSentAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

// Schema لجلسة المقابلة المرئية
const VideoInterviewSessionSchema = new Schema<IVideoInterviewSession>(
    {
        organizationId: {
            type: String,
            required: true,
            default: DEFAULT_ORG_ID,
            index: true,
            trim: true
        },
        createdByClerkUserId: {
            type: String,
            required: true,
            default: SYSTEM_ACTOR_ID,
            index: true,
            trim: true
        },
        sessionId: {
            type: String,
            required: true,
            unique: true,
            trim: true
        },
        candidateId: {
            type: Schema.Types.ObjectId,
            ref: 'Candidate',
            required: true,
            index: true
        },
        campaignId: {
            // نفس campaignId النصي المستخدم في RecruitmentCampaign/Candidate
            type: String,
            trim: true,
            index: true
        },
        applicationId: {
            type: String,
            trim: true,
            index: true
        },
        conversationHistory: [
            {
                role: {
                    type: String,
                    enum: ['user', 'assistant'],
                    required: true
                },
                content: {
                    type: String,
                    required: true,
                    trim: true
                },
                timestamp: {
                    type: Date,
                    default: Date.now,
                    required: true
                }
            }
        ],
        status: {
            type: String,
            enum: ['active', 'completed', 'cancelled'],
            default: 'active',
            index: true
        },
        interviewMode: {
            type: String,
            enum: ['video', 'voice', 'screen'],
            default: 'video',
            index: true
        },
        language: {
            type: String,
            trim: true,
            lowercase: true,
            default: undefined
        },
        sourceType: {
            type: String,
            trim: true,
            lowercase: true,
            index: true,
            default: undefined
        },
        jobCriteriaSnapshot: {
            type: Schema.Types.Mixed,
            default: undefined
        },
        roleContextSnapshot: {
            type: String,
            default: undefined
        },
        blueprintSnapshot: {
            type: Schema.Types.Mixed,
            default: undefined
        },
        startedAt: {
            type: Date,
            default: Date.now,
            required: true
        },
        endedAt: {
            type: Date
        },
        // ── Video billing (V2) ───────────────────────────────────────────
        billingStartedAt: { type: Date },
        billingEndedAt: { type: Date },
        maxAllowedVideoSeconds: { type: Number, min: 0 },
        includedVideoSecondsAtStart: { type: Number, min: 0 },
        purchasedVideoSecondsAtStart: { type: Number, min: 0 },
        billingStatus: {
            type: String,
            enum: ['active', 'forced_ended', 'settled'],
            index: true
        },
        evaluationAlertSentAt: { type: Date }
    },
    {
        timestamps: true, // يضيف createdAt و updatedAt تلقائياً
        collection: 'video_interview_sessions'
    }
);

// Indexes للأداء
VideoInterviewSessionSchema.index({ candidateId: 1, status: 1 });
VideoInterviewSessionSchema.index({ createdAt: -1 });
VideoInterviewSessionSchema.index({ startedAt: -1 });
VideoInterviewSessionSchema.index({ organizationId: 1, startedAt: -1 });
VideoInterviewSessionSchema.index({ organizationId: 1, candidateId: 1 });

// Method لإضافة رسالة للمحادثة
VideoInterviewSessionSchema.methods.addMessage = function(
    role: 'user' | 'assistant',
    content: string
): void {
    this.conversationHistory.push({
        role,
        content,
        timestamp: new Date()
    });
    this.updatedAt = new Date();
};

// Method لإنهاء الجلسة
VideoInterviewSessionSchema.methods.endSession = function(): void {
    this.status = 'completed';
    this.endedAt = new Date();
    this.updatedAt = new Date();
};

// Method لإلغاء الجلسة
VideoInterviewSessionSchema.methods.cancelSession = function(): void {
    this.status = 'cancelled';
    this.endedAt = new Date();
    this.updatedAt = new Date();
};

// Tenant-isolation guard. `sessionId` (unique) and `candidateId` (person-scoped)
// are safe single-tenant lookups used by the interview/billing flows.
VideoInterviewSessionSchema.plugin(tenantGuardPlugin, { safeKeys: ['sessionId', 'candidateId'] });

// Export Model
const VideoInterviewSession = mongoose.model<IVideoInterviewSession>(
    'VideoInterviewSession',
    VideoInterviewSessionSchema
);

export default VideoInterviewSession;

