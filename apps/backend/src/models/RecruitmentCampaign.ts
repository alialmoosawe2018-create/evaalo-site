import mongoose, { Document, Schema } from 'mongoose';
import { DEFAULT_ORG_ID, SYSTEM_ACTOR_ID } from '../config/multiTenant.js';
import { tenantGuardPlugin } from './plugins/tenantGuard.js';
import type { CampaignFormBinding, EvaluationRubricItem } from '../shared/formTemplates/index.js';

/** نتيجة مقارنة أفضل المرشحين لمرحلة واحدة (مستقلة عن باقي الـ webhooks). */
export interface IAiCompareTopResult {
    requestId: string;
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'expired' | 'refunded';
    emails: string[];
    requestedByClerkUserId?: string;
    requestedAt?: Date;
    completedAt?: Date;
    error?: string;
    // ── Credit charge / refund bookkeeping (V2) ──────────────────────────
    /** microCredits actually charged at request time (refund uses THIS value). */
    chargedMicroCredits?: number;
    /** Idempotency key used for the upfront charge. */
    chargeIdempotencyKey?: string;
    /** Idempotency key used for the refund (prevents double refund). */
    refundIdempotencyKey?: string;
    /** Deadline after which a still-unfinished request is refunded by the sweep. */
    deadlineAt?: Date;
    /** When the charge was refunded (terminal). */
    refundedAt?: Date;
    // المخرجات من n8n
    summary?: string;
    /** الخاتمة التنفيذية الحاسمة على مستوى التقرير (Phase 1) — تُعرض أعلى الصفحة/الإيميل. */
    decisionSummary?: string;
    // Phase 1.5: حقول تحليلية لسرد احترافي
    /** السياق الافتتاحي: فقرة تعريف السيناريو والمقارنة. */
    contextualIntroduction?: string;
    /** مقارنة هيكلية عبر أبعاد متعددة. */
    comparativeInsights?: Record<string, string>;
    /** شرح لماذا الأول أفضل من الثاني. */
    whyTopCandidateWins?: string;
    /** التوصية النهائية الحازمة. */
    finalRecommendation?: string;
    ranking?: Array<{
        rank?: number;
        /**
         * The person this row is about. The v2 record has always carried it, but
         * the UI adapter dropped it — so nothing downstream could join a row back
         * to the candidate. The emailed report needs exactly that, to put a face
         * on the card.
         */
        candidateId?: string;
        candidateName?: string;
        candidateEmail?: string;
        score?: number;
        strengths?: string;
        weaknesses?: string;
        reason?: string;
        // Decision-support enrichment (Phase 1) — اختيارية.
        recommendation?: 'Hire' | 'Consider' | 'Reject';
        overallRecommendation?: string;
        executiveComment?: string;
        confidence?: number;
        confidence_rationale?: string;
        reasons?: string[];
        strengthsList?: string[];
        risks?: string[];
        watchOut?: string;
        differenceFromNext?: string;
        decisionAction?: string;
        decisionReason?: string;
        keyDecisionFactor?: string;
        decisionOptions?: Array<{ action: string; when?: string; benefit?: string }>;
        decisionDependencies?: string[];
        dataQuality?: 'High' | 'Medium' | 'Low';
        keyGaps?: string[];
    }>;
    decisionOptions?: Array<{ action: string; when?: string; benefit?: string }>;
    decisionDependencies?: string[];
    decisionConfidence?: 'High' | 'Medium' | 'Low';
    raw?: any;
}

export interface IRecruitmentCampaign extends Document {
    // organizationId/createdByClerkUserId مطلوبين على مستوى الـ schema (بـ defaults).
    // optional هنا لتسهيل التوافق مع mock paths والكود القديم.
    organizationId?: string;
    createdByClerkUserId?: string;
    campaignId: string; // معرف فريد للحملة
    // حالة الحملة: active = تستقبل الطلبات، closed = أُغلق استلام الطلبات
    status?: 'active' | 'closed';
    closedAt?: Date | null;
    // معايير ديناميكية - يمكن إضافة أي معيار
    criteria: {
        [key: string]: any; // position, location, job, company, age, gender, educationLevel, etc.
    };
    jobAdvertisement?: string; // إعلان الوظيفة المُولَّد تلقائياً
    interviewType?: string; // process, video, audio
    templateType?: string;
    templateName?: string;
    /** Public token for candidate application links (non-guessable). */
    publicApplicationToken?: string;
    /** Immutable form schema snapshot for screening campaigns. */
    formBinding?: CampaignFormBinding;
    /** Structured AI evaluation rubric (employer-only, not shown to candidates). */
    evaluationRubric?: EvaluationRubricItem[];
    rubricVersion?: number;
    rubricSnapshotHash?: string;
    /** Set when first candidate applies — locks formBinding/rubric edits. */
    firstCandidateAt?: Date | null;
    /** Optional deadline for accepting applications. */
    applicationsCloseAt?: Date | null;
    // نتائج مقارنة أفضل المرشحين — منفصلة لكل مرحلة (مستقلة عن باقي الـ webhooks)
    aiCompareTopResult?: IAiCompareTopResult; // Stage 1 (screening)
    voiceAiCompareTopResult?: IAiCompareTopResult; // Stage 2 (voice)
    videoAiCompareTopResult?: IAiCompareTopResult; // Stage 3 (video)
    createdAt: Date;
    updatedAt: Date;
}

/** Sub-schema مُعاد الاستخدام لنتيجة المقارنة (لكل مرحلة). */
const AiCompareResultSchema = new Schema(
    {
        requestId: { type: String, required: true },
        status: {
            type: String,
            enum: ['pending', 'processing', 'completed', 'failed', 'expired', 'refunded'],
            default: 'pending',
        },
        emails: { type: [String], default: [] },
        requestedByClerkUserId: { type: String },
        requestedAt: { type: Date },
        completedAt: { type: Date },
        error: { type: String },
        // Credit charge / refund bookkeeping (V2).
        chargedMicroCredits: { type: Number, min: 0 },
        chargeIdempotencyKey: { type: String },
        refundIdempotencyKey: { type: String },
        deadlineAt: { type: Date },
        refundedAt: { type: Date },
        summary: { type: String },
        decisionSummary: { type: String },
        // Phase 1.5: حقول تحليلية
        contextualIntroduction: { type: String },
        comparativeInsights: { type: Schema.Types.Mixed },
        whyTopCandidateWins: { type: String },
        finalRecommendation: { type: String },
        decisionOptions: { type: Schema.Types.Mixed },
        decisionDependencies: { type: [String], default: undefined },
        decisionConfidence: { type: String, enum: ['High', 'Medium', 'Low'] },
        ranking: {
            type: [
                new Schema(
                    {
                        rank: { type: Number },
                        candidateId: { type: String },
                        candidateName: { type: String },
                        candidateEmail: { type: String },
                        score: { type: Number },
                        strengths: { type: String },
                        weaknesses: { type: String },
                        reason: { type: String },
                        // Decision-support enrichment (Phase 1) — اختيارية.
                        recommendation: { type: String, enum: ['Hire', 'Consider', 'Reject'] },
                        overallRecommendation: { type: String },
                        executiveComment: { type: String },
                        confidence: { type: Number, min: 0, max: 100 },
                        confidence_rationale: { type: String },
                        reasons: { type: [String], default: undefined },
                        strengthsList: { type: [String], default: undefined },
                        risks: { type: [String], default: undefined },
                        watchOut: { type: String },
                        differenceFromNext: { type: String },
                        decisionAction: { type: String },
                        decisionReason: { type: String },
                        keyDecisionFactor: { type: String },
                        decisionOptions: { type: Schema.Types.Mixed },
                        decisionDependencies: { type: [String], default: undefined },
                        dataQuality: { type: String, enum: ['High', 'Medium', 'Low'] },
                        keyGaps: { type: [String], default: undefined },
                    },
                    { _id: false }
                ),
            ],
            default: undefined,
        },
        raw: { type: Schema.Types.Mixed },
    },
    { _id: false }
);

const RecruitmentCampaignSchema = new Schema<IRecruitmentCampaign>({
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
    campaignId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    status: {
        type: String,
        enum: ['active', 'closed'],
        default: 'active',
        index: true
    },
    closedAt: {
        type: Date,
        required: false,
        default: null
    },
    // معايير ديناميكية - جميع المعايير المختارة من قبل الأدمن
    criteria: {
        type: Schema.Types.Mixed,
        required: true,
        default: {}
    },
    jobAdvertisement: {
        type: String,
        required: false
    },
    interviewType: {
        type: String,
        required: false
    },
    templateType: {
        type: String,
        required: false
    },
    templateName: {
        type: String,
        required: false
    },
    publicApplicationToken: {
        type: String,
        required: false,
        unique: true,
        sparse: true,
        index: true,
        trim: true,
    },
    formBinding: {
        type: Schema.Types.Mixed,
        required: false,
    },
    evaluationRubric: {
        type: [Schema.Types.Mixed],
        required: false,
        default: undefined,
    },
    rubricVersion: {
        type: Number,
        required: false,
        default: 1,
    },
    rubricSnapshotHash: {
        type: String,
        required: false,
        trim: true,
    },
    firstCandidateAt: {
        type: Date,
        required: false,
        default: null,
    },
    applicationsCloseAt: {
        type: Date,
        required: false,
        default: null,
    },
    aiCompareTopResult: {
        type: AiCompareResultSchema,
        required: false,
        default: undefined,
    },
    voiceAiCompareTopResult: {
        type: AiCompareResultSchema,
        required: false,
        default: undefined,
    },
    videoAiCompareTopResult: {
        type: AiCompareResultSchema,
        required: false,
        default: undefined,
    }
}, {
    timestamps: true
});

RecruitmentCampaignSchema.index({ organizationId: 1, createdAt: -1 });

// Tenant-isolation guard. `campaignId` and `publicApplicationToken` are unique,
// non-guessable global keys — safe to resolve a single campaign without org.
RecruitmentCampaignSchema.plugin(tenantGuardPlugin, {
    safeKeys: ['campaignId', 'publicApplicationToken'],
});

export default mongoose.model<IRecruitmentCampaign>('RecruitmentCampaign', RecruitmentCampaignSchema);
