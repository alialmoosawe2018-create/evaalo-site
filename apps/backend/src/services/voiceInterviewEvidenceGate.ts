/**
 * Stage 2 evidence gate — block n8n scoring when the session is too thin
 * to support a real Hire/Consider/Reject judgment (greeting-only / cut-off calls).
 */
import Candidate from '../models/Candidate.js';
import CandidateApplication from '../models/CandidateApplication.js';
import { findApplicationForCallback } from './candidateApplicationService.js';
import type { ConversationEntry } from './interviewLinkAccess.js';

export const VOICE_EVAL_MIN_DURATION_SEC = Number(process.env.VOICE_EVAL_MIN_DURATION_SEC) || 90;
export const VOICE_EVAL_MIN_USER_TURNS = Number(process.env.VOICE_EVAL_MIN_USER_TURNS) || 3;
export const VOICE_EVAL_MIN_USER_CHARS = Number(process.env.VOICE_EVAL_MIN_USER_CHARS) || 150;

export type VoiceEvidenceAssessment = {
    ok: boolean;
    durationSec: number;
    userTurns: number;
    userChars: number;
    reasons: string[];
};

function userUtterances(history?: ConversationEntry[] | null): string[] {
    if (!history?.length) return [];
    return history
        .filter((m) => m?.role === 'user')
        .map((m) => String(m.content ?? '').trim())
        .filter((t) => t.length > 0);
}

/** Pure check — no I/O. Duration is wall-clock seconds for the voice WS session. */
export function assessVoiceInterviewEvidence(
    history: ConversationEntry[] | null | undefined,
    durationSec: number
): VoiceEvidenceAssessment {
    const utterances = userUtterances(history);
    const userTurns = utterances.length;
    const userChars = utterances.reduce((n, t) => n + t.length, 0);
    const duration = Math.max(0, Math.floor(Number(durationSec) || 0));
    const reasons: string[] = [];

    if (duration < VOICE_EVAL_MIN_DURATION_SEC) {
        reasons.push(`duration_sec=${duration}<${VOICE_EVAL_MIN_DURATION_SEC}`);
    }
    if (userTurns < VOICE_EVAL_MIN_USER_TURNS) {
        reasons.push(`user_turns=${userTurns}<${VOICE_EVAL_MIN_USER_TURNS}`);
    }
    if (userChars < VOICE_EVAL_MIN_USER_CHARS) {
        reasons.push(`user_chars=${userChars}<${VOICE_EVAL_MIN_USER_CHARS}`);
    }

    return {
        ok: reasons.length === 0,
        durationSec: duration,
        userTurns,
        userChars,
        reasons,
    };
}

export function insufficientVoiceEvaluationCopy(language?: string): {
    summary: string;
    final_hr_evaluation: string;
    weaknesses: string[];
} {
    const lang = String(language || '').toLowerCase().trim();
    if (lang === 'en' || lang === 'english') {
        return {
            summary:
                'Interview incomplete — insufficient evidence for evaluation (session too short or too few candidate answers). No performance score was assigned.',
            final_hr_evaluation:
                'Do not treat this as a Hire/Consider/Reject decision. The candidate may restart the voice interview once a complete session is available.',
            weaknesses: ['Insufficient interview evidence'],
        };
    }
    if (lang === 'ku' || lang === 'ckb' || lang === 'kurdish') {
        return {
            summary:
                'چاوپێکەوتن تەواو نەبوو — بەڵگەی پێویست بۆ هەڵسەنگاندن نییە (کاتی کەم یان وەڵامی کەم). هیچ نمرەیەکی ئەدا نەدرا.',
            final_hr_evaluation:
                'ئەمە بڕیاری Hire/Consider/Reject نییە. دەکرێت کاندید دووبارە چاوپێکەوتنی دەنگی بکاتەوە کاتێک دانیشتنێکی تەواو هەبێت.',
            weaknesses: ['بەڵگەی پێویستی چاوپێکەوتن نییە'],
        };
    }
    return {
        summary:
            'المقابلة غير مكتملة — لا توجد أدلة كافية للتقييم (مدة قصيرة أو إجابات غير كافية). لم يُحتسب تقييم أداء.',
        final_hr_evaluation:
            'لا تُعامل هذه النتيجة كتوصية Hire/Consider/Reject. يمكن للمرشح إعادة المقابلة الصوتية عند توفر جلسة مكتملة.',
        weaknesses: ['أدلة المقابلة غير كافية'],
    };
}

/**
 * Persist an Incomplete Stage 2 marker (no score) and skip n8n.
 * Does not emit VoiceEvaluationCompleted — this is not a scored evaluation.
 */
export async function persistInsufficientVoiceEvidence(input: {
    candidateId?: string;
    applicationId?: string | null;
    campaignId?: string | null;
    language?: string;
    assessment: VoiceEvidenceAssessment;
    sessionId?: string;
}): Promise<boolean> {
    const candidateId = input.candidateId;
    if (!candidateId || !/^[a-fA-F0-9]{24}$/.test(candidateId)) return false;

    const copy = insufficientVoiceEvaluationCopy(input.language);
    // Full subdoc replace so a prior fake overall_score cannot linger.
    const setUpdate = {
        voiceInterviewEvaluation: {
            recommendation: 'Incomplete' as const,
            summary: copy.summary,
            final_hr_evaluation: copy.final_hr_evaluation,
            strengths: [] as string[],
            weaknesses: copy.weaknesses,
        },
        status: 'pending_evaluation' as const,
    };

    const app = await findApplicationForCallback({
        applicationId: input.applicationId || undefined,
        candidateId,
        campaignId: input.campaignId || undefined,
    });

    await Candidate.findByIdAndUpdate(candidateId, { $set: setUpdate }, { new: true });
    if (app) {
        await CandidateApplication.findByIdAndUpdate(app._id, { $set: setUpdate }, { new: true });
    }

    console.warn(
        `[VOICE EVIDENCE] ${(input.sessionId || candidateId).substring(0, 8)}... insufficient — skip n8n (${input.assessment.reasons.join(', ')})`
    );
    return true;
}
