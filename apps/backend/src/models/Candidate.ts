import mongoose, { Schema, Document } from 'mongoose';
import { DEFAULT_ORG_ID, SYSTEM_ACTOR_ID } from '../config/multiTenant.js';
import type { CandidateEvaluationContext } from '../shared/formTemplates/index.js';
import { tenantGuardPlugin } from './plugins/tenantGuard.js';

// Interface للمرشح
// ملاحظة: organizationId/createdByClerkUserId مطلوبين على مستوى الـ schema (بـ defaults)
// لكن نُعلنهما optional في الـ interface لتسهيل التوافق مع الكود القديم.
export interface ICandidate extends Document {
    organizationId?: string;
    createdByClerkUserId?: string;
    full_name: string;
    email: string;
    phone: string;
    location?: string;
    gender?: string;
    position_applied_for: string;
    company_applied_to?: string;
    years_of_experience: string;
    current_company?: string;
    /** المسمى الوظيفي الحالي على مستوى الملف الشخصي (منفصل عن position_applied_for للتقديم). */
    current_title?: string;
    highest_education_level?: string;
    linkedin?: string;
    skills: string[];
    languages: string[];
    certifications?: string;
    availability?: string;
    /** راتب متوقع واحد من الاستمارة (بدل نطاق min/max) */
    expectedSalary?: string;
    salaryMin?: string;
    salaryMax?: string;
    salaryCurrency?: string;
    coverLetter?: string;
    hearAboutUs?: string;
    agreeToTerms: boolean;
    status?: 'pending' | 'pending_evaluation' | 'accepted' | 'rejected';
    /** Snapshot refs for fair evaluation audit. */
    evaluationContext?: CandidateEvaluationContext;
    interviewDate?: Date;
    aiEvaluation?: {
        score: number;
        communication: number;
        technical: number;
        problemSolving: number;
        confidence: number;
        feedback: string;
    };
    /**
     * Dual-write / legacy (M2M): التقييمات وقفل الروابط والتسجيل والـ campaignId ما زالت هنا
     * للتوافق أثناء الانتقال؛ مصدر الحقيقة لكل تقديم هو CandidateApplication.
     * لا تُحذف حتى تثبت كل المسارات (Stage/n8n/compare) على Application فقط.
     */
    writtenInterviewEvaluation?: {
        overall_score: number; // 0-100
        fit_for_role: string;
        strengths: string[];
        weaknesses: string[];
        red_flags: string[];
        final_hr_evaluation?: string;
        recommendation: 'Hire' | 'Consider' | 'Reject';
        summary: string; // professional 3-5 sentence evaluation
        /** Per-rubric AI results — stored for audit; UI Phase 2 */
        rubricResults?: Array<{
            rubricItemId: string;
            result: 'meets' | 'partially_meets' | 'does_not_meet' | 'insufficient_evidence';
            evidence: string[];
            confidence: 'low' | 'medium' | 'high';
        }>;
    };
    voiceInterviewEvaluation?: {
        /** رقم 0–10 أو نص من n8n */
        communication?: number | string;
        language_fluency?: string;
        confidence?: string;
        problem_solving?: number | string;
        digital_skills?: string;
        overall_fit?: string;
        professional_attitude?: string;
        strengths?: string[];
        weaknesses?: string[];
        final_hr_evaluation?: string;
        overall_score?: number;
        recommendation?: 'Hire' | 'Consider' | 'Reject' | 'Incomplete';
        summary?: string;
    };
    videoInterviewEvaluation?: {
        role_understanding?: number; // 0-10
        professional_depth?: number; // 0-10
        problem_handling?: number; // 0-10
        decision_making?: number; // 0-10
        prioritization?: number; // 0-10
        process_thinking?: number; // 0-10
        responsibility?: number; // 0-10
        learning_ability?: number; // 0-10
        job_readiness?: number; // 0-10
        final_role_fit?: number; // 0-10
        overall_score: number; // 0-100 percentage
        recommendation: 'Hire' | 'Consider' | 'Reject';
        summary?: string;
        /**
         * درجات الكفاءات من Interview Blueprint (المقابلة المتخصصة) — تكميلية للحقول أعلاه.
         * كل كفاءة: مفتاحها، درجتها 1..5، أدلة من الإجابة، وأي red flags. تُستخدم للمقارنة العادلة.
         */
        competencyScores?: Array<{
            competencyKey: string;
            title?: string;
            /** false when the transcript held no evidence for this competency. */
            assessed?: boolean;
            score: number | null; // 1-5, null when not assessed
            evidence?: string[];
            redFlags?: string[];
        }>;
        // v2 blueprint scorer extras — persisted so an "insufficient data" outcome
        // is surfaced honestly instead of being dropped and shown as a clean score.
        strengths?: string[];
        weaknesses?: string[];
        final_hr_evaluation?: string;
        status?: string; // e.g. 'insufficient_data'
        blueprint_coverage?: number | Record<string, unknown>;
        generic_ratings?: Record<string, unknown>;
    };
    /**
     * تسجيل صوتي للمقابلة الصوتية الكاملة (المرشح + الوكيل) مرفوع إلى Cloudflare R2.
     * نخزّن `key` فقط (لا روابط دائمة)؛ يُولَّد رابط موقّت عند الطلب.
     */
    voiceRecording?: {
        key: string;
        mime?: string;
        durationSec?: number;
        sizeBytes?: number;
        sessionId?: string;
        createdAt?: Date;
    };
    /** يُقفل رابط المقابلة الصوتية بعد جلسة فعلية (رد مرشح واحد على الأقل). */
    voiceInterviewLinkConsumedAt?: Date | null;
    voiceInterviewLinkConsumedSessionId?: string;
    /** يُقفل رابط مقابلة الفيديو بعد جلسة فعلية. */
    videoInterviewLinkConsumedAt?: Date | null;
    videoInterviewLinkConsumedSessionId?: string;
    files?: Array<{
        kind?: 'cv' | 'photo' | 'certificate';
        filename: string;
        originalName: string;
        path: string;
        mimeType: string;
        size: number;
        uploadedAt: Date;
    }>;
    notes?: string;
    /** نفس `campaignId` من RecruitmentCampaign — لربط المرشح بالحملة ومقارنة المرشحين ضمنها */
    campaignId?: string;
    /** MongoDB ObjectId لوثيقة الوظيفة/الإعلان — مفتاح بنك أسئلة LiveKit (24 hex) */
    jobPostingId?: string;
    /**
     * نقطة دخول المرشح إلى المنظومة:
     *  - `screening` (افتراضي): مسار العملية الكامل، يبدأ من Stage 1 (Written).
     *  - `audio`: تم إنشاؤه من زر Call مباشرة → يظهر فقط في Stage 2 + Candidates.
     *  - `video`: تم إنشاؤه من زر Video مباشرة → يظهر فقط في Stage 3 + Candidates.
     * المرشحون القدامى بدون هذا الحقل يُعاملون كأنهم `screening` للحفاظ على التوافق الخلفي.
     */
    entryStage?: 'screening' | 'audio' | 'video';
    /**
     * مصدر المرشح (من أين أتى)، منفصل عن `entryStage` (مرحلته في خط الأنابيب).
     * أمثلة حالية/مستقبلية: `public_screening`, `linkedin`, `career_page`, `referral`, `manual`.
     * يُترك كنص حر (بدون enum) ليبقى قابلاً للتوسّع دون تعديل المخطط.
     */
    sourceType?: string;
    /**
     * معرّف لقطة سياق المصدر (HeadHunterSourcingContext) عند قدوم المرشح من الهيد هانتر.
     * يُستخدم لإثراء سجل المرشح وحقن role_context غني للوكيل عبر /prepare و/start.
     */
    headHunterContextId?: string;
    /**
     * مراحل أُخفيت منها بطاقة حملة هذا المرشح من قائمة الحملات (بدون حذف البيانات).
     * القيم: 'screening' | 'voice' | 'video'. الإخفاء لكل مرحلة على حدة.
     */
    hiddenFromStages?: Array<'screening' | 'voice' | 'video'>;
    /**
     * واجهات أُخفيت منها بطاقة/صف هذا المرشح (بدون حذف البيانات).
     * القيم: 'candidates' = صفحة Database/Candidates.
     */
    hiddenFromViews?: Array<'candidates'>;
    /**
     * عدادات منسوخة للأداء فقط (cache) — المصدر الحقيقي هو عدّ CandidateApplication.
     * أعد الحساب عبر refreshPersonApplicationCounters عند الشك.
     */
    applicationsCount?: number;
    lastAppliedAt?: Date | null;
    lastCampaignId?: string;
    createdAt: Date;
    updatedAt: Date;
}

// Schema للمرشح
const CandidateSchema = new Schema<ICandidate>({
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
    full_name: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        trim: true,
        lowercase: true
    },
    phone: {
        type: String,
        required: true,
        trim: true
    },
    location: {
        type: String,
        trim: true
    },
    gender: {
        type: String,
        trim: true,
        lowercase: true
    },
    position_applied_for: {
        type: String,
        required: true,
        trim: true
    },
    company_applied_to: {
        type: String,
        trim: true
    },
    years_of_experience: {
        type: String,
        required: true
    },
    current_company: {
        type: String,
        trim: true
    },
    current_title: {
        type: String,
        trim: true
    },
    highest_education_level: {
        type: String,
        trim: true
    },
    linkedin: {
        type: String,
        trim: true
    },
    skills: {
        type: [String],
        default: []
    },
    languages: {
        type: [String],
        default: []
    },
    certifications: {
        type: String,
        trim: true
    },
    availability: {
        type: String,
        trim: true
    },
    expectedSalary: {
        type: String,
        trim: true
    },
    salaryMin: {
        type: String,
        trim: true
    },
    salaryMax: {
        type: String,
        trim: true
    },
    salaryCurrency: {
        type: String,
        default: 'USD'
    },
    coverLetter: {
        type: String,
        trim: true
    },
    hearAboutUs: {
        type: String,
        trim: true
    },
    campaignId: {
        type: String,
        trim: true,
        index: true,
        default: undefined
    },
    jobPostingId: {
        type: String,
        trim: true,
        index: true,
        default: undefined
    },
    entryStage: {
        type: String,
        enum: ['screening', 'audio', 'video'],
        default: 'screening'
        // Low-cardinality (3 values): no standalone index. Org-scoped compound
        // indexes cover the real query patterns (see prune-candidate-indexes.ts).
    },
    sourceType: {
        type: String,
        trim: true,
        lowercase: true,
        default: undefined
        // Low-cardinality: no standalone index (pruned — see prune-candidate-indexes.ts).
    },
    headHunterContextId: {
        type: String,
        trim: true,
        index: true,
        default: undefined
    },
    hiddenFromStages: {
        type: [String],
        enum: ['screening', 'voice', 'video'],
        default: undefined
    },
    hiddenFromViews: {
        type: [String],
        enum: ['candidates'],
        default: undefined
    },
    agreeToTerms: {
        type: Boolean,
        required: true,
        default: false
    },
    status: {
        type: String,
        enum: ['pending', 'pending_evaluation', 'accepted', 'rejected'],
        default: 'pending'
    },
    evaluationContext: {
        type: new Schema(
            {
                formSchemaVersion: { type: Number, required: true },
                formSchemaHash: { type: String, required: true },
                rubricVersion: { type: Number, required: true },
                rubricSnapshotHash: { type: String, required: true },
                evaluationLanguage: { type: String, enum: ['ar', 'en'], required: false },
            },
            { _id: false }
        ),
        required: false,
    },
    interviewDate: {
        type: Date
    },
    aiEvaluation: {
        score: Number,
        communication: Number,
        technical: Number,
        problemSolving: Number,
        confidence: Number,
        feedback: String
    },
    writtenInterviewEvaluation: {
        overall_score: {
            type: Number,
            min: 0,
            max: 100
        },
        fit_for_role: String,
        strengths: [String],
        weaknesses: [String],
        red_flags: [String],
        final_hr_evaluation: String,
        recommendation: {
            type: String,
            enum: ['Hire', 'Consider', 'Reject']
        },
        summary: String,
        rubricResults: [
            {
                rubricItemId: { type: String, required: true, trim: true },
                result: {
                    type: String,
                    enum: ['meets', 'partially_meets', 'does_not_meet', 'insufficient_evidence'],
                    required: true,
                },
                evidence: [String],
                confidence: {
                    type: String,
                    enum: ['low', 'medium', 'high'],
                    default: 'medium',
                },
            },
        ],
    },
    voiceInterviewEvaluation: {
        communication: Schema.Types.Mixed,
        language_fluency: String,
        confidence: String,
        problem_solving: Schema.Types.Mixed,
        digital_skills: String,
        overall_fit: String,
        professional_attitude: String,
        strengths: [String],
        weaknesses: [String],
        final_hr_evaluation: String,
        overall_score: {
            type: Number,
            min: 0,
            max: 100
        },
        recommendation: {
            type: String,
            // Incomplete = evidence gate failed (short/thin session) — not a Hire/Reject judgment
            enum: ['Hire', 'Consider', 'Reject', 'Incomplete']
        },
        summary: String
    },
    videoInterviewEvaluation: {
        role_understanding: {
            type: Number,
            min: 0,
            max: 10
        },
        professional_depth: {
            type: Number,
            min: 0,
            max: 10
        },
        problem_handling: {
            type: Number,
            min: 0,
            max: 10
        },
        decision_making: {
            type: Number,
            min: 0,
            max: 10
        },
        prioritization: {
            type: Number,
            min: 0,
            max: 10
        },
        process_thinking: {
            type: Number,
            min: 0,
            max: 10
        },
        responsibility: {
            type: Number,
            min: 0,
            max: 10
        },
        learning_ability: {
            type: Number,
            min: 0,
            max: 10
        },
        job_readiness: {
            type: Number,
            min: 0,
            max: 10
        },
        final_role_fit: {
            type: Number,
            min: 0,
            max: 10
        },
        overall_score: {
            type: Number,
            min: 0,
            max: 100
        },
        recommendation: {
            type: String,
            enum: ['Hire', 'Consider', 'Reject']
        },
        summary: String,
        competencyScores: {
            type: [
                new Schema(
                    {
                        competencyKey: { type: String, required: true },
                        title: { type: String },
                        // false when the transcript held no evidence for this
                        // competency. Without it a not-assessed row is
                        // indistinguishable from a missing score.
                        assessed: { type: Boolean },
                        score: { type: Number, min: 1, max: 5 },
                        evidence: { type: [String], default: undefined },
                        redFlags: { type: [String], default: undefined },
                    },
                    { _id: false }
                ),
            ],
            default: undefined,
        },
        strengths: { type: [String], default: undefined },
        weaknesses: { type: [String], default: undefined },
        final_hr_evaluation: { type: String },
        status: { type: String },
        blueprint_coverage: { type: Schema.Types.Mixed },
        generic_ratings: { type: Schema.Types.Mixed }
    },
    voiceRecording: {
        key: String,
        mime: String,
        durationSec: Number,
        sizeBytes: Number,
        sessionId: String,
        createdAt: Date
    },
    voiceInterviewLinkConsumedAt: { type: Date, default: null },
    voiceInterviewLinkConsumedSessionId: { type: String, trim: true },
    videoInterviewLinkConsumedAt: { type: Date, default: null },
    videoInterviewLinkConsumedSessionId: { type: String, trim: true },
    files: [{
        kind: {
            type: String,
            enum: ['cv', 'photo', 'certificate']
        },
        filename: String,
        originalName: String,
        path: String,
        mimeType: String,
        size: Number,
        uploadedAt: {
            type: Date,
            default: Date.now
        }
    }],
    notes: {
        type: String,
        trim: true
    },
    applicationsCount: {
        type: Number,
        default: 0,
        min: 0
    },
    lastAppliedAt: {
        type: Date,
        default: null
    },
    lastCampaignId: {
        type: String,
        trim: true,
        default: undefined
    }
}, {
    timestamps: true // يضيف createdAt و updatedAt تلقائياً
});

CandidateSchema.index({ organizationId: 1, email: 1 }, { unique: true });
CandidateSchema.index({ organizationId: 1, createdAt: -1 });

// Tenant-isolation guard: candidate rows are always org-scoped; only _id lookups
// (and explicit skipTenantGuard) may run unscoped.
CandidateSchema.plugin(tenantGuardPlugin, { safeKeys: [] });

// Export Model
export default mongoose.model<ICandidate>('Candidate', CandidateSchema, 'candidates');


















