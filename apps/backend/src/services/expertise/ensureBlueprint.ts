// ============================================
// ملف: services/expertise/ensureBlueprint.ts
// الوظيفة: توليد وتثبيت JobExpertiseProfile + InterviewBlueprint مرة واحدة لكل حملة (idempotent).
//          يُستدعى عند إنشاء أول رابط/مرشح فيديو — قبل إرسال الرابط، fail-open.
// ============================================

import { randomUUID } from 'crypto';
import RecruitmentCampaign from '../../models/RecruitmentCampaign.js';
import JobExpertiseProfile, { type IJobExpertiseProfile } from '../../models/JobExpertiseProfile.js';
import InterviewBlueprint, { type IInterviewBlueprint } from '../../models/InterviewBlueprint.js';
import { generateExpertiseAndBlueprint } from './blueprintGenerator.js';

/** هل ميزة الـBlueprint مفعّلة؟ (افتراضياً مفعّلة ما لم تُضبط على false صراحةً). */
export function isBlueprintFeatureEnabled(): boolean {
    return process.env.VIDEO_INTERVIEW_USE_BLUEPRINT !== 'false';
}

export interface LockedBlueprintBundle {
    blueprint: IInterviewBlueprint;
    profile: IJobExpertiseProfile | null;
}

/**
 * شكل اللقطة المُرسَلة للوكيل ولمصحّح Stage 3. مسار واحد لكل الاستدعاءات حتى
 * لا يضيع scoreRubric / expectedEvidence بين /start و /end و n8n.
 */
export function buildBlueprintSnapshot(
    bundle: LockedBlueprintBundle | null
): Record<string, unknown> | undefined {
    if (!bundle?.blueprint) return undefined;
    const profile = bundle.profile as (IJobExpertiseProfile & Record<string, unknown>) | null;
    const profileRoleResolution = bundle.profile?.roleResolution || profile?.roleResolution;
    const blueprintExtra = bundle.blueprint as IInterviewBlueprint & Record<string, unknown>;
    return {
        blueprintId: bundle.blueprint.blueprintId,
        profileId: bundle.blueprint.profileId,
        version: bundle.blueprint.version,
        blueprintContentVersion:
            bundle.blueprint.blueprintContentVersion || bundle.profile?.blueprintContentVersion,
        packVersion: bundle.blueprint.packVersion || bundle.profile?.packVersion,
        packMatchConfidence:
            bundle.blueprint.packMatchConfidence || bundle.profile?.packMatchConfidence,
        blueprintGeneratedAt: (
            bundle.blueprint.blueprintGeneratedAt || bundle.profile?.blueprintGeneratedAt
        )?.toISOString?.(),
        language: bundle.blueprint.language,
        knowledgeDepth: bundle.blueprint.knowledgeDepth || bundle.profile?.knowledgeDepth,
        roleResolution: profileRoleResolution || undefined,
        anchorQuestions: bundle.blueprint.anchorQuestions,
        competencies: (bundle.blueprint.competencies || []).map((c) => ({
            competencyKey: c.competencyKey,
            title: c.title,
            priority: c.priority,
            questionObjective: c.questionObjective,
            expectedEvidence: c.expectedEvidence,
            redFlags: c.redFlags,
            scoreRubric: c.scoreRubric,
            followUpRules: c.followUpRules,
        })),
        domainPackKey: bundle.profile?.domainPackKey,
        specialization: bundle.profile?.specialization,
        terminology: (bundle.profile?.terminology || []).slice(0, 18),
        experienceTrackKeys: (
            (blueprintExtra.experienceTracks as Array<Record<string, unknown>> | undefined)
            || (profile?.experienceTracks as Array<Record<string, unknown>> | undefined)
            || []
        )
            .map((t: Record<string, unknown>) => String(t.trackKey || ''))
            .filter(Boolean)
            .slice(0, 6),
        interviewPathKeys: (
            (blueprintExtra.interviewPaths as Array<Record<string, unknown>> | undefined)
            || (profile?.interviewPaths as Array<Record<string, unknown>> | undefined)
            || []
        )
            .map((p: Record<string, unknown>) => String(p.pathKey || ''))
            .filter(Boolean)
            .slice(0, 2),
    };
}

/** يجلب نسخة الـBlueprint المقفلة للحملة (إن وُجدت) مع الProfile. */
export async function getLockedBlueprintForCampaign(
    campaignId: string
): Promise<LockedBlueprintBundle | null> {
    const id = (campaignId || '').trim();
    if (!id) return null;
    const blueprint = await InterviewBlueprint.findOne({ campaignId: id, status: 'locked' });
    if (!blueprint) return null;
    const profile = await JobExpertiseProfile.findOne({ profileId: blueprint.profileId });
    return { blueprint, profile };
}

/**
 * يضمن وجود Blueprint مقفل للحملة. idempotent: استدعاءان متتاليان ينتجان نسخة واحدة.
 * يرمي عند تعذّر إيجاد الحملة فقط؛ غير ذلك يُرجع الحزمة أو null (fail-open للمستدعي).
 */
export async function ensureBlueprintForCampaign(
    campaignId: string
): Promise<LockedBlueprintBundle | null> {
    const id = (campaignId || '').trim();
    if (!id) return null;
    if (!isBlueprintFeatureEnabled()) return null;

    // 1) موجود ومقفل → أعِده فوراً (لا توليد مكرر).
    const existing = await getLockedBlueprintForCampaign(id);
    if (existing) return existing;

    // 2) اقرأ الحملة.
    const campaign = await RecruitmentCampaign.findOne({ campaignId: id }).lean();
    if (!campaign) {
        console.warn(`⚠️ ensureBlueprintForCampaign: campaign not found: ${id}`);
        return null;
    }

    const organizationId = campaign.organizationId;
    const createdByClerkUserId = campaign.createdByClerkUserId;

    // 3) ولّد Profile + Blueprint.
    const generated = await generateExpertiseAndBlueprint({
        criteria: (campaign.criteria && typeof campaign.criteria === 'object')
            ? (campaign.criteria as Record<string, any>)
            : {},
        jobAdvertisement: campaign.jobAdvertisement,
    });

    const profileId = randomUUID();
    const blueprintId = randomUUID();

    try {
        const profile = await JobExpertiseProfile.create({
            profileId,
            version: 1,
            ...(organizationId ? { organizationId } : {}),
            ...(createdByClerkUserId ? { createdByClerkUserId } : {}),
            campaignId: id,
            roleSummary: generated.roleSummary,
            jobTitle: generated.jobTitle,
            domain: generated.domain,
            specialization: generated.specialization,
            seniority: generated.seniority,
            environment: generated.environment,
            expertisePrompt: generated.expertisePrompt,
            domainGuidance: generated.domainGuidance,
            domainPackKey: generated.domainPackKey,
            requiredSkills: generated.requiredSkills,
            toolsAndSystems: generated.toolsAndSystems,
            responsibilities: generated.responsibilities,
            mustAssess: generated.mustAssess,
            expectedEvidence: generated.expectedEvidence,
            redFlags: generated.redFlags,
            qualityRisk: generated.qualityRisk,
            selectedFamilyIds: generated.competencies.map((c) => c.competencyKey),
            interviewBlueprintId: blueprintId,
            sourceCriteriaSnapshot: (campaign.criteria && typeof campaign.criteria === 'object')
                ? (campaign.criteria as Record<string, any>)
                : undefined,
            generationSource: generated.generationSource,
            knowledgeDepth: generated.knowledgeDepth,
            terminology: generated.terminology,
            blueprintContentVersion: generated.blueprintContentVersion,
            packVersion: generated.packVersion ?? undefined,
            blueprintGeneratedAt: generated.generatedAt
                ? new Date(generated.generatedAt)
                : new Date(),
            packMatchConfidence: generated.packMatchConfidence,
            roleKey: generated.roleKey ?? undefined,
            careerLevel: generated.careerLevel,
            managementTrack: generated.managementTrack,
            labelKey: generated.labelKey,
            roleResolution: generated.roleResolution,
            experienceTracks: generated.experienceTracks,
            interviewPaths: generated.interviewPaths,
            status: 'locked',
            lockedAt: new Date(),
        });

        const blueprint = await InterviewBlueprint.create({
            blueprintId,
            version: 1,
            ...(organizationId ? { organizationId } : {}),
            ...(createdByClerkUserId ? { createdByClerkUserId } : {}),
            campaignId: id,
            profileId: profile.profileId,
            status: 'locked',
            lockedAt: new Date(),
            language: generated.language,
            anchorQuestions: generated.anchorQuestions,
            competencies: generated.competencies,
            generationSource: generated.generationSource,
            knowledgeDepth: generated.knowledgeDepth,
            blueprintContentVersion: generated.blueprintContentVersion,
            packVersion: generated.packVersion ?? undefined,
            blueprintGeneratedAt: generated.generatedAt
                ? new Date(generated.generatedAt)
                : new Date(),
            packMatchConfidence: generated.packMatchConfidence,
            roleResolution: generated.roleResolution,
            experienceTracks: generated.experienceTracks,
            interviewPaths: generated.interviewPaths,
        });

        // telemetry خفيف: مستوى العمق يكشف أي التخصصات تحتاج حزماً عميقة لاحقاً (aggregation على logs).
        console.log(
            `✅ ensureBlueprintForCampaign: locked blueprint for campaign ${id} ` +
                `(domain=${generated.domain}, specialization=${generated.specialization || 'n/a'}, ` +
                `pack=${generated.domainPackKey || 'none'}, source=${generated.generationSource}, ` +
                `knowledgeDepth=${generated.knowledgeDepth}, contentVersion=${generated.blueprintContentVersion}, ` +
                `packVersion=${generated.packVersion || 'n/a'}, packMatch=${generated.packMatchConfidence || 'n/a'}, ` +
                `roleKey=${generated.roleKey || 'n/a'}, ` +
                `matchSource=${generated.roleResolution?.matchSource || 'n/a'})`
        );
        return { blueprint, profile };
    } catch (err: any) {
        // سباق تزامن: نسخة مقفلة أُنشئت بالتوازي (duplicate key على الفهرس الفريد) → أعِد الموجودة.
        if (err?.code === 11000) {
            console.log(`ℹ️ ensureBlueprintForCampaign: concurrent lock detected for ${id} — returning existing`);
            // نظّف الProfile المعلّق إن أمكن (best-effort).
            await JobExpertiseProfile.deleteOne({ profileId }).catch(() => {});
            return await getLockedBlueprintForCampaign(id);
        }
        console.error(`❌ ensureBlueprintForCampaign failed for ${id}:`, err?.message || err);
        throw err;
    }
}
