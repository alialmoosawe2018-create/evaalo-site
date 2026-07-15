import mongoose, { Document, Schema } from 'mongoose';
import type { CampaignCompareStage } from '../services/campaignCompareCallbackAuth.js';

export type CampaignCompareStatus =
    | 'pending'
    | 'dispatched'
    | 'processing'
    | 'completed'
    | 'failed'
    | 'refunded';

export type CompareUiStage = 'screening' | 'voice' | 'video';

export interface CandidateRankingItem {
    rank: number;
    candidateId: string;
    candidateName: string;
    stageScore: string | number;
    competitiveAdvantage: string;
    recommendation?: 'Hire' | 'Consider' | 'Reject';
    // ── Decision-support enrichment (Phase 1) — كلها اختيارية للتوافق الرجعي ──
    /** تسمية توصية حرّة قصيرة (مثل «Strong Hire») — منفصلة عن recommendation enum. */
    overallRecommendation?: string;
    /** تعليق تنفيذي بجملة واحدة. */
    executiveComment?: string;
    /** ثقة الترتيب 0–100 (تعكس التباعد عن باقي المرشحين). */
    confidence?: number;
    /** تفسير الثقة — معنى الرقم (مثل "High Confidence — تفوقه واضح"). */
    confidence_rationale?: string;
    /** أسباب الترتيب (Why Ranked). */
    reasons?: string[];
    /** نقاط القوة. */
    strengths?: string[];
    /** المخاطر (سلبيات حقيقية تؤثر على القرار). */
    risks?: string[];
    /** نقطة انتباه استشارية (ليست خطراً — شيء يُراقَب عند التوظيف، مثل onboarding). */
    watchOut?: string;
    /** الفرق عن المرشح التالي في الترتيب. */
    differenceFromNext?: string;
}

export interface CampaignCompareResult {
    comparativeSummary: string;
    candidateRanking: CandidateRankingItem[];
    topRecommendation: string;
    interviewFocus: string;
    /** الخاتمة التنفيذية الحاسمة على مستوى التقرير كله (Phase 1) — اختياري. */
    decisionSummary?: string;
    // ── Phase 1.5: حقول تحليلية لسرد احترافي ──
    /** السياق الافتتاحي: فقرة تعريف السيناريو والمقارنة. */
    contextualIntroduction?: string;
    /** مقارنة هيكلية عبر أبعاد متعددة (قيادة، توافق، تواصل، إلخ). */
    comparativeInsights?: Record<string, string>;
    /** شرح لماذا الأول أفضل من الثاني (رغم قوة الثاني). */
    whyTopCandidateWins?: string;
    /** التوصية النهائية الحازمة (مع احتياطي + من لا نوصي به). */
    finalRecommendation?: string;
    wildcard?: {
        candidateId: string;
        candidateName: string;
        reason: string;
    } | null;
}

export interface ICampaignCompareRequest extends Document {
    requestId: string;
    compareStage: CampaignCompareStage;
    uiStage: CompareUiStage;
    campaignId: string;
    organizationId: string;
    requestedBy: string;
    candidateIds: string[];
    candidateSnapshotHash: string;
    criteria: Record<string, unknown>;
    topN: number;
    status: CampaignCompareStatus;
    failureCode?: string;
    failureMessage?: string;
    result?: CampaignCompareResult;
    dispatchedAt?: Date;
    completedAt?: Date;
    expiresAt: Date;
    emails?: string[];
    chargedMicroCredits?: number;
    chargeIdempotencyKey?: string;
    refundIdempotencyKey?: string;
    deadlineAt?: Date;
    refundedAt?: Date;
    emailDispatchedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const TTL_DAYS = 30;
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;

const CandidateRankingItemSchema = new Schema(
    {
        rank: { type: Number, required: true },
        candidateId: { type: String, required: true },
        candidateName: { type: String, required: true },
        stageScore: { type: Schema.Types.Mixed, required: true },
        competitiveAdvantage: { type: String, required: true },
        recommendation: { type: String, enum: ['Hire', 'Consider', 'Reject'] },
        // Decision-support enrichment (Phase 1) — اختيارية.
        overallRecommendation: { type: String },
        executiveComment: { type: String },
        confidence: { type: Number, min: 0, max: 100 },
        confidence_rationale: { type: String },
        reasons: { type: [String], default: undefined },
        strengths: { type: [String], default: undefined },
        risks: { type: [String], default: undefined },
        watchOut: { type: String },
        differenceFromNext: { type: String },
    },
    { _id: false }
);

const CampaignCompareResultSchema = new Schema(
    {
        comparativeSummary: { type: String, required: true },
        candidateRanking: { type: [CandidateRankingItemSchema], required: true },
        topRecommendation: { type: String, required: true },
        interviewFocus: { type: String, required: true },
        decisionSummary: { type: String },
        // Phase 1.5: حقول تحليلية
        contextualIntroduction: { type: String },
        comparativeInsights: { type: Schema.Types.Mixed }, // Record<string, string>
        whyTopCandidateWins: { type: String },
        finalRecommendation: { type: String },
        wildcard: {
            type: new Schema(
                {
                    candidateId: String,
                    candidateName: String,
                    reason: String,
                },
                { _id: false }
            ),
            default: null,
        },
    },
    { _id: false }
);

const CampaignCompareRequestSchema = new Schema<ICampaignCompareRequest>(
    {
        requestId: { type: String, required: true, unique: true, index: true, trim: true },
        compareStage: {
            type: String,
            required: true,
            enum: ['stage1', 'stage2', 'stage3'],
            index: true,
        },
        uiStage: {
            type: String,
            required: true,
            enum: ['screening', 'voice', 'video'],
            index: true,
        },
        campaignId: { type: String, required: true, index: true, trim: true },
        organizationId: { type: String, required: true, index: true, trim: true },
        requestedBy: { type: String, required: true, index: true, trim: true },
        candidateIds: { type: [String], required: true },
        candidateSnapshotHash: { type: String, required: true, trim: true },
        criteria: { type: Schema.Types.Mixed, required: true, default: {} },
        topN: { type: Number, required: true, min: 1, max: 10 },
        status: {
            type: String,
            required: true,
            enum: ['pending', 'dispatched', 'processing', 'completed', 'failed', 'refunded'],
            default: 'pending',
            index: true,
        },
        failureCode: { type: String, trim: true },
        failureMessage: { type: String, trim: true },
        result: { type: CampaignCompareResultSchema, default: undefined },
        dispatchedAt: { type: Date },
        completedAt: { type: Date },
        expiresAt: {
            type: Date,
            required: true,
            default: () => new Date(Date.now() + TTL_MS),
        },
        emails: { type: [String], default: undefined },
        chargedMicroCredits: { type: Number, default: undefined },
        chargeIdempotencyKey: { type: String, trim: true },
        refundIdempotencyKey: { type: String, trim: true },
        deadlineAt: { type: Date },
        refundedAt: { type: Date },
        emailDispatchedAt: { type: Date },
    },
    {
        timestamps: true,
        collection: 'campaign_compare_requests',
    }
);

CampaignCompareRequestSchema.index({ campaignId: 1, compareStage: 1, createdAt: -1 });
CampaignCompareRequestSchema.index({ organizationId: 1, requestedBy: 1, createdAt: -1 });
CampaignCompareRequestSchema.index(
    { campaignId: 1, compareStage: 1, organizationId: 1, requestedBy: 1, createdAt: -1 }
);
CampaignCompareRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
CampaignCompareRequestSchema.index(
    { status: 1, deadlineAt: 1 },
    { partialFilterExpression: { status: { $in: ['pending', 'dispatched', 'processing'] } } }
);

export default mongoose.model<ICampaignCompareRequest>(
    'CampaignCompareRequest',
    CampaignCompareRequestSchema
);
