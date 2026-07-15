// ============================================
// ملف: models/JobExpertiseProfile.ts
// الوظيفة: ملف خبرة الوظيفة — الطبقة التي تجعل الوكيل يبدو خبيراً في الدور المحدد.
//          يُولَّد تلقائياً من معايير الحملة + الإعلان + (حزمة المجال إن وُجدت)،
//          ثم يُقفل مع الـBlueprint على مستوى الحملة (نسخة version ثابتة لكل المرشحين).
// ============================================

import mongoose, { Document, Schema } from 'mongoose';
import { DEFAULT_ORG_ID, SYSTEM_ACTOR_ID } from '../config/multiTenant.js';

export interface IJobExpertiseProfile extends Document {
    profileId: string;
    /** يتزايد عند كل تثبيت؛ النسخة المثبتة مرجع الحملة الثابت. */
    version: number;
    organizationId?: string;
    createdByClerkUserId?: string;
    /** نفس campaignId النصي في RecruitmentCampaign — مفتاح القفل على مستوى الحملة. */
    campaignId?: string;
    /** مفتاح قالب المنظمة (خارج MVP — محجوز للتوسعة). */
    jobTemplateKey?: string;
    /** MongoDB ObjectId لوثيقة الوظيفة/الإعلان إن وُجد. */
    jobId?: string;
    /** ملخّص الدور (سطر-سطران). */
    roleSummary: string;
    /** المسمى الوظيفي كما في الحملة. */
    jobTitle?: string;
    /** المجال المستنتج (يطابق domainTaxonomy.domain). */
    domain: string;
    /** التخصص الدقيق. */
    specialization: string;
    /** مستوى الخبرة (Junior/Mid/Senior/...). */
    seniority?: string;
    /** بيئة العمل (Field/Office/Both/Remote ...). */
    environment?: string;
    /** الطبقة 3: Prompt الخبرة المولّد تلقائياً (يُقفل مع الblueprint؛ لا تعديل يدوي في MVP). */
    expertisePrompt: string;
    /** الطبقة 2: نسخة مختصرة من معرفة المجال تُمرَّر للوكيل عبر metadata. */
    domainGuidance: string;
    /** مفتاح الحزمة العميقة المستخدمة إن وُجدت (oil_gas_production/hr_recruiter). */
    domainPackKey?: string;
    requiredSkills?: string[];
    toolsAndSystems?: string[];
    responsibilities?: string[];
    /** ما الذي يجب أن يثبت المرشح أنه يعرفه. */
    mustAssess?: string[];
    /** الأدلة المتوقعة في إجابة قوية. */
    expectedEvidence?: string[];
    redFlags?: string[];
    /** مخاطر الجودة/السلامة. */
    qualityRisk?: string[];
    /** مفاتيح الكفاءات المختارة (مرجع للـBlueprint). */
    selectedFamilyIds?: string[];
    /** blueprintId المرتبط بهذا الProfile. */
    interviewBlueprintId?: string;
    /** لقطة من معايير الحملة وقت التوليد (لإعادة الإنتاج/التشخيص). */
    sourceCriteriaSnapshot?: Record<string, any>;
    /** هل اعتمد التوليد على LLM أم على fallback الحزمة/التصنيف الخام. */
    generationSource?: 'llm' | 'pack_fallback' | 'taxonomy_fallback' | 'taxonomy_generated';
    /**
     * عمق المعرفة المستخدمة فعلياً (مستقل عن generationSource):
     *  deep_pack (حزمة عميقة طُوبقت) | taxonomy_generated (توليد ناجح من التصنيف) | fallback (توليد خام).
     */
    knowledgeDepth?: 'deep_pack' | 'taxonomy_generated' | 'fallback';
    blueprintContentVersion?: string;
    packVersion?: string;
    blueprintGeneratedAt?: Date;
    packMatchConfidence?: 'high' | 'medium' | 'low';
    /** مصطلحات المجال المختارة (من الحزمة العميقة إن وُجدت) — تُمرَّر للوكيل. */
    terminology?: string[];
    /** Evaalo Job Catalog */
    roleKey?: string;
    careerLevel?: string;
    managementTrack?: string;
    labelKey?: string;
    roleResolution?: {
        roleKey?: string | null;
        careerLevel?: string;
        managementTrack?: string;
        matchSource?: string;
        confidence?: number;
        labelKey?: string;
    };
    /** مسارات الخبرة المنسوخة من الـBlueprint (للتشخيص وmetadata الاحتياطي). */
    experienceTracks?: Array<Record<string, unknown>>;
    interviewPaths?: Array<Record<string, unknown>>;
    status: 'draft' | 'locked';
    lockedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const JobExpertiseProfileSchema = new Schema<IJobExpertiseProfile>(
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
        profileId: {
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
            trim: true,
            index: true,
        },
        jobTemplateKey: { type: String, trim: true },
        jobId: { type: String, trim: true },
        roleSummary: { type: String, default: '' },
        jobTitle: { type: String, trim: true },
        domain: { type: String, default: 'general_professional', index: true },
        specialization: { type: String, default: '' },
        seniority: { type: String, trim: true },
        environment: { type: String, trim: true },
        expertisePrompt: { type: String, default: '' },
        domainGuidance: { type: String, default: '' },
        domainPackKey: { type: String, trim: true },
        requiredSkills: { type: [String], default: undefined },
        toolsAndSystems: { type: [String], default: undefined },
        responsibilities: { type: [String], default: undefined },
        mustAssess: { type: [String], default: undefined },
        expectedEvidence: { type: [String], default: undefined },
        redFlags: { type: [String], default: undefined },
        qualityRisk: { type: [String], default: undefined },
        selectedFamilyIds: { type: [String], default: undefined },
        interviewBlueprintId: { type: String, trim: true },
        sourceCriteriaSnapshot: { type: Schema.Types.Mixed, default: undefined },
        generationSource: {
            type: String,
            // taxonomy_generated: مسار التصنيف عندما ينجح LLM (كان يكسر الحفظ قبل إضافته هنا).
            enum: ['llm', 'pack_fallback', 'taxonomy_fallback', 'taxonomy_generated'],
            default: 'llm',
        },
        // enum عادي بلا index — cardinality منخفضة جداً (3 قيم)؛ الإحصاء عبر aggregation/logs.
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
        terminology: { type: [String], default: undefined },
        roleKey: { type: String, trim: true },
        careerLevel: { type: String, trim: true },
        managementTrack: { type: String, trim: true },
        labelKey: { type: String, trim: true },
        roleResolution: { type: Schema.Types.Mixed, default: undefined },
        experienceTracks: { type: Schema.Types.Mixed, default: undefined },
        interviewPaths: { type: Schema.Types.Mixed, default: undefined },
        status: {
            type: String,
            enum: ['draft', 'locked'],
            default: 'draft',
            index: true,
        },
        lockedAt: { type: Date },
    },
    {
        timestamps: true,
        collection: 'job_expertise_profiles',
    }
);

JobExpertiseProfileSchema.index({ organizationId: 1, createdAt: -1 });

const JobExpertiseProfile = mongoose.model<IJobExpertiseProfile>(
    'JobExpertiseProfile',
    JobExpertiseProfileSchema
);

export default JobExpertiseProfile;
