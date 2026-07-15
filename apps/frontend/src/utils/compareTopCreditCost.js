/** Mirrors backend compare pool eligibility (Hire/Consider + score, capped at topN). */
export const DEFAULT_COMPARE_TOP_N = 5;
export const COMPARE_EMAIL_CREDITS = 1;
export const COMPARE_CANDIDATE_CREDITS = 2;

const STAGE_EVAL_KEYS = {
    screening: 'writtenInterviewEvaluation',
    voice: 'voiceInterviewEvaluation',
    video: 'videoInterviewEvaluation',
};

export function countEligibleCompareCandidates(candidates, stage = 'screening') {
    const evalKey = STAGE_EVAL_KEYS[stage] || STAGE_EVAL_KEYS.screening;
    const eligible = (candidates || []).filter((c) => {
        const ev = c?.[evalKey];
        if (ev?.overall_score == null || ev.overall_score === '') return false;
        const rec = String(ev.recommendation ?? '').trim();
        return rec === 'Hire' || rec === 'Consider';
    });
    return Math.min(eligible.length, DEFAULT_COMPARE_TOP_N);
}

export function computeCompareTopCredits(emailCount, candidateCount) {
    const emails = Math.max(Number(emailCount) || 0, 0);
    const candidates = Math.max(Number(candidateCount) || 0, 0);
    const emailCredits = emails * COMPARE_EMAIL_CREDITS;
    const candidateCredits = candidates * COMPARE_CANDIDATE_CREDITS;
    return {
        emailCredits,
        candidateCredits,
        totalCredits: emailCredits + candidateCredits,
        emailCount: emails,
        candidateCount: candidates,
    };
}
