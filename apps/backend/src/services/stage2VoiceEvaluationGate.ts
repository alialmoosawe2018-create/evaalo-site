export const STAGE2_INCOMPLETE_EVALUATION_ERROR = 'STAGE2_INCOMPLETE_EVALUATION' as const;

export const STAGE2_INCOMPLETE_EVALUATION_MESSAGE =
    'Stage 2 evaluation must include all voice competency rating fields (Excellent/Good/Intermediate/Bad), a professional-attitude paragraph, summary, strengths, weaknesses, final HR evaluation, score, and recommendation.';

export type Stage2EvaluationGateMode = 'observe' | 'enforce';

export type Stage2VoiceEvaluationValidationResult =
    | { ok: true }
    | {
          ok: false;
          error: typeof STAGE2_INCOMPLETE_EVALUATION_ERROR;
          message: string;
          issues: string[];
      };

/** Allowed single-word competency ratings (English tokens from n8n). */
export const STAGE2_COMPETENCY_RATING_TOKENS = [
    'Excellent',
    'Good',
    'Intermediate',
    'Bad',
] as const;

const STAGE2_COMPETENCY_RATING_SET = new Set(
    STAGE2_COMPETENCY_RATING_TOKENS.map((t) => t.toLowerCase())
);

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

const INVALID_STAGE2_TEXT_TOKENS = new Set(['undefined', 'null', 'nan', 'n/a', '']);

function isValidStage2MeaningfulText(raw: unknown): boolean {
    if (raw === undefined || raw === null) return false;
    const s = String(raw).trim();
    if (!s || INVALID_STAGE2_TEXT_TOKENS.has(s.toLowerCase())) return false;
    return true;
}

function isNonEmptyStringArray(raw: unknown): boolean {
    if (!Array.isArray(raw) || raw.length === 0) return false;
    return raw.some((item) => isValidStage2MeaningfulText(item));
}

/** Exactly one of Excellent | Good | Intermediate | Bad — no numbers, no phrases. */
export function isValidStage2CompetencyRating(raw: unknown): boolean {
    if (raw === undefined || raw === null) return false;
    if (typeof raw === 'number') return false;
    const s = String(raw).trim();
    if (!s || /\s/.test(s)) return false;
    return STAGE2_COMPETENCY_RATING_SET.has(s.toLowerCase());
}

/** Narrative paragraph — not a single competency rating word. */
export function isValidStage2ProfessionalAttitude(raw: unknown): boolean {
    if (!isValidStage2MeaningfulText(raw)) return false;
    const s = String(raw).trim();
    if (STAGE2_COMPETENCY_RATING_SET.has(s.toLowerCase())) return false;
    const words = s.split(/\s+/).filter(Boolean);
    return words.length >= 2 || s.length >= 30;
}

/** Default enforce — n8n + backend share the same strict contract. */
export function getStage2EvaluationGateMode(): Stage2EvaluationGateMode {
    const raw = process.env.STAGE2_EVALUATION_GATE_MODE;
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        return 'enforce';
    }
    const mode = String(raw).trim().toLowerCase();
    if (mode === 'observe') return 'observe';
    return 'enforce';
}

export function getStage2VoicePatchIssues(patch: Record<string, unknown>): string[] {
    const issues: string[] = [];

    if (!isValidStage2CompetencyRating(patch.communication)) issues.push('communication');
    if (!isValidStage2CompetencyRating(patch.language_fluency)) issues.push('language_fluency');
    if (!isValidStage2CompetencyRating(patch.confidence)) issues.push('confidence');
    if (!isValidStage2CompetencyRating(patch.problem_solving)) issues.push('problem_solving');
    if (!isValidStage2CompetencyRating(patch.digital_skills)) issues.push('digital_skills');
    if (!isValidStage2ProfessionalAttitude(patch.professional_attitude)) {
        issues.push('professional_attitude');
    }
    if (!isValidStage2MeaningfulText(patch.summary)) issues.push('summary');
    if (!isNonEmptyStringArray(patch.strengths)) issues.push('strengths');
    if (!isNonEmptyStringArray(patch.weaknesses)) issues.push('weaknesses');
    if (!isValidStage2MeaningfulText(patch.final_hr_evaluation)) {
        issues.push('final_hr_evaluation');
    }

    const score = patch.overall_score;
    const scoreOk =
        typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100;
    if (!scoreOk) issues.push('overall_score');

    const rec = patch.recommendation;
    const recOk = rec === 'Hire' || rec === 'Consider' || rec === 'Reject';
    if (!recOk) issues.push('recommendation');

    return issues;
}

export function formatStage2EvaluationGateDiagnostic(input: {
    mode: Stage2EvaluationGateMode;
    gateResult: 'complete' | 'incomplete' | 'exempt';
    issues?: string[];
    candidateRef?: string;
}): string {
    const parts = [
        '[stage_ingress]',
        'stage2_evaluation_gate',
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

/** Stage 2 reject/spam ingress paths must not require a complete voice evaluation. */
export function isStage2RejectOrSpamIngress(data: Record<string, unknown>): boolean {
    const ingress = normalizeToken(pickLoose(data, ['ingress']));
    if (ingress.includes('reject')) return true;

    const rejectCode = pickLoose(data, ['rejectCode', 'reject_code']);
    if (rejectCode !== undefined && rejectCode !== null && String(rejectCode).trim() !== '') {
        return true;
    }

    return false;
}

/** Normal successful Stage 2 voice evaluation callback attempting to persist evaluation fields. */
export function isStage2VoiceSuccessEvaluationAttempt(
    data: Record<string, unknown>,
    patch: Record<string, unknown>
): boolean {
    if (Object.keys(patch).length === 0) return false;
    if (isStage2RejectOrSpamIngress(data)) return false;

    const src = normalizeToken(pickLoose(data, ['evaluationSource', 'evaluation_source']));
    if (src && src !== 'voice') return false;

    return true;
}

export function isCompleteStage2VoicePatch(patch: Record<string, unknown>): boolean {
    return getStage2VoicePatchIssues(patch).length === 0;
}

export function validateStage2VoiceEvaluationPersistence(
    data: Record<string, unknown>,
    patch: Record<string, unknown>
): Stage2VoiceEvaluationValidationResult {
    if (!isStage2VoiceSuccessEvaluationAttempt(data, patch)) {
        return { ok: true };
    }

    const issues = getStage2VoicePatchIssues(patch);
    if (issues.length === 0) {
        return { ok: true };
    }

    return {
        ok: false,
        error: STAGE2_INCOMPLETE_EVALUATION_ERROR,
        message: STAGE2_INCOMPLETE_EVALUATION_MESSAGE,
        issues,
    };
}

export function shouldBlockStage2IncompleteEvaluation(
    mode: Stage2EvaluationGateMode,
    validation: Stage2VoiceEvaluationValidationResult
): boolean {
    return mode === 'enforce' && !validation.ok;
}
