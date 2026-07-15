/**
 * Head Hunter configuration, callback allowlist, and search-criteria normalization.
 */

export const HEADHUNTER_ERROR = {
    NOT_CONFIGURED: 'HEADHUNTER_NOT_CONFIGURED',
    CALLBACK_NOT_CONFIGURED: 'HEADHUNTER_CALLBACK_NOT_CONFIGURED',
    CALLBACK_ORIGIN_DENIED: 'HEADHUNTER_CALLBACK_ORIGIN_DENIED',
} as const;

export type HeadHunterConfigErrorCode =
    (typeof HEADHUNTER_ERROR)[keyof typeof HEADHUNTER_ERROR];

export class HeadHunterConfigurationError extends Error {
    readonly code: HeadHunterConfigErrorCode;

    constructor(code: HeadHunterConfigErrorCode, message: string) {
        super(message);
        this.name = 'HeadHunterConfigurationError';
        this.code = code;
    }
}

const MAX_OPTION_LEN = 80;

const KNOWN_YEARS_EXPERIENCE = new Set(['0-1', '1-3', '3-5', '5-10', '10-plus']);
const KNOWN_AGE_RANGE = new Set(['18-24', '25-34', '35-44', '45-54', '55-plus']);

const YEARS_ALIASES: Record<string, string> = {
    '0-1': '0-1',
    '0 – 1': '0-1',
    '0 to 1': '0-1',
    '1-3': '1-3',
    '1 – 3': '1-3',
    '1 to 3': '1-3',
    '3-5': '3-5',
    '3 – 5': '3-5',
    '3 to 5': '3-5',
    '5-10': '5-10',
    '5 – 10': '5-10',
    '5 to 10': '5-10',
    '10-plus': '10-plus',
    '10+': '10-plus',
    '10 plus': '10-plus',
    '10 or more': '10-plus',
};

const AGE_ALIASES: Record<string, string> = {
    '18-24': '18-24',
    '18 – 24': '18-24',
    '25-34': '25-34',
    '25 – 34': '25-34',
    '35-44': '35-44',
    '35 – 44': '35-44',
    '45-54': '45-54',
    '45 – 54': '45-54',
    '55-plus': '55-plus',
    '55+': '55-plus',
    '55 plus': '55-plus',
};

export function resolveHeadHunterWebhookUrl(): string {
    return (process.env.N8N_HEADHUNTER_WEBHOOK_URL || '').trim();
}

export function assertHeadHunterWebhookConfigured(): string {
    const url = resolveHeadHunterWebhookUrl();
    if (!url) {
        throw new HeadHunterConfigurationError(
            HEADHUNTER_ERROR.NOT_CONFIGURED,
            'Head Hunter search is not configured.'
        );
    }
    return url;
}

/** Normalizes a URL to `protocol//host` for allowlist comparison. */
export function normalizeHeadHunterCallbackOrigin(url: string): string {
    const trimmed = url.trim();
    if (!trimmed) return '';
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error('unsupported protocol');
        }
        return `${parsed.protocol}//${parsed.host}`;
    } catch {
        throw new HeadHunterConfigurationError(
            HEADHUNTER_ERROR.CALLBACK_ORIGIN_DENIED,
            'Invalid callback origin URL.'
        );
    }
}

export function parseHeadHunterCallbackAllowlist(
    envValue: string | undefined = process.env.HEAD_HUNTER_CALLBACK_ALLOWLIST
): string[] {
    const raw = (envValue || '').trim();
    if (!raw) return [];
    const origins: string[] = [];
    for (const part of raw.split(',')) {
        const entry = part.trim();
        if (!entry) continue;
        origins.push(normalizeHeadHunterCallbackOrigin(entry));
    }
    return [...new Set(origins)];
}

export function assertHeadHunterCallbackAllowlistConfigured(
    envValue?: string | undefined
): string[] {
    const allowlist = parseHeadHunterCallbackAllowlist(envValue);
    if (allowlist.length === 0) {
        throw new HeadHunterConfigurationError(
            HEADHUNTER_ERROR.CALLBACK_NOT_CONFIGURED,
            'Head Hunter callback allowlist is not configured.'
        );
    }
    return allowlist;
}

export function isHeadHunterCallbackOriginAllowed(
    publicApiBase: string,
    envAllowlist?: string | undefined
): boolean {
    try {
        assertHeadHunterCallbackAllowlistConfigured(envAllowlist);
        const origin = normalizeHeadHunterCallbackOrigin(publicApiBase);
        const allowlist = parseHeadHunterCallbackAllowlist(envAllowlist);
        return allowlist.includes(origin);
    } catch {
        return false;
    }
}

export function assertHeadHunterCallbackOriginAllowed(
    publicApiBase: string,
    envAllowlist?: string | undefined
): void {
    const allowlist = assertHeadHunterCallbackAllowlistConfigured(envAllowlist);
    const origin = normalizeHeadHunterCallbackOrigin(publicApiBase);
    if (!allowlist.includes(origin)) {
        throw new HeadHunterConfigurationError(
            HEADHUNTER_ERROR.CALLBACK_ORIGIN_DENIED,
            'PUBLIC_API_URL origin is not allowlisted for Head Hunter callbacks.'
        );
    }
}

export function buildHeadHunterCallbackUrl(
    publicApiBase: string,
    searchId: string,
    callbackToken: string,
    envAllowlist?: string | undefined
): string {
    const base = publicApiBase.replace(/\/$/, '');
    assertHeadHunterCallbackOriginAllowed(base, envAllowlist);
    return `${base}/webhook/n8n/head-hunter?searchId=${encodeURIComponent(searchId)}&token=${encodeURIComponent(callbackToken)}`;
}

export type NormalizedExperienceField =
    | { kind: 'enum'; value: string }
    | { kind: 'custom'; value: string };

export type NormalizeTextFilterResult =
    | { ok: true; value: string }
    | { ok: false; error: string };

function collapseSpaces(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
}

function looksLikeUnsafeFilterText(value: string): boolean {
    if (/^[\s]*[{[<]/.test(value)) return true;
    if (/^\s*[\[{]/.test(value)) return true;
    if (/<\s*script/i.test(value)) return true;
    if (/javascript:/i.test(value)) return true;
    return false;
}

export function normalizeFilterTextInput(
    raw: unknown,
    fieldLabel: string,
    maxLen: number = MAX_OPTION_LEN
): NormalizeTextFilterResult {
    if (raw == null || raw === '') {
        return { ok: false, error: `${fieldLabel} must be a non-empty string` };
    }
    if (typeof raw !== 'string') {
        return { ok: false, error: `${fieldLabel} must be a string` };
    }
    const value = collapseSpaces(raw);
    if (!value) {
        return { ok: false, error: `${fieldLabel} must not be empty` };
    }
    if (value.length > maxLen) {
        return { ok: false, error: `${fieldLabel} must be at most ${maxLen} characters` };
    }
    if (looksLikeUnsafeFilterText(value)) {
        return { ok: false, error: `${fieldLabel} contains invalid characters` };
    }
    return { ok: true, value };
}

function matchKnownEnum(value: string, aliases: Record<string, string>, known: Set<string>): string | undefined {
    const collapsed = collapseSpaces(value).toLowerCase().replace(/–/g, '-');
    const fromAlias = aliases[collapsed] ?? aliases[value.toLowerCase()];
    if (fromAlias && known.has(fromAlias)) return fromAlias;
    if (known.has(collapsed)) return collapsed;
    return undefined;
}

export function normalizeYearsOfExperience(
    raw: unknown
): { ok: true; result?: NormalizedExperienceField } | { ok: false; error: string } {
    if (raw == null || raw === '') return { ok: true };
    const parsed = normalizeFilterTextInput(raw, 'yearsOfExperience');
    if (!parsed.ok) return parsed;
    const enumValue = matchKnownEnum(parsed.value, YEARS_ALIASES, KNOWN_YEARS_EXPERIENCE);
    if (enumValue) return { ok: true, result: { kind: 'enum', value: enumValue } };
    return { ok: true, result: { kind: 'custom', value: parsed.value } };
}

export function normalizeAgeRange(
    raw: unknown
): { ok: true; result?: NormalizedExperienceField } | { ok: false; error: string } {
    if (raw == null || raw === '') return { ok: true };
    const parsed = normalizeFilterTextInput(raw, 'ageRange');
    if (!parsed.ok) return parsed;
    const enumValue = matchKnownEnum(parsed.value, AGE_ALIASES, KNOWN_AGE_RANGE);
    if (enumValue) return { ok: true, result: { kind: 'enum', value: enumValue } };
    return { ok: true, result: { kind: 'custom', value: parsed.value } };
}

export interface ResolvedSearchExperienceFilters {
    yearsOfExperience?: string;
    ageRange?: string;
    optionalCriteriaExtras: Record<string, string>;
}

export function resolveSearchExperienceFilters(input: {
    yearsOfExperience?: unknown;
    ageRange?: unknown;
}): { ok: true; filters: ResolvedSearchExperienceFilters } | { ok: false; error: string } {
    const optionalCriteriaExtras: Record<string, string> = {};

    const yearsNorm = normalizeYearsOfExperience(input.yearsOfExperience);
    if (!yearsNorm.ok) return yearsNorm;
    let yearsOfExperience: string | undefined;
    if (yearsNorm.result) {
        if (yearsNorm.result.kind === 'enum') {
            yearsOfExperience = yearsNorm.result.value;
        } else {
            optionalCriteriaExtras.yearsOfExperience = yearsNorm.result.value;
        }
    }

    const ageNorm = normalizeAgeRange(input.ageRange);
    if (!ageNorm.ok) return ageNorm;
    let ageRange: string | undefined;
    if (ageNorm.result) {
        if (ageNorm.result.kind === 'enum') {
            ageRange = ageNorm.result.value;
        } else {
            optionalCriteriaExtras.ageRange = ageNorm.result.value;
        }
    }

    return { ok: true, filters: { yearsOfExperience, ageRange, optionalCriteriaExtras } };
}
