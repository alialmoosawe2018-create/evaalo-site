// ============================================
// ملف: models/InterviewBlueprint.ts
// الوظيفة: مخطط المقابلة الثابت للحملة — الأسئلة الأساسية + الكفاءات (مع rubric/followUp مدمجة).
//          النسخة المقفلة (locked) = snapshot عادل لكل مرشحي الحملة.
//          المتابعات تبقى ديناميكية على الوكيل؛ الأساسية ثابتة للجميع.
// ============================================

import mongoose, { Document, Schema } from 'mongoose';
import { DEFAULT_ORG_ID, SYSTEM_ACTOR_ID } from '../config/multiTenant.js';

/** كفاءة داخل الblueprint — تدمج rubric/followUp/evidence/redFlags (تقليل عدد الـCollections). */
export interface IBlueprintCompetency {
    competencyKey: string;
    title: string;
    priority: 'critical' | 'high' | 'medium';
    questionObjective: string;
    expectedEvidence: string[];
    redFlags: string[];
    /** rubric من 1 إلى 5 كخريطة مفتاح→وصف. */
    scoreRubric: Record<string, string>;
    followUpRules: string[];
}

export interface IInterviewBlueprint extends Document {
    blueprintId: string;
    version: number;
    organizationId?: string;
    createdByClerkUserId?: string;
    campaignId: string;
    profileId: string;
    status: 'draft' | 'locked';
    lockedAt?: Date;
    language: string; // 'ar' | 'en'
    /** الأسئلة الأساسية الثلاثة الثابتة لكل المرشحين (نموذج 3+2). */
    anchorQuestions: string[];
    competencies: IBlueprintCompetency[];
    /** هل اعتمد التوليد على LLM أم fallback. */
    generationSource?: 'llm' | 'pack_fallback' | 'taxonomy_fallback' | 'taxonomy_generated';
    /** عمق المعرفة المستخدمة فعلياً (نفس قيمة الProfile) — يدخل أيضاً ضمن blueprintSnapshot. */
    knowledgeDepth?: 'deep_pack' | 'taxonomy_generated' | 'fallback';
    /** semver محتوى الـBlueprint (مستقل عن version الرقمي). */
    blueprintContentVersion?: string;
    packVersion?: string;
    blueprintGeneratedAt?: Date;
    packMatchConfidence?: 'high' | 'medium' | 'low';
    /** Evaalo Job Catalog snapshot (audit at lock time). */
    roleResolution?: {
        roleKey?: string | null;
        careerLevel?: string;
        managementTrack?: string;
        matchSource?: string;
        confidence?: number;
        labelKey?: string;
    };
    experienceTracks?: Array<Record<string, unknown>>;
    interviewPaths?: Array<Record<string, unknown>>;
    createdAt: Date;
    updatedAt: Date;
}

const BlueprintCompetencySchema = new Schema<IBlueprintCompetency>(
    {
        competencyKey: { type: String, required: true },
        title: { type: String, required: true },
        priority: {
            type: String,
            enum: ['critical', 'high', 'medium'],
            default: 'high',
        },
        questionObjective: { type: String, default: '' },
        expectedEvidence: { type: [String], default: [] },
        redFlags: { type: [String], default: [] },
        scoreRubric: { type: Schema.Types.Mixed, default: {} },
        followUpRules: { type: [String], default: [] },
    },
    { _id: false }
);

const InterviewBlueprintSchema = new Schema<IInterviewBlueprint>(
    {
        organizationId: {
            type: String,
            required: true,
            default: DEFAULT_ORG_ID,
            index: true,
            trim: true,
        },
        createdByClerkUserId: {
            type: String,
            required: true,
            default: SYSTEM_ACTOR_ID,
            trim: true,
        },
        blueprintId: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        version: {
            type: Number,
            required: true,
            default: 1,
        },
        campaignId: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        profileId: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        status: {
            type: String,
            enum: ['draft', 'locked'],
            default: 'draft',
            index: true,
        },
        lockedAt: { type: Date },
        language: {
            type: String,
            default: 'ar',
        },
        anchorQuestions: { type: [String], default: [] },
        competencies: { type: [BlueprintCompetencySchema], default: [] },
        generationSource: {
            type: String,
            // taxonomy_generated: مسار التصنيف عندما ينجح LLM (كان يكسر الحفظ قبل إضافته هنا).
            enum: ['llm', 'pack_fallback', 'taxonomy_fallback', 'taxonomy_generated'],
            default: 'llm',
        },
        // enum عادي بلا index — 3 قيم فقط.
        knowledgeDepth: {
            type: String,
            enum: ['deep_pack', 'taxonomy_generated', 'fallback'],
            default: undefined,
        },
        blueprintContentVersion: { type: String, trim: true },
        packVersion: { type: String, trim: true },
        blueprintGeneratedAt: { type: Date },
        packMatchConfidence: {
            type: String,
            enum: ['high', 'medium', 'low'],
            default: undefined,
        },
        roleResolution: { type: Schema.Types.Mixed, default: undefined },
        experienceTracks: { type: Schema.Types.Mixed, default: undefined },
        interviewPaths: { type: Schema.Types.Mixed, default: undefined },
    },
    {
        timestamps: true,
        collection: 'interview_blueprints',
    }
);

// منع توليد متوازٍ مزدوج لنفس الحملة: نسخة locked واحدة لكل campaignId.
// partial index على status:'locked' يسمح بمسودات متعددة لكن نسخة مقفلة وحيدة.
InterviewBlueprintSchema.index(
    { campaignId: 1, status: 1 },
    {
        unique: true,
        partialFilterExpression: { status: 'locked' },
    }
);
InterviewBlueprintSchema.index({ organizationId: 1, createdAt: -1 });

const InterviewBlueprint = mongoose.model<IInterviewBlueprint>(
    'InterviewBlueprint',
    InterviewBlueprintSchema
);

export default InterviewBlueprint;
