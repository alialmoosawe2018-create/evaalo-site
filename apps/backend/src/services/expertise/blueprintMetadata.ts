// ============================================
// ملف: services/expertise/blueprintMetadata.ts
// الوظيفة: بناء حقول metadata الـBlueprint للوكيل (LiveKit) — Phase B glossary + tracks.
// ============================================

import type { LockedBlueprintBundle } from './ensureBlueprint.js';

/** حقول metadata التي يستهلكها video-interview-agent (Python worker). */
export interface BlueprintAgentMetadata {
    blueprint: string;
    expertise_prompt: string;
    domain_guidance: string;
    knowledge_depth: string;
    blueprint_content_version: string;
    pack_version: string;
    pack_match_confidence: string;
    blueprint_generated_at: string;
    role_key: string;
    career_level: string;
    management_track: string;
    match_source: string;
    profile_terminology: string;
    role_glossary: string;
    domain_pack_key: string;
    specialization: string;
}

const MAX_TERMINOLOGY_TERMS = 18;
const MAX_TERMINOLOGY_CHARS = 480;

/** الحد الأقصى لطول نص داخل metadata (حفاظاً على حجم metadata في LiveKit). */
export function trimMeta(s: unknown, max: number): string {
    const t = String(s || '').trim();
    return t.length > max ? `${t.slice(0, max)}…` : t;
}

function trimTerminologyList(terms?: unknown): string[] {
    if (!Array.isArray(terms)) return [];
    return terms
        .map((t) => trimMeta(t, 60))
        .filter(Boolean)
        .slice(0, MAX_TERMINOLOGY_TERMS);
}

function buildProfileTerminologyBlob(terms: string[]): string {
    if (!terms.length) return '';
    return terms.join(', ').slice(0, MAX_TERMINOLOGY_CHARS);
}

/**
 * يبني حقول metadata الخاصة بالـBlueprint للوكيل (الطبقات 2/3/4 + Phase B):
 *  - domain_guidance, expertise_prompt, blueprint (JSON مدمج مع tracks/paths/terminology)
 *  - profile_terminology + role_glossary لـ entity_policy
 *  - domain_pack_key, specialization, إصدارات الحزمة
 */
export function buildBlueprintMetadata(
    bundle: LockedBlueprintBundle | null
): BlueprintAgentMetadata | null {
    if (!bundle || !bundle.blueprint) return null;
    const { blueprint, profile } = bundle;
    const rr = (profile as Record<string, unknown> | null)?.roleResolution as Record<string, unknown> | undefined;
    const bpAny = blueprint as unknown as Record<string, unknown>;
    const terminologyList = trimTerminologyList(profile?.terminology);

    const compact: Record<string, unknown> = {
        language: blueprint.language,
        anchorQuestions: (blueprint.anchorQuestions || []).slice(0, 3).map((q) => trimMeta(q, 400)),
        competencies: (blueprint.competencies || []).slice(0, 6).map((c) => ({
            key: c.competencyKey,
            title: trimMeta(c.title, 120),
            objective: trimMeta(c.questionObjective, 300),
            evidence: (c.expectedEvidence || []).slice(0, 6).map((e) => trimMeta(e, 120)),
            redFlags: (c.redFlags || []).slice(0, 4).map((e) => trimMeta(e, 120)),
            followUps: (c.followUpRules || []).slice(0, 3).map((e) => trimMeta(e, 200)),
        })),
    };

    if (terminologyList.length) {
        compact.terminology = terminologyList;
    }

    const rawTracks = bpAny.experienceTracks || (profile as Record<string, unknown> | null)?.experienceTracks;
    if (Array.isArray(rawTracks) && rawTracks.length) {
        compact.experienceTracks = rawTracks.slice(0, 6).map((t: Record<string, unknown>) => ({
            trackKey: String(t.trackKey || ''),
            detectSignals: (t.detectSignals as unknown[] || []).slice(0, 12).map((s) => trimMeta(s, 80)),
            questionDifficulty: t.questionDifficulty,
            openingAnchors: (t.openingAnchors as unknown[] || []).slice(0, 3).map((q) => trimMeta(q, 350)),
            followUpHints: (t.followUpHints as unknown[] || []).slice(0, 3).map((q) => trimMeta(q, 200)),
        }));
    }

    const rawPaths = bpAny.interviewPaths || (profile as Record<string, unknown> | null)?.interviewPaths;
    if (Array.isArray(rawPaths) && rawPaths.length) {
        compact.interviewPaths = rawPaths.slice(0, 2).map((p: Record<string, unknown>) => ({
            pathKey: String(p.pathKey || ''),
            steps: ((p.steps as Record<string, unknown>[]) || []).slice(0, 10).map((s) => ({
                stepKey: String(s.stepKey || ''),
                competencyKey: s.competencyKey ? String(s.competencyKey) : undefined,
                topicLabel: trimMeta(s.topicLabel, 120),
                sampleQuestion: s.sampleQuestion ? trimMeta(s.sampleQuestion, 350) : undefined,
            })),
        }));
    }

    return {
        blueprint: JSON.stringify(compact),
        expertise_prompt: trimMeta(profile?.expertisePrompt, 2000),
        domain_guidance: trimMeta(profile?.domainGuidance, 1500),
        knowledge_depth: String(blueprint.knowledgeDepth || profile?.knowledgeDepth || ''),
        blueprint_content_version: String(
            blueprint.blueprintContentVersion || profile?.blueprintContentVersion || ''
        ),
        pack_version: String(blueprint.packVersion || profile?.packVersion || ''),
        pack_match_confidence: String(
            blueprint.packMatchConfidence || profile?.packMatchConfidence || ''
        ),
        blueprint_generated_at: (
            blueprint.blueprintGeneratedAt
            || profile?.blueprintGeneratedAt
            || new Date()
        ).toISOString(),
        role_key: String(profile?.roleKey || rr?.roleKey || ''),
        career_level: String(profile?.careerLevel || rr?.careerLevel || profile?.seniority || ''),
        management_track: String(profile?.managementTrack || rr?.managementTrack || ''),
        match_source: String(rr?.matchSource || ''),
        profile_terminology: buildProfileTerminologyBlob(terminologyList),
        role_glossary: terminologyList.length ? JSON.stringify(terminologyList) : '',
        domain_pack_key: String(profile?.domainPackKey || ''),
        specialization: trimMeta(profile?.specialization, 120),
    };
}

/** يحقن حقول Blueprint في metadata غرفة LiveKit (prepare + start). */
export function applyBlueprintMetadataToLiveKit(
    metadata: Record<string, string>,
    blueprintMeta: BlueprintAgentMetadata | null
): void {
    if (!blueprintMeta) return;

    metadata.blueprint = blueprintMeta.blueprint;

    const optional: Array<keyof BlueprintAgentMetadata> = [
        'expertise_prompt',
        'domain_guidance',
        'knowledge_depth',
        'blueprint_content_version',
        'pack_version',
        'pack_match_confidence',
        'blueprint_generated_at',
        'role_key',
        'career_level',
        'management_track',
        'match_source',
        'profile_terminology',
        'role_glossary',
        'domain_pack_key',
        'specialization',
    ];

    for (const key of optional) {
        const value = blueprintMeta[key];
        if (value) {
            metadata[key] = value;
        }
    }
}
