/**
 * Stage 2 evidence gate — block n8n scoring when the session is too thin
 * to support a real Hire/Consider/Reject judgment (greeting-only / cut-off calls).
 */
import Candidate from '../models/Candidate.js';
import CandidateApplication from '../models/CandidateApplication.js';
import { findApplicationForCallback } from './candidateApplicationService.js';
import { isApplicationOwnsCampaignStateEnabled } from '../config/applicationOwnership.js';
import type { ConversationEntry } from './interviewLinkAccess.js';

export const VOICE_EVAL_MIN_DURATION_SEC = Number(process.env.VOICE_EVAL_MIN_DURATION_SEC) || 75;
export const VOICE_EVAL_MIN_USER_CHARS = Number(process.env.VOICE_EVAL_MIN_USER_CHARS) || 150;
/** Agent questions that actually received a substantive reply. */
export const VOICE_EVAL_MIN_ANSWERED = Number(process.env.VOICE_EVAL_MIN_ANSWERED) || 3;
/** Candidate's share of the spoken transcript — catches agent-monologue sessions. */
export const VOICE_EVAL_MIN_CANDIDATE_SHARE =
    Number(process.env.VOICE_EVAL_MIN_CANDIDATE_SHARE) || 0.15;
/** Below this, an utterance is a token ("لا"، "اوكي") and cannot answer a question. */
const MIN_ANSWER_CHARS = 6;

export type VoiceEvidenceAssessment = {
    ok: boolean;
    durationSec: number;
    userTurns: number;
    /** Raw character count — kept for log continuity; not a gate any more. */
    userChars: number;
    /** Characters left after collapsing STT repetition and dropping non-answers. */
    substantiveUserChars: number;
    answeredQuestions: number;
    /** 0..1 — candidate characters over all spoken characters. */
    candidateShare: number;
    reasons: string[];
};

/** Comparison form: no diacritics, no punctuation, single spaces, alef/ya unified. */
function normalizeForCompare(text: string): string {
    return String(text ?? '')
        .toLowerCase()
        .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
        .replace(/[أإآ]/g, 'ا')
        .replace(/ؤ/g, 'و')
        .replace(/ئ/g, 'ي')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Collapse immediately repeated token runs, e.g. "مستواي البرامج مستواي البرامج"
 * -> "مستواي البرامج". Speech-to-text repetition would otherwise inflate the very
 * counter that is supposed to prove the candidate said enough.
 */
export function collapseRepeatedRuns(text: string): string {
    let tokens = normalizeForCompare(text).split(' ').filter(Boolean);
    for (let size = 6; size >= 1; size -= 1) {
        const out: string[] = [];
        let i = 0;
        while (i < tokens.length) {
            const run = tokens.slice(i, i + size);
            const next = tokens.slice(i + size, i + size * 2);
            if (run.length === size && next.length === size && run.join(' ') === next.join(' ')) {
                out.push(...run);
                i += size;
                // Skip every further consecutive repeat of the same run.
                while (tokens.slice(i, i + size).join(' ') === run.join(' ')) i += size;
                continue;
            }
            out.push(tokens[i]);
            i += 1;
        }
        tokens = out;
    }
    return tokens.join(' ');
}

/** Whole-utterance refusals and fillers, in the three interview languages. */
const NON_ANSWER_PATTERNS: RegExp[] = [
    /^(لا|نعم|اي|ايه|ايوه|اوكي|اوكيه|تمام|زين|ماشي|طيب|هلا|اهلا|اهلين|شكرا)$/,
    /^(ما|لا)\s*(اعرف|ادري|افتهم|فهمت)$/,
    /^(مو|مش|ماني)\s*(متاكد|متاكده|عارف|فاهم)$/,
    /^(السوال|سوال)\s*(التالي|الثاني|الجاي)$/,
    /^(ممكن|اقدر)\s*(توضحي|توضح|تعيدي|تعيد)/,
    /^(i\s*)?(do\s*not|don\s*t|dont)\s*know$/,
    /^(not\s*sure|no\s*idea|no\s*comment|next(\s*question)?|skip|pass|yes|no|ok|okay|hello|hi|thanks)$/,
    /^(nazanim|نازانم)$/,
    /^(دڵنیا\s*نیم|پرسیاری\s*داهاتوو)$/,
];

/** Discourse padding around a refusal: "والله ما أعرف" is still "ما أعرف". */
const FILLER_TOKENS = new Set([
    'والله',
    'يعني',
    'اه',
    'ايه',
    'طيب',
    'زين',
    'همم',
    'صدق',
    'بصراحه',
    'حقيقه',
    'well',
    'honestly',
    'um',
    'uh',
    'hmm',
    'actually',
    'like',
    'so',
    'really',
]);

function stripFillers(normalized: string): string {
    const tokens = normalized.split(' ').filter(Boolean);
    let start = 0;
    let end = tokens.length;
    while (start < end && FILLER_TOKENS.has(tokens[start])) start += 1;
    while (end > start && FILLER_TOKENS.has(tokens[end - 1])) end -= 1;
    return tokens.slice(start, end).join(' ');
}

function isNonAnswer(normalized: string): boolean {
    if (normalized.length < MIN_ANSWER_CHARS) return true;
    const core = stripFillers(normalized);
    if (!core) return true;
    return NON_ANSWER_PATTERNS.some((re) => re.test(core));
}

type SpokenTurn = { role: 'user' | 'assistant'; collapsed: string; raw: string };

function spokenTurns(history?: ConversationEntry[] | null): SpokenTurn[] {
    if (!history?.length) return [];
    const turns: SpokenTurn[] = [];
    for (const m of history) {
        const role = m?.role === 'user' ? 'user' : m?.role === 'assistant' ? 'assistant' : null;
        if (!role) continue;
        const raw = String(m.content ?? '').trim();
        if (!raw) continue;
        const collapsed = collapseRepeatedRuns(raw);
        if (!collapsed) continue;
        // A candidate turn identical to their previous one is one piece of evidence.
        const prev = turns[turns.length - 1];
        if (prev && prev.role === role && prev.collapsed === collapsed) continue;
        turns.push({ role, collapsed, raw });
    }
    return turns;
}

/**
 * Pure check — no I/O.
 *
 * Gates on what the candidate actually answered, not on how long the call lasted:
 * duration and raw character counts are both inflatable (dead air, STT repetition,
 * wordy refusals) and neither shows that a question was engaged with. Wall-clock
 * duration is therefore a corroborating signal only — strong answer evidence
 * forgives a call that ran slightly short.
 */
export function assessVoiceInterviewEvidence(
    history: ConversationEntry[] | null | undefined,
    durationSec: number
): VoiceEvidenceAssessment {
    const turns = spokenTurns(history);
    const userTurns = turns.filter((t) => t.role === 'user');
    const rawUserChars = userTurns.reduce((n, t) => n + t.raw.length, 0);

    const userChars = userTurns.reduce((n, t) => n + t.collapsed.length, 0);
    const assistantChars = turns
        .filter((t) => t.role === 'assistant')
        .reduce((n, t) => n + t.collapsed.length, 0);
    const spokenTotal = userChars + assistantChars;
    const candidateShare = spokenTotal > 0 ? userChars / spokenTotal : 0;

    const substantiveUserChars = userTurns
        .filter((t) => !isNonAnswer(t.collapsed))
        .reduce((n, t) => n + t.collapsed.length, 0);

    // Every agent turn is a prompt to speak; it counts as answered when the reply
    // that follows carries content. The opening greeting fails this naturally,
    // because "أهلين وسهلين" is a non-answer.
    let answeredQuestions = 0;
    for (let i = 0; i < turns.length; i += 1) {
        if (turns[i].role !== 'assistant') continue;
        let reply = '';
        for (let j = i + 1; j < turns.length && turns[j].role === 'user'; j += 1) {
            reply = reply ? `${reply} ${turns[j].collapsed}` : turns[j].collapsed;
        }
        if (reply && !isNonAnswer(reply)) answeredQuestions += 1;
    }

    const duration = Math.max(0, Math.floor(Number(durationSec) || 0));
    const reasons: string[] = [];

    if (answeredQuestions < VOICE_EVAL_MIN_ANSWERED) {
        reasons.push(`answered_questions=${answeredQuestions}<${VOICE_EVAL_MIN_ANSWERED}`);
    }
    if (substantiveUserChars < VOICE_EVAL_MIN_USER_CHARS) {
        reasons.push(`substantive_user_chars=${substantiveUserChars}<${VOICE_EVAL_MIN_USER_CHARS}`);
    }
    if (candidateShare < VOICE_EVAL_MIN_CANDIDATE_SHARE) {
        reasons.push(`candidate_share=${candidateShare.toFixed(2)}<${VOICE_EVAL_MIN_CANDIDATE_SHARE}`);
    }

    // Content evidence clearly above the floors outweighs a short wall clock; a
    // 21-second call cannot reach it, so the duration guard still holds where it matters.
    const contentIsStrong =
        answeredQuestions >= VOICE_EVAL_MIN_ANSWERED + 1 &&
        substantiveUserChars >= VOICE_EVAL_MIN_USER_CHARS * 1.5;
    if (duration < VOICE_EVAL_MIN_DURATION_SEC && !contentIsStrong) {
        reasons.push(`duration_sec=${duration}<${VOICE_EVAL_MIN_DURATION_SEC}`);
    }

    return {
        ok: reasons.length === 0,
        durationSec: duration,
        userTurns: userTurns.length,
        userChars: rawUserChars,
        substantiveUserChars,
        answeredQuestions,
        candidateShare: Number(candidateShare.toFixed(3)),
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

    if (app) {
        await CandidateApplication.findByIdAndUpdate(app._id, { $set: setUpdate }, { new: true });
    }
    // The gate's verdict describes one interview. Writing it to the person made
    // it the answer for every campaign that person ever applied to.
    if (!app || !isApplicationOwnsCampaignStateEnabled()) {
        await Candidate.findByIdAndUpdate(candidateId, { $set: setUpdate }, { new: true });
    }

    const a = input.assessment;
    console.warn(
        `[VOICE EVIDENCE] ${(input.sessionId || candidateId).substring(0, 8)}... insufficient — skip n8n ` +
            `(answered=${a.answeredQuestions} substantive_chars=${a.substantiveUserChars} ` +
            `share=${a.candidateShare} duration=${a.durationSec}s | ${a.reasons.join(', ')})`
    );
    return true;
}
