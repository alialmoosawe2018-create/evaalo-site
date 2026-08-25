export const STAGE3_INCOMPLETE_EVALUATION_ERROR = 'STAGE3_INCOMPLETE_EVALUATION' as const;

export const STAGE3_INCOMPLETE_EVALUATION_MESSAGE =
    'Stage 3 evaluation must include all video competency fields, summary, overall score, and recommendation.';

export type Stage3EvaluationGateMode = 'observe' | 'enforce';

export type Stage3VideoEvaluationValidationResult =
    | { ok: true }
    | {
          ok: false;
          error: typeof STAGE3_INCOMPLETE_EVALUATION_ERROR;
          message: string;
          issues: string[];
      };

const STAGE3_VIDEO_COMPETENCY_FIELDS = [
    'role_understanding',
    'professional_depth',
    'problem_handling',
    'decision_making',
    'prioritization',
    'process_thinking',
    'responsibility',
    'learning_ability',
    'job_readiness',
    'final_role_fit',
] as const;

function normalizeToken(raw: unknown): string {
    if (raw === undefined || raw === null) return '';
    return String(raw).trim().toLowerCase();
}

function pickLoose(obj: unknown, aliases: string[]): unknown {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
    const rec = obj as Record<string, unknown>;
    const wanted = new Set(aliases.map((a) => a.toLowerCase().replace(/[^a-z0-9]/g, '')));
    for (const [k, v] of Object.entries(rec)) {
        if (wanted.has(k.toLowerCase().replace(/[^a-z0-9]/g, ''))) return v;
    }
    return undefined;
}

const INVALID_STAGE3_TEXT_TOKENS = new Set(['undefined', 'null', 'nan', '']);

function isValidStage3MeaningfulText(raw: unknown): boolean {
    if (raw === undefined || raw === null) return false;
    const s = String(raw).trim();
    if (!s || INVALID_STAGE3_TEXT_TOKENS.has(s.toLowerCase())) return false;
    return true;
}

function parseStage3OverallScore(raw: unknown): number | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return Math.max(0, Math.min(100, raw));
    }
    if (typeof raw === 'string') {
        const s = raw.trim();
        const frac = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
        if (frac) {
            const num = parseFloat(frac[1]);
            const den = parseFloat(frac[2]);
            if (den > 0 && Number.isFinite(num)) {
                if (den <= 10) return Math.max(0, Math.min(100, num * 10));
                return Math.max(0, Math.min(100, num));
            }
            return undefined;
        }
        const n = parseFloat(s.replace(/,/g, ''));
        if (Number.isFinite(n)) return Math.max(0, Math.min(100, n));
    }
    return undefined;
}

function isValidStage3CompetencyScore(raw: unknown): boolean {
    if (raw === undefined || raw === null) return false;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 10;
}

/** Default observe until the n8n video contract is proven reliable in production. */
export function getStage3EvaluationGateMode(): Stage3EvaluationGateMode {
    const raw = process.env.STAGE3_EVALUATION_GATE_MODE;
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        return 'observe';
    }
    const mode = String(raw).trim().toLowerCase();
    if (mode === 'enforce') return 'enforce';
    return 'observe';
}

/** Blueprint (v2) competency scores are on a 1..5 scale, unlike the legacy 0..10 named fields. */
function isValidStage3BlueprintScore(raw: unknown): boolean {
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) && n >= 1 && n <= 5;
}

function hasPopulatedCompetencyArray(patch: Record<string, unknown>): boolean {
    const arr = patch.competencyScores;
    return (
        Array.isArray(arr) &&
        arr.some(
            (c) =>
                !!c &&
                typeof c === 'object' &&
                isValidStage3BlueprintScore((c as Record<string, unknown>).score)
        )
    );
}

export function getStage3VideoPatchIssues(patch: Record<string, unknown>): string[] {
    const issues: string[] = [];

    // Competency evidence is satisfied by EITHER the legacy 10 named 0-10 fields,
    // OR the v2 blueprint-driven competencyScores array, OR an explicit
    // insufficient_data outcome (a valid terminal verdict — the interview did not
    // yield enough evidence — not a broken/incomplete callback).
    const insufficient =
        String(patch.status ?? '').trim().toLowerCase() === 'insufficient_data';
    const hasNamed = STAGE3_VIDEO_COMPETENCY_FIELDS.every((f) =>
        isValidStage3CompetencyScore(patch[f])
    );
    const hasArray = hasPopulatedCompetencyArray(patch);
    if (!insufficient && !hasNamed && !hasArray) {
        for (const field of STAGE3_VIDEO_COMPETENCY_FIELDS) {
            if (!isValidStage3CompetencyScore(patch[field])) issues.push(field);
        }
    }

    if (!isValidStage3MeaningfulText(patch.summary)) issues.push('summary');

    const parsedScore = parseStage3OverallScore(patch.overall_score);
    if (parsedScore === undefined) issues.push('overall_score');

    const rec = patch.recommendation;
    const recOk = rec === 'Hire' || rec === 'Consider' || rec === 'Reject';
    if (!recOk) issues.push('recommendation');

    return issues;
}

export function formatStage3EvaluationGateDiagnostic(input: {
    mode: Stage3EvaluationGateMode;
    gateResult: 'complete' | 'incomplete' | 'exempt';
    issues?: string[];
    candidateRef?: string;
}): string {
    const parts = [
        '[stage_ingress]',
        'stage3_evaluation_gate',
        `mode=${input.mode}`,
        `result=${input.gateResult}`,
    ];
    if (input.candidateRef) {
        parts.push(`candidateRef=${input.candidateRef}`);
    }
    if (input.issues && input.issues.length > 0) {
        parts.push(`issues=${input.issues.join(',')}`);
    }
    return parts.join(' ');
}

export function isStage3RejectOrSpamIngress(data: Record<string, unknown>): boolean {
    const ingress = normalizeToken(pickLoose(data, ['ingress']));
    if (ingress.includes('reject')) return true;

    const rejectCode = pickLoose(data, ['rejectCode', 'reject_code']);
    if (rejectCode !== undefined && rejectCode !== null && String(rejectCode).trim() !== '') {
        return true;
    }

    return false;
}

export function isStage3VideoSuccessEvaluationAttempt(
    data: Record<string, unknown>,
    patch: Record<string, unknown>
): boolean {
    if (Object.keys(patch).length === 0) return false;
    if (isStage3RejectOrSpamIngress(data)) return false;

    const src = normalizeToken(pickLoose(data, ['evaluationSource', 'evaluation_source']));
    if (src && src !== 'video') return false;

    return true;
}

export function isCompleteStage3VideoPatch(patch: Record<string, unknown>): boolean {
    return getStage3VideoPatchIssues(patch).length === 0;
}

export function validateStage3VideoEvaluationPersistence(
    data: Record<string, unknown>,
    patch: Record<string, unknown>
): Stage3VideoEvaluationValidationResult {
    if (!isStage3VideoSuccessEvaluationAttempt(data, patch)) {
        return { ok: true };
    }

    const issues = getStage3VideoPatchIssues(patch);
    if (issues.length === 0) {
        return { ok: true };
    }

    return {
        ok: false,
        error: STAGE3_INCOMPLETE_EVALUATION_ERROR,
        message: STAGE3_INCOMPLETE_EVALUATION_MESSAGE,
        issues,
    };
}

export function shouldBlockStage3IncompleteEvaluation(
    mode: Stage3EvaluationGateMode,
    validation: Stage3VideoEvaluationValidationResult
): boolean {
    return mode === 'enforce' && !validation.ok;
}
