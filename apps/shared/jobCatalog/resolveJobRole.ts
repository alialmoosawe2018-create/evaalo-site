import { resolutionFromCriteriaFields } from './catalogOptions.js';
import { AMBIGUOUS_LEGACY_TITLES, LEGACY_TITLE_ALIASES } from './legacyAliases.js';
import {
    findCatalogEntryByDisplayTitle,
    JOB_CATALOG,
    normalizeTitle,
} from './buildCatalog.js';
import type {
    CareerLevel,
    JobCatalogEntry,
    ManagementTrack,
    RoleResolution,
} from './types.js';

const LEVEL_PREFIXES: { prefix: RegExp; level: CareerLevel }[] = [
    { prefix: /^senior\s+/i, level: 'senior' },
    { prefix: /^lead\s+/i, level: 'lead' },
    { prefix: /^junior\s+/i, level: 'junior' },
    { prefix: /^graduate\s+/i, level: 'graduate' },
    { prefix: /^chief\s+/i, level: 'executive' },
    { prefix: /^head of\s+/i, level: 'head' },
];

const AMBIGUOUS_SET = new Set(AMBIGUOUS_LEGACY_TITLES.map((t) => normalizeTitle(t)));

const LEGACY_MAP = LEGACY_TITLE_ALIASES;

function entryToResolution(
    entry: JobCatalogEntry,
    matchSource: RoleResolution['matchSource'],
    confidence: number
): RoleResolution {
    return {
        roleKey: entry.roleKey,
        careerLevel: entry.careerLevel,
        managementTrack: entry.managementTrack,
        displayTitle: entry.displayTitle,
        labelKey: entry.labelKey,
        domain: entry.domain,
        specialization: entry.specialization,
        confidence,
        matchSource,
    };
}

function aliasToResolution(alias: (typeof LEGACY_MAP)[string]): RoleResolution {
    return {
        roleKey: alias.roleKey,
        careerLevel: alias.careerLevel,
        managementTrack: alias.managementTrack,
        displayTitle: alias.displayTitle,
        labelKey: alias.labelKey,
        confidence: 0.85,
        matchSource: 'legacy_alias',
    };
}

function inferLevelFromPrefix(raw: string): { stripped: string; level?: CareerLevel } {
    let text = raw.trim();
    for (const { prefix, level } of LEVEL_PREFIXES) {
        if (prefix.test(text)) {
            return { stripped: text.replace(prefix, '').trim(), level };
        }
    }
    return { stripped: text };
}

/** Min length before suffix/prefix fuzzy matching — short tokens like "st"/"er" match too many titles. */
const FUZZY_MIN_TOKEN_LEN = 4;

/**
 * A weak fuzzy hit is not a role.
 *
 * `fuzzyMatchCatalog` always reports 0.65, and its `endsWith` branches let any title
 * that merely ENDS in a catalog title's generic base land on an unrelated role: 22
 * catalog entries reduce to a single generic noun ("Junior Specialist" → "specialist",
 * "Partner" → "partner"), so "Payroll Specialist" became `graduate_trainee` and
 * "Talent Acquisition Partner" became `lawyer`. Measured against the deployed build:
 * of 452 realistic non-catalog titles that got a roleKey, 176 were wrong (135 landing
 * in a different domain); 151 of the 179 roles can be reached this way.
 *
 * The picker already refuses these in the browser — PositionSuggestCombobox accepts a
 * fuzzy hit only at confidence >= 0.85 — but the server had no such floor, so the exact
 * strings the UI rejects were the ones the backend resolved wrongly. This applies the
 * same rule wherever the server resolves free text.
 *
 * Because fuzzy is hardcoded to 0.65 this currently rejects every fuzzy hit, including
 * the ~179 it happened to get right. That trade is deliberate: a null roleKey degrades
 * safely (the generator falls back to the recruiter's own title), a wrong one does not.
 */
export const MIN_FREE_TEXT_CONFIDENCE = 0.85;
const MIN_FREE_TEXT_LENGTH = 4;

/**
 * Downgrade a below-floor fuzzy hit to the same shape as "no match".
 *
 * Reuses the existing `unknown` matchSource rather than adding a union member: callers
 * already treat `unknown` as "no catalog role" (see blueprintGenerator's
 * `hasCatalogRoleKey`), and keeping `displayTitle` as the raw input stops a fuzzy
 * catalog title from overwriting what the recruiter actually typed.
 */
function rejectWeakFuzzy(resolution: RoleResolution, raw: string): RoleResolution {
    if (!resolution.roleKey || resolution.matchSource !== 'fuzzy') return resolution;

    const trimmed = raw.trim();
    if (
        resolution.confidence >= MIN_FREE_TEXT_CONFIDENCE
        && trimmed.length >= MIN_FREE_TEXT_LENGTH
    ) {
        return resolution;
    }

    const { level: prefixLevel } = inferLevelFromPrefix(trimmed);
    return {
        roleKey: null,
        careerLevel: prefixLevel ?? 'mid',
        managementTrack: 'ic',
        displayTitle: trimmed,
        confidence: 0.2,
        matchSource: 'unknown',
    };
}

function fuzzyMatchCatalog(raw: string): RoleResolution | null {
    const { stripped, level: prefixLevel } = inferLevelFromPrefix(raw);
    const normStripped = normalizeTitle(stripped);
    if (!normStripped) return null;

    // Match display titles that contain or equal stripped base
    const candidates = JOB_CATALOG.filter((e) => {
        const normDisplay = normalizeTitle(e.displayTitle);
        if (normDisplay === normStripped) return true;
        // Require enough characters for endsWith — otherwise "st" → Customer Success Specialist
        if (normStripped.length < FUZZY_MIN_TOKEN_LEN) return false;
        const baseDisplay = normDisplay.replace(/^(senior|junior|lead)\s+/, '');
        return (
            normDisplay.endsWith(normStripped)
            || normStripped.endsWith(baseDisplay)
        );
    });

    if (!candidates.length) return null;

    let best = candidates[0];
    if (prefixLevel) {
        const levelMatch = candidates.find((c) => c.careerLevel === prefixLevel);
        if (levelMatch) best = levelMatch;
    } else {
        // Prefer mid level as default base title match
        const mid = candidates.find((c) => c.careerLevel === 'mid');
        if (mid) best = mid;
    }

    return entryToResolution(best, 'fuzzy', 0.65);
}

/**
 * Resolve a job title string to structured role fields.
 * Does NOT set knowledgeDepth — that belongs in blueprintGenerator only.
 */
export function resolveJobRole(input: string): RoleResolution {
    const raw = String(input || '').trim();
    if (!raw) {
        return {
            roleKey: null,
            careerLevel: 'mid',
            managementTrack: 'ic',
            displayTitle: '',
            confidence: 0,
            matchSource: 'unknown',
        };
    }

    const norm = normalizeTitle(raw);

    // 1) Ambiguous legacy — never map to a fixed specialization
    if (AMBIGUOUS_SET.has(norm)) {
        const { level: prefixLevel } = inferLevelFromPrefix(raw);
        return {
            roleKey: null,
            careerLevel: prefixLevel ?? 'mid',
            managementTrack: 'ic',
            displayTitle: raw,
            confidence: 0.3,
            matchSource: 'ambiguous_legacy',
        };
    }

    // 2) Safe legacy alias (exact key match on original casing keys)
    for (const [legacyTitle, target] of Object.entries(LEGACY_MAP)) {
        if (normalizeTitle(legacyTitle) === norm) {
            return aliasToResolution(target);
        }
    }

    // 3) Exact catalog match on displayTitle
    const exact = findCatalogEntryByDisplayTitle(raw);
    if (exact) {
        return entryToResolution(exact, 'exact_catalog', 0.95);
    }

    // 4) Fuzzy: strip level prefix + match base role
    const fuzzy = fuzzyMatchCatalog(raw);
    if (fuzzy) return fuzzy;

    const { level: prefixLevel } = inferLevelFromPrefix(raw);
    return {
        roleKey: null,
        careerLevel: prefixLevel ?? 'mid',
        managementTrack: 'ic',
        displayTitle: raw,
        confidence: 0.2,
        matchSource: 'unknown',
    };
}

/** Resolve from campaign criteria — prefers structured fields when present. */
export function resolveJobRoleFromCriteria(criteria?: Record<string, unknown>): RoleResolution {
    if (!criteria || typeof criteria !== 'object') {
        return resolveJobRole('');
    }

    const roleKey = typeof criteria.roleKey === 'string' ? criteria.roleKey.trim() : '';
    const careerLevel = typeof criteria.careerLevel === 'string' ? criteria.careerLevel.trim() : '';
    const labelKey = typeof criteria.labelKey === 'string' ? criteria.labelKey.trim() : '';

    if (labelKey) {
        const byLabel = JOB_CATALOG.find((e) => e.labelKey === labelKey);
        if (byLabel) {
            return entryToResolution(byLabel, 'exact_catalog', 0.98);
        }
    }

    if (roleKey) {
        const structured = resolutionFromCriteriaFields({
            roleKey,
            careerLevel: careerLevel || undefined,
            labelKey: labelKey || undefined,
            managementTrack: criteria.managementTrack,
            position: criteria.position,
            job: criteria.job,
        });
        if (structured) {
            return {
                ...structured,
                confidence: structured.confidence ?? 0.98,
                matchSource: structured.matchSource ?? 'exact_catalog',
            };
        }
    }

    const position = String(
        criteria.position || criteria.job || criteria.jobTitle || criteria.title || ''
    ).trim();
    // Server-side free text: no structured roleKey survived, so apply the confidence
    // floor the picker applies in the browser.
    return rejectWeakFuzzy(resolveJobRole(position), position);
}

export function isAmbiguousLegacyTitle(title: string): boolean {
    return AMBIGUOUS_SET.has(normalizeTitle(title));
}
