// Resolves a single, display-ready evaluation for a candidate from whichever
// evaluation source is available. Candidates coming from shared voice/video
// interview links store their results in voiceInterviewEvaluation /
// videoInterviewEvaluation, while screening candidates use aiEvaluation /
// writtenInterviewEvaluation. The Candidates table shows one column, so we
// pick the richest available source with a stable priority.

function toScore(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(100, Math.round(n)));
}

// Voice sub-metrics may arrive as 0–10 numbers or free-form strings from n8n.
function toPercentFrom10(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(100, Math.round(n * 10)));
}

/**
 * @param {object} candidate
 * @returns {null | {
 *   source: 'ai'|'video'|'voice'|'written',
 *   score: number,
 *   communication?: number,
 *   technical?: number,
 *   problemSolving?: number,
 *   confidence?: number,
 *   recommendation?: string,
 *   feedback?: string,
 * }}
 */
export function resolveCandidateEvaluation(candidate) {
    if (!candidate || typeof candidate !== 'object') return null;

    const ai = candidate.aiEvaluation;
    if (ai && toScore(ai.score) != null) {
        return {
            source: 'ai',
            score: toScore(ai.score),
            communication: toScore(ai.communication),
            technical: toScore(ai.technical),
            problemSolving: toScore(ai.problemSolving),
            confidence: toScore(ai.confidence),
            feedback: ai.feedback || '',
        };
    }

    const video = candidate.videoInterviewEvaluation;
    if (video && toScore(video.overall_score) != null) {
        return {
            source: 'video',
            score: toScore(video.overall_score),
            recommendation: video.recommendation || '',
            feedback: video.summary || video.final_hr_evaluation || '',
            // v2 scorer flags a data-poor interview; surface it so a low-confidence
            // result is not read as a normal pass/consider.
            status: video.status || '',
            insufficient: String(video.status || '').toLowerCase() === 'insufficient_data',
        };
    }

    const voice = candidate.voiceInterviewEvaluation;
    if (voice && toScore(voice.overall_score) != null) {
        return {
            source: 'voice',
            score: toScore(voice.overall_score),
            communication: toPercentFrom10(voice.communication),
            problemSolving: toPercentFrom10(voice.problem_solving),
            recommendation: voice.recommendation || '',
            feedback: voice.summary || voice.final_hr_evaluation || '',
        };
    }

    const written = candidate.writtenInterviewEvaluation;
    if (written && toScore(written.overall_score) != null) {
        return {
            source: 'written',
            score: toScore(written.overall_score),
            recommendation: written.recommendation || '',
            feedback: written.summary || written.final_hr_evaluation || '',
        };
    }

    return null;
}

/** Translation key for the evaluation source badge. */
export function evaluationSourceLabelKey(source) {
    switch (source) {
        case 'video':
            return 'candidates_evalSource_video';
        case 'voice':
            return 'candidates_evalSource_voice';
        case 'written':
            return 'candidates_evalSource_screening';
        case 'ai':
        default:
            return 'candidates_evalSource_screening';
    }
}
