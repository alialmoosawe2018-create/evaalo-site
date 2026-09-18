// ============================================
// ملف: models/HeadHunterSourcingContext.ts
// الوظيفة: لقطة (snapshot) خفيفة لسياق مصدر الهيد هانتر تُحفظ عند توليد رابط
// مقابلة فيديو لمرشح من نتائج البحث. تحمل بروفايل المرشح (LinkedIn) ومعايير البحث.
// تُستخدم لاحقاً لإثراء سجل المرشح وحقن role_context غني للوكيل عبر /prepare و/start.
//
// الرابط يحمل المعرّف كـ ?hh=<contextId>. TTL: 90 يوماً.
// ============================================

import mongoose, { Schema, Document } from 'mongoose';

/** مجموعة فرعية آمنة من HeadHunterCandidate (واجهة العرض) نخزّنها في اللقطة. */
export interface IHeadHunterCandidateProfile {
    full_name?: string;
    headline?: string;
    current_title?: string;
    current_company?: string;
    location?: string;
    years_experience?: number | string | null;
    skills?: string[];
    languages?: string[];
    summary?: string;
    ai_summary?: string;
    experience_timeline?: unknown[];
    education?: unknown[];
    linkedin_url?: string;
}

/** معايير البحث التي استُخدمت في الهيد هانتر. */
export interface IHeadHunterSearchCriteria {
    position?: string;
    location?: string;
    yearsExperience?: string;
    ageRange?: string;
    query?: string;
}

export interface IHeadHunterSourcingContext extends Document {
    contextId: string;
    candidateProfile?: IHeadHunterCandidateProfile;
    searchCriteria?: IHeadHunterSearchCriteria;
    campaignId?: string;
    position?: string;
    createdByClerkUserId?: string;
    organizationId?: string;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

const TTL_DAYS = 90;
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;

const HeadHunterSourcingContextSchema = new Schema<IHeadHunterSourcingContext>(
    {
        contextId: {
            type: String,
            required: true,
            unique: true,
            index: true,
            trim: true,
        },
        candidateProfile: {
            type: Schema.Types.Mixed,
            default: undefined,
        },
        searchCriteria: {
            type: Schema.Types.Mixed,
            default: undefined,
        },
        /**
         * The RecruitmentCampaign this invitation interviews for.
         *
         * Required at the route since 2026-09-18 (`/sourcing-context` refuses a
         * context without one), but NOT required here: the three contexts that
         * existed before the change carry none, and a schema-level `required`
         * would make them unreadable rather than merely legacy.
         */
        campaignId: {
            type: String,
            trim: true,
            default: undefined,
        },
        position: {
            type: String,
            trim: true,
            default: undefined,
        },
        createdByClerkUserId: {
            type: String,
            trim: true,
            default: undefined,
        },
        /**
         * The organization that minted this invitation.
         *
         * ⚠️ `required` with NO default, deliberately. This value is one half of
         * the cross-check in `assertSourcingContextMatchesCampaign`, which fails
         * closed when it is absent — so a default would not be a convenience, it
         * would be a way for an unattributable context to pass as attributable.
         * That is exactly how `Candidate.organizationId` acquired
         * `default: DEFAULT_ORG_ID`, a silent shared fallback.
         *
         * `required` validates writes only; the existing documents (3 in
         * production, 3 of 3 populated) are untouched, so there is no migration.
         */
        organizationId: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        expiresAt: {
            type: Date,
            required: true,
            default: () => new Date(Date.now() + TTL_MS),
        },
    },
    {
        timestamps: true,
        collection: 'head_hunter_sourcing_contexts',
    }
);

// TTL — Mongo يحذف السجلات التي تجاوزت expiresAt تلقائياً.
HeadHunterSourcingContextSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IHeadHunterSourcingContext>(
    'HeadHunterSourcingContext',
    HeadHunterSourcingContextSchema
);
