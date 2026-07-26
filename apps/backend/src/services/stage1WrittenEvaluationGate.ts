export const STAGE1_INCOMPLETE_EVALUATION_ERROR = 'STAGE1_INCOMPLETE_EVALUATION' as const;

export const STAGE1_INCOMPLETE_EVALUATION_MESSAGE =
    'Stage 1 evaluation must include overall_score, recommendation, final_hr_evaluation, fit_for_role, summary, strengths, and weaknesses.';

export type Stage1WrittenEvaluationValidationResult =
    | { ok: true }
    | {
          ok: false;
          error: typeof STAGE1_INCOMPLETE_EVALUATION_ERROR;
          message: string;
          issues: string[];
      };

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

/** Stage 1 reject/spam ingress paths must not require a complete written evaluation. */
export function isStage1RejectOrSpamIngress(data: Record<string, unknown>): boolean {
    const ingress = normalizeToken(pickLoose(data, ['ingress']));
    if (ingress.includes('reject')) return true;

    const rejectCode = pickLoose(data, ['rejectCode', 'reject_code']);
    if (rejectCode !== undefined && rejectCode !== null && String(rejectCode).trim() !== '') {
        return true;
    }

    return false;
}

/** Normal successful Stage 1 written evaluation callback attempting to persist evaluation fields. */
export function isStage1WrittenSuccessEvaluationAttempt(
    data: Record<string, unknown>,
    patch: Record<string, unknown>
): boolean {
    if (Object.keys(patch).length === 0) return false;
    if (isStage1RejectOrSpamIngress(data)) return false;

    const src = normalizeToken(pickLoose(data, ['evaluationSource', 'evaluation_source']));
    if (src && src !== 'written') return false;

    return true;
}

const INVALID_STAGE1_TEXT_TOKENS = new Set(['undefined', 'null', 'nan', '']);

function isValidStage1MeaningfulText(raw: unknown): boolean {
    if (raw === undefined || raw === null) return false;
    const s = String(raw).trim();
    if (!s || INVALID_STAGE1_TEXT_TOKENS.has(s.toLowerCase())) return false;
    return true;
}

function isNonEmptyStringArray(raw: unknown): boolean {
    if (!Array.isArray(raw) || raw.length === 0) return false;
    return raw.some((item) => isValidStage1MeaningfulText(item));
}

export function getStage1WrittenPatchIssues(patch: Record<string, unknown>): string[] {
    const issues: string[] = [];

    const score = patch.overall_score;
    const scoreOk =
        typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100;
    if (!scoreOk) issues.push('overall_score');

    const rec = patch.recommendation;
    const recOk = rec === 'Hire' || rec === 'Consider' || rec === 'Reject';
    if (!recOk) issues.push('recommendation');

    if (!isValidStage1MeaningfulText(patch.final_hr_evaluation)) {
        issues.push('final_hr_evaluation');
    }
    if (!isValidStage1MeaningfulText(patch.fit_for_role)) {
        issues.push('fit_for_role');
    }
    if (!isValidStage1MeaningfulText(patch.summary)) {
        issues.push('summary');
    }
    if (!isNonEmptyStringArray(patch.strengths)) issues.push('strengths');
    if (!isNonEmptyStringArray(patch.weaknesses)) issues.push('weaknesses');

    return issues;
}

export function isCompleteStage1WrittenPatch(patch: Record<string, unknown>): boolean {
    return getStage1WrittenPatchIssues(patch).length === 0;
}

export function validateStage1WrittenEvaluationPersistence(
    data: Record<string, unknown>,
    patch: Record<string, unknown>
): Stage1WrittenEvaluationValidationResult {
    if (!isStage1WrittenSuccessEvaluationAttempt(data, patch)) {
        return { ok: true };
    }

    const issues = getStage1WrittenPatchIssues(patch);
    if (issues.length === 0) {
        return { ok: true };
    }

    return {
        ok: false,
        error: STAGE1_INCOMPLETE_EVALUATION_ERROR,
        message: STAGE1_INCOMPLETE_EVALUATION_MESSAGE,
        issues,
    };
}
