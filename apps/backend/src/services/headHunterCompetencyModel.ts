/**
 * Background job-competency model for Head Hunter searches.
 *
 * Head Hunter used to send n8n nothing but the recruiter's own filters, so the
 * ranking could only ever be as deep as the boxes they ticked. This builds — in
 * the background, never shown to the recruiter and never edited by them — the
 * competency model of the role being searched for, so n8n can judge a profile
 * against what the job actually requires *alongside* the stated criteria.
 *
 * It reuses the engine behind the video interview (`services/expertise/`), which
 * already matches a deep domain pack and customises it with an LLM. That entry
 * point is campaign-free: it takes a plain criteria object, which is exactly
 * what a search is.
 *
 * Two properties matter more than richness here:
 *   1. A search must NEVER fail because of this. Every path returns `null`
 *      instead of throwing, and the caller treats `null` as "search anyway".
 *   2. A search must never WAIT on an LLM. Customising a blueprint takes 75-110
 *      seconds — fine for the video interview, which does it once per campaign
 *      out of band, and hopeless for a request a recruiter is watching. So this
 *      runs in two tiers:
 *
 *        instant — the curated domain pack for the role, matched deterministically
 *                  in milliseconds. Real competencies with evidence and red flags;
 *                  this is what the current search goes out with.
 *        upgrade — the full LLM customisation, started in the background and
 *                  written to the cache. Later searches for the same role get it.
 *
 *      Results are cached per role signature, so it is one upgrade per role, not
 *      one per search.
 */

import {
    generateExpertiseAndBlueprint,
    type GeneratedExpertise,
} from './expertise/blueprintGenerator.js';
import {
    matchDomainPackByRoleKeyWithConfidence,
    matchDomainPackWithConfidence,
    shouldUseDeepPackMatch,
    type DomainPack,
    type PackMatchResult,
} from './expertise/domainPacks.js';
import { resolveJobRoleFromCriteria } from '../shared/jobCatalog/resolveJobRole.js';

/** One competency, trimmed to what a profile-ranking prompt can actually use. */
export interface HeadHunterCompetency {
    key: string;
    title: string;
    priority: 'critical' | 'high' | 'medium';
    /** What, in a candidate profile, counts as evidence for this competency. */
    evidence: string[];
    /** What argues against it. */
    redFlags: string[];
}

/** The compact snapshot sent to n8n. */
export interface HeadHunterCompetencyModel {
    roleTitle: string;
    roleSummary: string;
    domain: string;
    specialization: string;
    seniority: string;
    requiredSkills: string[];
    toolsAndSystems: string[];
    competencies: HeadHunterCompetency[];
    source: GeneratedExpertise['generationSource'];
    knowledgeDepth: GeneratedExpertise['knowledgeDepth'];
    generatedAt: string;
}

export interface HeadHunterCompetencyInput {
    position: string;
    location?: string;
    query?: string;
    /** The recruiter's optional filters, as forwarded to n8n. */
    criteria?: Record<string, string>;
}

/** Off switch, independent of the video interview's own blueprint flag. */
export function isHeadHunterCompetencyModelEnabled(): boolean {
    return process.env.HEADHUNTER_COMPETENCY_MODEL !== 'false';
}

// Keep the payload small: n8n has to fit this into a prompt.
const MAX_COMPETENCIES = 8;
const MAX_EVIDENCE = 4;
const MAX_RED_FLAGS = 3;
const MAX_SKILLS = 12;
const MAX_TOOLS = 10;
const MAX_SUMMARY_CHARS = 600;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

interface CacheEntry {
    model: HeadHunterCompetencyModel;
    expiresAt: number;
}

const modelCache = new Map<string, CacheEntry>();
/** Background upgrades in progress, so parallel searches share a single call. */
const upgradesInFlight = new Set<string>();

function text(value: unknown, max = 240): string {
    const s = String(value ?? '').trim().replace(/\s+/g, ' ');
    return s.length > max ? s.slice(0, max) : s;
}

function list(value: unknown, limit: number, max = 160): string[] {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const item of value) {
        const s = text(item, max);
        if (s) out.push(s);
        if (out.length >= limit) break;
    }
    return out;
}

/**
 * The criteria that actually change the competency model of a *role*.
 *
 * Everything else the recruiter can filter on (languages, certifications,
 * company, gender, age…) narrows who matches; it does not change what the job
 * requires. Keying the cache on just these keeps one LLM call per role rather
 * than one per search, which is the whole point of caching here.
 */
const ROLE_SHAPING_KEYS = ['yearsOfExperience', 'industryType', 'jobLevel', 'educationLevel'];

function cacheKeyFor(input: HeadHunterCompetencyInput): string {
    const parts = [text(input.position, 120).toLowerCase()];
    for (const key of ROLE_SHAPING_KEYS) {
        const value = text(input.criteria?.[key], 80).toLowerCase();
        if (value) parts.push(`${key}=${value}`);
    }
    return parts.join('|');
}

function rememberModel(key: string, model: HeadHunterCompetencyModel): void {
    if (modelCache.size >= CACHE_MAX_ENTRIES) {
        // Insertion-ordered: drop the oldest key. Good enough for a warm cache.
        const oldest = modelCache.keys().next().value;
        if (oldest !== undefined) modelCache.delete(oldest);
    }
    modelCache.set(key, { model, expiresAt: Date.now() + CACHE_TTL_MS });
}

function readCache(key: string): HeadHunterCompetencyModel | null {
    const hit = modelCache.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
        modelCache.delete(key);
        return null;
    }
    return hit.model;
}

/** Shrink the full generated expertise down to what n8n needs to rank profiles. */
function toSnapshot(expertise: GeneratedExpertise): HeadHunterCompetencyModel {
    const competencies: HeadHunterCompetency[] = [];
    for (const c of expertise.competencies || []) {
        const title = text(c?.title, 120);
        if (!title) continue;
        competencies.push({
            key: text(c?.competencyKey, 80) || title.toLowerCase().replace(/\s+/g, '_'),
            title,
            priority: c?.priority === 'critical' || c?.priority === 'high' ? c.priority : 'medium',
            evidence: list(c?.expectedEvidence, MAX_EVIDENCE),
            redFlags: list(c?.redFlags, MAX_RED_FLAGS),
        });
        if (competencies.length >= MAX_COMPETENCIES) break;
    }

    return {
        roleTitle: text(expertise.jobTitle, 160),
        roleSummary: text(expertise.roleSummary, MAX_SUMMARY_CHARS),
        domain: text(expertise.domain, 120),
        specialization: text(expertise.specialization, 160),
        seniority: text(expertise.seniority, 80),
        requiredSkills: list(expertise.requiredSkills, MAX_SKILLS),
        toolsAndSystems: list(expertise.toolsAndSystems, MAX_TOOLS),
        competencies,
        source: expertise.generationSource,
        knowledgeDepth: expertise.knowledgeDepth,
        generatedAt: expertise.generatedAt,
    };
}

/**
 * The instant tier: the curated domain pack for this role, with no LLM call.
 *
 * This is the same pack the video interview's generator uses as its backbone, so
 * a search ranks against real, human-curated competencies from the first search
 * onward — not from the second.
 */
function packModel(input: HeadHunterCompetencyInput): HeadHunterCompetencyModel | null {
    try {
        const criteria = toGeneratorCriteria(input);
        const roleResolution = resolveJobRoleFromCriteria(criteria);
        const jobTitle = text(input.position, 160);
        const haystack = [jobTitle, text(input.query, 400), Object.values(criteria).join(' ')]
            .filter(Boolean)
            .join(' ');

        let match: PackMatchResult | null = null;
        if (roleResolution.roleKey && roleResolution.matchSource !== 'ambiguous_legacy') {
            match = matchDomainPackByRoleKeyWithConfidence(roleResolution.roleKey);
        }
        if (!match?.pack) {
            match = matchDomainPackWithConfidence(haystack, jobTitle, roleResolution.domain);
        }
        if (!match || !match.pack || !shouldUseDeepPackMatch(match)) return null;

        const pack: DomainPack = match.pack;
        const competencies: HeadHunterCompetency[] = [];
        for (const c of pack.competencies || []) {
            const title = text(c?.title, 120);
            if (!title) continue;
            competencies.push({
                key: text(c?.competencyKey, 80) || title.toLowerCase().replace(/\s+/g, '_'),
                title,
                priority: c?.priority === 'critical' || c?.priority === 'high' ? c.priority : 'medium',
                evidence: list(c?.expectedEvidence, MAX_EVIDENCE),
                redFlags: list(c?.redFlags, MAX_RED_FLAGS),
            });
            if (competencies.length >= MAX_COMPETENCIES) break;
        }
        if (competencies.length === 0) return null;

        return {
            roleTitle: jobTitle || text(roleResolution.displayTitle, 160),
            roleSummary: text(
                jobTitle ? `${jobTitle} — ${pack.specialization}` : pack.specialization,
                MAX_SUMMARY_CHARS
            ),
            domain: text(pack.domain, 120),
            specialization: text(pack.specialization, 160),
            seniority: text(roleResolution.careerLevel, 80),
            requiredSkills: list(pack.terminology, MAX_SKILLS),
            toolsAndSystems: [],
            competencies,
            source: 'pack_fallback',
            knowledgeDepth: 'deep_pack',
            generatedAt: new Date().toISOString(),
        };
    } catch (err) {
        console.warn(
            '[head-hunter] pack competency model failed:',
            err instanceof Error ? err.message : err
        );
        return null;
    }
}

/** Shape the search inputs the way the generator expects to read criteria. */
function toGeneratorCriteria(input: HeadHunterCompetencyInput): Record<string, string> {
    const criteria: Record<string, string> = {};
    const position = text(input.position, 160);
    if (position) criteria.position = position;
    const location = text(input.location, 120);
    if (location) criteria.location = location;
    for (const [key, value] of Object.entries(input.criteria || {})) {
        const v = text(value, 240);
        if (v) criteria[key] = v;
    }
    return criteria;
}

/**
 * The upgrade tier: the full LLM customisation, run in the background purely to
 * warm the cache. Nobody awaits this, so it must never reject.
 */
function startUpgrade(key: string, input: HeadHunterCompetencyInput): void {
    if (upgradesInFlight.has(key)) return;
    upgradesInFlight.add(key);
    const startedAt = Date.now();
    void generateExpertiseAndBlueprint({
        criteria: toGeneratorCriteria(input),
        // The free-text query is the closest thing a search has to a job ad.
        jobAdvertisement: text(input.query, 1500) || undefined,
    })
        .then((expertise) => {
            const snapshot = toSnapshot(expertise);
            // An empty model is worse than none: it would tell n8n to rank against
            // nothing while looking like a real instruction.
            if (snapshot.competencies.length === 0) return;
            rememberModel(key, snapshot);
            console.log(
                `[head-hunter] competency model upgraded for "${key}" ` +
                    `(${snapshot.competencies.length} competencies, ${Date.now() - startedAt}ms)`
            );
        })
        .catch((err) => {
            console.warn(
                '[head-hunter] competency model upgrade failed:',
                err instanceof Error ? err.message : err
            );
        })
        .finally(() => {
            upgradesInFlight.delete(key);
        });
}

/**
 * The model for this search, or `null` when it is disabled or the role matches
 * no curated pack and nothing is cached yet. Callers must treat `null` as
 * "search anyway" — this never throws and never blocks on the network.
 */
export async function buildHeadHunterCompetencyModel(
    input: HeadHunterCompetencyInput
): Promise<HeadHunterCompetencyModel | null> {
    if (!isHeadHunterCompetencyModelEnabled()) return null;
    if (!text(input.position)) return null;

    const key = cacheKeyFor(input);
    const cached = readCache(key);
    if (cached) return cached;

    // Nothing cached: warm it for next time, and answer now from the pack.
    startUpgrade(key, input);
    return packModel(input);
}

/** Test/ops hook — drops every cached model. */
export function clearHeadHunterCompetencyCache(): void {
    modelCache.clear();
}
