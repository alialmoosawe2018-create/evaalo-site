// ============================================
// ملف: services/expertise/ensureBlueprint.ts
// الوظيفة: توليد وتثبيت JobExpertiseProfile + InterviewBlueprint مرة واحدة لكل حملة (idempotent).
//          يُستدعى عند إنشاء أول رابط/مرشح فيديو — قبل إرسال الرابط، fail-open.
// ============================================

import { randomUUID } from 'crypto';
import RecruitmentCampaign from '../../models/RecruitmentCampaign.js';
import JobExpertiseProfile, { type IJobExpertiseProfile } from '../../models/JobExpertiseProfile.js';
import InterviewBlueprint, { type IInterviewBlueprint } from '../../models/InterviewBlueprint.js';
import { generateExpertiseAndBlueprint, BLUEPRINT_STYLE_VERSION } from './blueprintGenerator.js';
import { resolveCampaignInterviewLanguage } from '../interviewLanguage.js';

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

export interface EnsureBlueprintOptions {
    /**
     * Generate with BLUEPRINT_START_FAST_MODEL instead of the offline default.
     * Opt-in only: measured 2026-09-13, gpt-4o-mini still needs ~45 s for ten
     * Arabic competencies (and truncated them at the old 2200-token cap), so it
     * cannot finish inside a start wait either — speed buys nothing, and the
     * first blueprint to lock is the campaign's instrument for every candidate.
     * Any other generation still in flight simply finds the lock and yields.
     */
    fast?: boolean;
}

/** Model for the opt-in fast path. Empty (the default) keeps the fast path off. */
export function blueprintStartFastModel(): string {
    return (process.env.BLUEPRINT_START_FAST_MODEL || '').trim();
}

/**
 * One generation per campaign per process, however many callers ask meanwhile.
 * Campaign creation, every application, /prepare and /start all ask for the same
 * campaign within seconds of each other, and each used to pay a full LLM run.
 */
const inFlight = new Map<string, Promise<LockedBlueprintBundle | null>>();

/** Shares an in-flight promise per key; the entry is released when it settles. */
export function dedupeInFlight<T>(
    registry: Map<string, Promise<T>>,
    key: string,
    start: () => Promise<T>
): Promise<T> {
    const running = registry.get(key);
    if (running) return running;
    const task: Promise<T> = start().finally(() => {
        if (registry.get(key) === task) registry.delete(key);
    });
    registry.set(key, task);
    return task;
}

/** How many campaign generations this process is running right now (diagnostics). */
export function blueprintGenerationsInFlight(): number {
    return inFlight.size;
}

/** Is a generation for THIS campaign running right now? Keys are `${id}:${model}`. */
export function isBlueprintGenerating(campaignId: string): boolean {
    const id = (campaignId || '').trim();
    if (!id) return false;
    for (const key of inFlight.keys()) {
        if (key === id || key.startsWith(`${id}:`)) return true;
    }
    return false;
}

/** What the interview gate sees. `ready` is the only state that may start one. */
export type BlueprintReadinessState = 'ready' | 'generating' | 'absent';

export interface BlueprintReadiness {
    state: BlueprintReadinessState;
    competencyCount: number;
}

/**
 * Whether a campaign's interview instrument is ready to be interviewed against.
 *
 * ⚠️ A LOCK IS NOT READINESS. `/end` has always tested `competencies.length > 0`
 * separately before trusting a snapshot — an admission that locked-but-empty and
 * locked-but-partial both happen. Readiness therefore counts competencies rather
 * than trusting `status: 'locked'`.
 *
 * Why this exists at all: `resolveBlueprintForStart` waits 8 s and then starts
 * the interview without competencies. Measured on the deployed generator on
 * 2026-09-18 — 88 s, 92 s, 126 s, 132 s — so that wait effectively never pays,
 * and three consecutive public-path interviews ran blind while the scorer was
 * later handed the full rubric (coverage 0.22, 0.11, 0, 0.33; one scored zero).
 *
 * This reports state; it never waits. The caller decides.
 *
 * ⚠️ No campaign, or the feature switched off, reports `ready` with zero
 * competencies — ON PURPOSE. Such a session has no blueprint to wait for and
 * claims no specialism, so gating it would block interviews that were never at
 * risk. `competencyCount` is what tells those two apart from a real one.
 */
export async function blueprintReadiness(campaignId: string): Promise<BlueprintReadiness> {
    const id = (campaignId || '').trim();
    if (!id || !isBlueprintFeatureEnabled()) {
        return { state: 'ready', competencyCount: 0 };
    }
    const bundle = await getLockedBlueprintForCampaign(id).catch(() => null);
    const competencyCount = bundle?.blueprint?.competencies?.length ?? 0;
    if (competencyCount > 0) return { state: 'ready', competencyCount };
    return {
        state: isBlueprintGenerating(id) ? 'generating' : 'absent',
        competencyCount,
    };
}

/**
 * يضمن وجود Blueprint مقفل للحملة. idempotent: استدعاءان متتاليان ينتجان نسخة واحدة.
 * يرمي عند تعذّر إيجاد الحملة فقط؛ غير ذلك يُرجع الحزمة أو null (fail-open للمستدعي).
 */
export async function ensureBlueprintForCampaign(
    campaignId: string,
    options: EnsureBlueprintOptions = {}
): Promise<LockedBlueprintBundle | null> {
    const id = (campaignId || '').trim();
    if (!id) return null;
    if (!isBlueprintFeatureEnabled()) return null;
    const fastModel = options.fast ? blueprintStartFastModel() : '';
    // Fast path asked for but disabled by env: the caller falls back to waiting.
    if (options.fast && !fastModel) return null;
    return dedupeInFlight(inFlight, `${id}:${fastModel || 'default'}`, () =>
        ensureBlueprintForCampaignUncached(id, fastModel || undefined)
    );
}

async function ensureBlueprintForCampaignUncached(
    id: string,
    fastModel?: string
): Promise<LockedBlueprintBundle | null> {
    // 1) موجود ومقفل → أعِده فوراً (لا توليد مكرر).
    const existing = await getLockedBlueprintForCampaign(id);
    if (existing) {
        const stale = (existing.blueprint.styleVersion || '') !== BLUEPRINT_STYLE_VERSION;
        // The start path never retires a blueprint: a candidate is waiting, and a
        // stale-but-locked instrument beats none. The offline callers refresh it.
        if (!stale || fastModel) return existing;
        // The phrasing rules moved on. Retire this one and fall through to generate a
        // replacement; sessions already recorded keep their own blueprintSnapshot, so
        // past evaluations are untouched.
        try {
            await InterviewBlueprint.updateOne(
                { blueprintId: existing.blueprint.blueprintId, status: 'locked' },
                { $set: { status: 'superseded' } }
            ).exec();
            console.log(
                `♻️ Blueprint ${existing.blueprint.blueprintId} superseded for campaign ${id} ` +
                    `(style ${existing.blueprint.styleVersion || 'none'} → ${BLUEPRINT_STYLE_VERSION})`
            );
        } catch (err: any) {
            // Could not retire it — keep serving the old one rather than failing the
            // interview over phrasing.
            console.warn(`⚠️ could not supersede blueprint for ${id}:`, err?.message || err);
            return existing;
        }
    }

    // 2) اقرأ الحملة.
    const campaign = await RecruitmentCampaign.findOne({ campaignId: id }).lean();
    if (!campaign) {
        console.warn(`⚠️ ensureBlueprintForCampaign: campaign not found: ${id}`);
        return null;
    }

    const organizationId = campaign.organizationId;
    const createdByClerkUserId = campaign.createdByClerkUserId;

    /*
     * 3) ولّد Profile + Blueprint — **بلغة المقابلة نفسها**.
     *
     * لماذا يُمرَّر صراحةً: `detectLanguage` في المولّد
     * (`blueprintGenerator.ts:169`) يعيد `'ar'` في فرعيه كليهما — عربيةٌ
     * مثبّتة بالسلك، لا استنتاج. فكل مخطّطة تخرج عربية مهما كانت الحملة.
     * ولو ضبطنا لغة الوكيل على الإنجليزية دون هذا السطر لتكلّم الوكيل
     * الإنجليزية بينما تصله أهداف الكفاءات ومرتكزاتها وأدلّتها بالعربية —
     * أي استبدلنا عطباً بعطب.
     *
     * والحملة هي المصدر عمداً: لا يُستنتَج من نصّ المعايير. الحملات العربية
     * لا تتأثّر إطلاقاً — تُحسم إلى `'ar'` في الحالتين.
     *
     * ⚠️ والمخطّطة تُقفل مرّة واحدة: حملةٌ تحمل مخطّطة مقفلة تبقى بلغتها حتى
     * تُستبدل بـ`BLUEPRINT_STYLE_VERSION`. (قِيس 2026-09-23: صفر من ٤٣ حملة
     * إنتاجية إنجليزية، فلا حالة قائمة تحتاج إعادة توليد.)
     */
    const { language: interviewLanguage, source: interviewLanguageSource } =
        resolveCampaignInterviewLanguage(campaign as { interviewLanguage?: unknown; criteria?: Record<string, unknown> | null });
    console.log(
        `🗣️ ensureBlueprintForCampaign ${id}: generating in ${interviewLanguage} (source=${interviewLanguageSource})`
    );
    const generated = await generateExpertiseAndBlueprint(
        {
            criteria: (campaign.criteria && typeof campaign.criteria === 'object')
                ? (campaign.criteria as Record<string, any>)
                : {},
            jobAdvertisement: campaign.jobAdvertisement,
        },
        { language: interviewLanguage, ...(fastModel ? { model: fastModel } : {}) }
    );

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
            styleVersion: BLUEPRINT_STYLE_VERSION,
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
                `(mode=${fastModel ? `fast:${fastModel}` : 'default'}, ` +
                `domain=${generated.domain}, specialization=${generated.specialization || 'n/a'}, ` +
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
