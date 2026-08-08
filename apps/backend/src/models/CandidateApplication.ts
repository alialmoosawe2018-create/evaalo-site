import crypto from 'crypto';
import mongoose, { Schema, Document, Types } from 'mongoose';
import { DEFAULT_ORG_ID } from '../config/multiTenant.js';
import type { CandidateEvaluationContext } from '../shared/formTemplates/index.js';
import { tenantGuardPlugin } from './plugins/tenantGuard.js';

/** أنواع مرفقات التقديم (أوسع من files القديمة). */
export type ApplicationAttachmentType =
    | 'cv'
    | 'cover_letter'
    | 'portfolio'
    | 'certificate'
    | 'assessment'
    | 'offer'
    | 'other'
    | 'photo';

export type ApplicationEventType =
    | 'applied'
    | 'migrated'
    | 'screening_completed'
    | 'voice_completed'
    | 'video_completed'
    | 'status_changed'
    | 'note_added';

export type ApplicationSource =
    | 'LinkedIn'
    | 'Indeed'
    | 'Referral'
    | 'CareerPage'
    | 'Agency'
    | 'ImportCSV'
    | 'HeadHunter'
    | 'Other'
    | string;

export interface IApplicationSnapshot {
    full_name?: string;
    headline?: string;
    current_title?: string;
    current_company?: string;
    years_of_experience?: string;
    location?: string;
    skills?: string[];
    languages?: string[];
    position_applied_for?: string;
    capturedAt?: Date;
}

export interface IApplicationEvent {
    at: Date;
    type: ApplicationEventType;
    actorId?: string;
    meta?: Record<string, unknown>;
}

export interface IApplicationAttachment {
    type: ApplicationAttachmentType;
    filename: string;
    originalName: string;
    path: string;
    mimeType: string;
    size: number;
    uploadedAt: Date;
}

/**
 * طلب تقديم لحملة واحدة (Many-to-Many: Candidate ↔ Campaign).
 * التقييمات والروابط والمرفقات معزولة لكل Application.
 */
export interface ICandidateApplication extends Document {
    organizationId: string;
    candidateId: Types.ObjectId;
    /** ObjectId لوثيقة RecruitmentCampaign (_id) — العلاقة الأساسية. */
    campaignRef?: Types.ObjectId | null;
    /** slug النصي للتوافق مع الروابط/n8n/الواجهة الحالية. */
    campaignId?: string;
    /** معرّف عام للروابط والـ callbacks (hex). */
    applicationId: string;
    /** نسخة بحث فقط — المصدر الحقيقي Candidate.email */
    emailDenorm: string;

    position_applied_for?: string;
    company_applied_to?: string;
    years_of_experience?: string;
    current_company?: string;
    highest_education_level?: string;
    skills?: string[];
    languages?: string[];
    certifications?: string;
    availability?: string;
    expectedSalary?: string;
    salaryMin?: string;
    salaryMax?: string;
    salaryCurrency?: string;
    coverLetter?: string;
    hearAboutUs?: string;
    agreeToTerms?: boolean;
    jobPostingId?: string;
    entryStage?: 'screening' | 'audio' | 'video';
    sourceType?: string;
    source?: ApplicationSource;
    headHunterContextId?: string;
    status?: 'pending' | 'pending_evaluation' | 'accepted' | 'rejected';
    evaluationContext?: CandidateEvaluationContext;
    notes?: string;
    interviewDate?: Date;
    hiddenFromStages?: Array<'screening' | 'voice' | 'video'>;
    hiddenFromViews?: Array<'candidates'>;

    applicationSnapshot?: IApplicationSnapshot;
    aiEvaluation?: ICandidate['aiEvaluation'];
    writtenInterviewEvaluation?: ICandidate['writtenInterviewEvaluation'];
    voiceInterviewEvaluation?: ICandidate['voiceInterviewEvaluation'];
    videoInterviewEvaluation?: ICandidate['videoInterviewEvaluation'];
    voiceRecording?: ICandidate['voiceRecording'];
    voiceInterviewLinkConsumedAt?: Date | null;
    voiceInterviewLinkConsumedSessionId?: string;
    videoInterviewLinkConsumedAt?: Date | null;
    videoInterviewLinkConsumedSessionId?: string;
    attachments?: IApplicationAttachment[];
    /** توافق مؤقت مع كود يقرأ files */
    files?: IApplicationAttachment[];
    timeline?: IApplicationEvent[];

    deletedAt?: Date | null;
    deletedBy?: string;

    createdAt: Date;
    updatedAt: Date;
}

/** استيراد نوع التقييمات من Candidate بدون دورة — تعريف محلي مضغوط */
type ICandidate = {
    aiEvaluation?: {
        score: number;
        communication: number;
        technical: number;
        problemSolving: number;
        confidence: number;
        feedback: string;
    };
    writtenInterviewEvaluation?: Record<string, unknown>;
    voiceInterviewEvaluation?: Record<string, unknown>;
    videoInterviewEvaluation?: Record<string, unknown>;
    voiceRecording?: {
        key: string;
        mime?: string;
        durationSec?: number;
        sizeBytes?: number;
        sessionId?: string;
        createdAt?: Date;
    };
};

export function generateApplicationId(): string {
    return crypto.randomBytes(16).toString('hex');
}

const AttachmentSchema = new Schema(
    {
        type: {
            type: String,
            enum: ['cv', 'cover_letter', 'portfolio', 'certificate', 'assessment', 'offer', 'other', 'photo'],
            default: 'other',
        },
        filename: String,
        originalName: String,
        path: String,
        mimeType: String,
        size: Number,
        uploadedAt: { type: Date, default: Date.now },
    },
    { _id: false }
);

const SnapshotSchema = new Schema(
    {
        full_name: String,
        headline: String,
        current_title: String,
        current_company: String,
        years_of_experience: String,
        location: String,
        skills: [String],
        languages: [String],
        position_applied_for: String,
        capturedAt: { type: Date, default: Date.now },
    },
    { _id: false }
);

const TimelineEventSchema = new Schema(
    {
        at: { type: Date, default: Date.now },
        type: {
            type: String,
            enum: [
                'applied',
                'migrated',
                'screening_completed',
                'voice_completed',
                'video_completed',
                'status_changed',
                'note_added',
            ],
            required: true,
        },
        actorId: String,
        meta: Schema.Types.Mixed,
    },
    { _id: false }
);

const CandidateApplicationSchema = new Schema<ICandidateApplication>(
    {
        organizationId: {
            type: String,
            required: true,
            default: DEFAULT_ORG_ID,
            index: true,
            trim: true,
        },
        candidateId: {
            type: Schema.Types.ObjectId,
            ref: 'Candidate',
            required: true,
            index: true,
        },
        campaignRef: {
            type: Schema.Types.ObjectId,
            ref: 'RecruitmentCampaign',
            default: null,
            index: true,
        },
        campaignId: {
            type: String,
            trim: true,
            index: true,
            default: undefined,
        },
        applicationId: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            index: true,
        },
        emailDenorm: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            index: true,
        },
        position_applied_for: { type: String, trim: true },
        company_applied_to: { type: String, trim: true },
        years_of_experience: { type: String },
        current_company: { type: String, trim: true },
        highest_education_level: { type: String, trim: true },
        skills: { type: [String], default: [] },
        languages: { type: [String], default: [] },
        certifications: { type: String, trim: true },
        availability: { type: String, trim: true },
        expectedSalary: { type: String, trim: true },
        salaryMin: { type: String, trim: true },
        salaryMax: { type: String, trim: true },
        salaryCurrency: { type: String, default: 'USD' },
        coverLetter: { type: String, trim: true },
        hearAboutUs: { type: String, trim: true },
        agreeToTerms: { type: Boolean, default: false },
        jobPostingId: { type: String, trim: true, index: true },
        entryStage: {
            type: String,
            enum: ['screening', 'audio', 'video'],
            default: 'screening',
            index: true,
        },
        sourceType: { type: String, trim: true, lowercase: true, index: true },
        source: { type: String, trim: true },
        headHunterContextId: { type: String, trim: true, index: true },
        status: {
            type: String,
            enum: ['pending', 'pending_evaluation', 'accepted', 'rejected'],
            default: 'pending',
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
        notes: { type: String, trim: true },
        interviewDate: { type: Date },
        hiddenFromStages: {
            type: [String],
            enum: ['screening', 'voice', 'video'],
            default: undefined,
        },
        hiddenFromViews: {
            type: [String],
            enum: ['candidates'],
            default: undefined,
        },
        applicationSnapshot: { type: SnapshotSchema, default: undefined },
        aiEvaluation: {
            score: Number,
            communication: Number,
            technical: Number,
            problemSolving: Number,
            confidence: Number,
            feedback: String,
        },
        writtenInterviewEvaluation: {
            overall_score: { type: Number, min: 0, max: 100 },
            fit_for_role: String,
            strengths: [String],
            weaknesses: [String],
            red_flags: [String],
            final_hr_evaluation: String,
            recommendation: { type: String, enum: ['Hire', 'Consider', 'Reject'] },
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
                    confidence: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
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
            overall_score: { type: Number, min: 0, max: 100 },
            recommendation: { type: String, enum: ['Hire', 'Consider', 'Reject'] },
            summary: String,
        },
        videoInterviewEvaluation: {
            role_understanding: { type: Number, min: 0, max: 10 },
            professional_depth: { type: Number, min: 0, max: 10 },
            problem_handling: { type: Number, min: 0, max: 10 },
            decision_making: { type: Number, min: 0, max: 10 },
            prioritization: { type: Number, min: 0, max: 10 },
            process_thinking: { type: Number, min: 0, max: 10 },
            responsibility: { type: Number, min: 0, max: 10 },
            learning_ability: { type: Number, min: 0, max: 10 },
            job_readiness: { type: Number, min: 0, max: 10 },
            final_role_fit: { type: Number, min: 0, max: 10 },
            overall_score: { type: Number, min: 0, max: 100 },
            recommendation: { type: String, enum: ['Hire', 'Consider', 'Reject'] },
            summary: String,
            competencyScores: {
                type: [
                    new Schema(
                        {
                            competencyKey: { type: String, required: true },
                            title: { type: String },
                            score: { type: Number, min: 1, max: 5 },
                            evidence: { type: [String], default: undefined },
                            redFlags: { type: [String], default: undefined },
                        },
                        { _id: false }
                    ),
                ],
                default: undefined,
            },
        },
        voiceRecording: {
            key: String,
            mime: String,
            durationSec: Number,
            sizeBytes: Number,
            sessionId: String,
            createdAt: Date,
        },
        voiceInterviewLinkConsumedAt: { type: Date, default: null },
        voiceInterviewLinkConsumedSessionId: { type: String, trim: true },
        videoInterviewLinkConsumedAt: { type: Date, default: null },
        videoInterviewLinkConsumedSessionId: { type: String, trim: true },
        attachments: { type: [AttachmentSchema], default: [] },
        files: { type: [AttachmentSchema], default: undefined },
        timeline: { type: [TimelineEventSchema], default: [] },
        deletedAt: { type: Date, default: null, index: true },
        deletedBy: { type: String, trim: true },
    },
    { timestamps: true, collection: 'candidate_applications' }
);

CandidateApplicationSchema.index(
    { candidateId: 1, campaignId: 1 },
    {
        unique: true,
        partialFilterExpression: {
            campaignId: { $type: 'string' },
            deletedAt: null,
        },
    }
);
CandidateApplicationSchema.index({ organizationId: 1, campaignId: 1, emailDenorm: 1 });
CandidateApplicationSchema.index({ organizationId: 1, campaignId: 1, createdAt: -1 });
CandidateApplicationSchema.index({ candidateId: 1, createdAt: -1 });
CandidateApplicationSchema.index(
    { candidateId: 1, campaignRef: 1 },
    {
        unique: true,
        partialFilterExpression: {
            campaignRef: { $type: 'objectId' },
            deletedAt: null,
        },
    }
);

// Tenant-isolation guard. `applicationId` (public, unique) and `candidateId`
// (person-scoped, already org-bound) are safe single-tenant lookups.
CandidateApplicationSchema.plugin(tenantGuardPlugin, { safeKeys: ['applicationId', 'candidateId'] });

export default mongoose.model<ICandidateApplication>(
    'CandidateApplication',
    CandidateApplicationSchema,
    'candidate_applications'
);
