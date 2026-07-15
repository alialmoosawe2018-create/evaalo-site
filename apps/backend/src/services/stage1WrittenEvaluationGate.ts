export const STAGE1_INCOMPLETE_EVALUATION_ERROR = 'STAGE1_INCOMPLETE_EVALUATION' as const;

export const STAGE1_INCOMPLETE_EVALUATION_MESSAGE =
    'Stage 1 evaluation must include a valid score, recommendation, and final HR evaluation report.';

export type Stage1WrittenEvaluationValidationResult =
    | { ok: true }
    | { ok: false; error: typeof STAGE1_INCOMPLETE_EVALUATION_ERROR; message: string };

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

function isValidStage1FinalHrText(raw: unknown): boolean {
    if (raw === undefined || raw === null) return false;
    const s = String(raw).trim();
    if (!s || INVALID_STAGE1_TEXT_TOKENS.has(s.toLowerCase())) return false;
    return true;
}

export function isCompleteStage1WrittenPatch(patch: Record<string, unknown>): boolean {
    const score = patch.overall_score;
    const scoreOk =
        typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100;

    const rec = patch.recommendation;
    const recOk = rec === 'Hire' || rec === 'Consider' || rec === 'Reject';

    const finalHrOk = isValidStage1FinalHrText(patch.final_hr_evaluation);

    return scoreOk && recOk && finalHrOk;
}

export function validateStage1WrittenEvaluationPersistence(
    data: Record<string, unknown>,
    patch: Record<string, unknown>
): Stage1WrittenEvaluationValidationResult {
    if (!isStage1WrittenSuccessEvaluationAttempt(data, patch)) {
        return { ok: true };
    }

    if (isCompleteStage1WrittenPatch(patch)) {
        return { ok: true };
    }

    return {
        ok: false,
        error: STAGE1_INCOMPLETE_EVALUATION_ERROR,
        message: STAGE1_INCOMPLETE_EVALUATION_MESSAGE,
    };
}
