/**
 * Stage 3 inbound callback normalizer.
 *
 * Flexible on known legacy / nested payload shapes; output is a unified record
 * for buildStrictStage3VideoPatch (strict persistence contract).
 *
 * Does NOT use forceVideo or opportunistic merge into unrelated fields.
 */

const INVALID_TOKENS = new Set(['', 'undefined', 'null', 'nan']);

const VIDEO_COMPETENCY_FIELDS: Array<[canonical: string, aliases: string[]]> = [
    ['role_understanding', ['role_understanding', 'Role Understanding', 'roleUnderstanding']],
    ['professional_depth', ['professional_depth', 'Professional Depth', 'professionalDepth']],
    ['problem_handling', ['problem_handling', 'Problem Handling', 'problemHandling']],
    ['decision_making', ['decision_making', 'Decision Making', 'decisionMaking']],
    ['prioritization', ['prioritization', 'Prioritization']],
    ['process_thinking', ['process_thinking', 'Process Thinking', 'processThinking']],
    ['responsibility', ['responsibility', 'Responsibility']],
    ['learning_ability', ['learning_ability', 'Learning Ability', 'learningAbility']],
    ['job_readiness', ['job_readiness', 'Job Readiness', 'jobReadiness']],
    ['final_role_fit', ['final_role_fit', 'Final Role Fit', 'finalRoleFit']],
];

const OVERALL_SCORE_ALIASES = [
    'overall_score',
    'Overall Score',
    'overallScore',
    'score',
    'Score',
    'match_score',
    'matchScore',
    'fit_score',
    'fitScore',
    'percentage',
    'percent',
    'total_score',
    'final_score',
    'evaluation_score',
];

const RECOMMENDATION_ALIASES = ['recommendation', 'Recommendation', 'Final HR Recommendation'];

const SUMMARY_ALIASES = ['summary', 'Summary'];

const COMPETENCY_SCORES_ALIASES = ['competencyScores', 'competency_scores'];

/** Metadata preserved for gate / ingress (not part of video eval patch). */
const METADATA_KEYS = new Set([
    'id',
    '_id',
    'candidateId',
    'candidate',
    'sessionId',
    'session_id',
    'campaignId',
    'organizationId',
    'ingress',
    'rejectCode',
    'reject_code',
    'evaluationSource',
    'evaluation_source',
    'stage',
    'evaluationStage',
    'event',
    'status',
    'notes',
    'comments',
    'files',
    'body',
    'json',
]);

function toLooseKey(key: string): string {
    return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function pickLoose(obj: unknown, aliases: string[]): unknown {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
    const rec = obj as Record<string, unknown>;
    const wanted = new Set(aliases.map((a) => toLooseKey(a)));
    for (const [k, v] of Object.entries(rec)) {
        if (wanted.has(toLooseKey(k))) return v;
    }
    return undefined;
}

function pickLooseFromSources(sources: unknown[], aliases: string[]): unknown {
    for (const src of sources) {
        const v = pickLoose(src, aliases);
        if (v === undefined || v === null) continue;
        if (Array.isArray(v)) return v;
        const s = String(v).trim();
        if (!s || INVALID_TOKENS.has(s.toLowerCase())) continue;
        return v;
    }
    return undefined;
}

function parseNestedRecord(raw: unknown): Record<string, unknown> | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed || INVALID_TOKENS.has(trimmed.toLowerCase())) return undefined;
        try {
            const parsed = JSON.parse(trimmed) as unknown;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
            return undefined;
        } catch {
            return undefined;
        }
    }
    if (typeof raw === 'object' && !Array.isArray(raw)) {
        return raw as Record<string, unknown>;
    }
    return undefined;
}

function isMeaningfulValue(raw: unknown): boolean {
    if (raw === undefined || raw === null) return false;
    if (typeof raw === 'string') {
        const s = raw.trim();
        return Boolean(s) && !INVALID_TOKENS.has(s.toLowerCase());
    }
    if (typeof raw === 'number') return Number.isFinite(raw);
    if (Array.isArray(raw)) return raw.length > 0;
    return true;
}

function mergeVideoField(
    target: Record<string, unknown>,
    key: string,
    value: unknown,
    preferExisting: boolean
): void {
    if (!isMeaningfulValue(value)) return;
    if (preferExisting && target[key] !== undefined) return;
    target[key] = value;
}

function collectFromSources(
    target: Record<string, unknown>,
    sources: unknown[],
    preferExisting: boolean
): void {
    for (const [canonical, aliases] of VIDEO_COMPETENCY_FIELDS) {
        mergeVideoField(target, canonical, pickLooseFromSources(sources, aliases), preferExisting);
    }
    mergeVideoField(target, 'summary', pickLooseFromSources(sources, SUMMARY_ALIASES), preferExisting);
    mergeVideoField(
        target,
        'overall_score',
        pickLooseFromSources(sources, OVERALL_SCORE_ALIASES),
        preferExisting
    );
    mergeVideoField(
        target,
        'recommendation',
        pickLooseFromSources(sources, RECOMMENDATION_ALIASES),
        preferExisting
    );
    const compScores = pickLooseFromSources(sources, COMPETENCY_SCORES_ALIASES);
    if (isMeaningfulValue(compScores)) {
        mergeVideoField(target, 'competencyScores', compScores, preferExisting);
    }
}

function unwrapWebhookBody(raw: Record<string, unknown>): Record<string, unknown> {
    const body = parseNestedRecord(raw.body) ?? parseNestedRecord(raw.json);
    if (!body) return raw;
    return { ...body, ...raw };
}

function normalizeEvaluationSourceToken(raw: unknown): string {
    if (raw === undefined || raw === null) return '';
    return String(raw).trim().toLowerCase();
}

/** @internal test helper */
export function isKnownStage3VideoCallbackShape(raw: Record<string, unknown>): boolean {
    const src = normalizeEvaluationSourceToken(
        pickLoose(raw, ['evaluationSource', 'evaluation_source'])
    );
    if (src === 'video' || src === 'video_interview') return true;
    const stage = raw.stage ?? raw.evaluationStage;
    if (stage === 3 || stage === '3') return true;
    const ev = raw.event;
    if (typeof ev === 'string' && ev.toLowerCase().includes('video')) return true;

    const nested = parseNestedRecord(raw.videoInterviewEvaluation);
    if (nested && Object.keys(nested).length > 0) return true;

    for (const [canonical] of VIDEO_COMPETENCY_FIELDS) {
        if (raw[canonical] !== undefined) return true;
    }
    if (pickLoose(raw, OVERALL_SCORE_ALIASES) !== undefined) return true;
    return false;
}

function hasVideoEvaluationFields(evalRec: Record<string, unknown>): boolean {
    for (const [canonical] of VIDEO_COMPETENCY_FIELDS) {
        if (evalRec[canonical] !== undefined) return true;
    }
    if (evalRec.summary !== undefined) return true;
    if (evalRec.overall_score !== undefined) return true;
    if (evalRec.recommendation !== undefined) return true;
    if (evalRec.competencyScores !== undefined) return true;
    return false;
}

function extractMetadata(raw: Record<string, unknown>): Record<string, unknown> {
    const meta: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
        if (METADATA_KEYS.has(k)) meta[k] = v;
    }
    const evalSrc = pickLoose(raw, ['evaluationSource', 'evaluation_source']);
    if (evalSrc !== undefined) meta.evaluationSource = evalSrc;
    return meta;
}

/**
 * Accept known legacy / nested Stage 3 callback shapes and produce a unified record:
 * - metadata fields for gate / ingress
 * - `videoInterviewEvaluation` object with canonical snake_case keys
 *
 * Priority per field (first wins): top-level flat → videoInterviewEvaluation → evaluation → aiEvaluation
 */
export function normalizeStage3CallbackPayload(raw: Record<string, unknown>): Record<string, unknown> {
    const unwrapped = unwrapWebhookBody(raw);
    const videoEval: Record<string, unknown> = {};

    const nestedVideo = parseNestedRecord(unwrapped.videoInterviewEvaluation);
    const nestedEvaluation = parseNestedRecord(unwrapped.evaluation);
    const nestedAi = parseNestedRecord(unwrapped.aiEvaluation);

    const sourceLayers: unknown[][] = [
        [unwrapped],
        [nestedVideo],
        [nestedEvaluation],
        [nestedAi],
    ];

    for (const layer of sourceLayers) {
        collectFromSources(videoEval, layer, true);
    }

    const meta = extractMetadata(unwrapped);
    const normalized: Record<string, unknown> = { ...meta };

    if (hasVideoEvaluationFields(videoEval)) {
        normalized.videoInterviewEvaluation = videoEval;
    }

    if (
        !normalized.evaluationSource &&
        (isKnownStage3VideoCallbackShape(unwrapped) || hasVideoEvaluationFields(videoEval))
    ) {
        normalized.evaluationSource = 'video';
    }

    if (nestedAi && !hasVideoEvaluationFields(nestedAi)) {
        normalized.aiEvaluation = nestedAi;
    }

    return normalized;
}

/** @internal test helper — canonical video eval only (no metadata). */
export function extractNormalizedStage3VideoEval(
    raw: Record<string, unknown>
): Record<string, unknown> {
    const normalized = normalizeStage3CallbackPayload(raw);
    const nested = normalized.videoInterviewEvaluation;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        return { ...(nested as Record<string, unknown>) };
    }
    return {};
}
