/**
 * Part one of the video interview — three opening questions written from the job
 * description (backend flag JD_INTERVIEW_QUESTIONS, routes under
 * /api/recruitment-campaigns/jd-interview-questions).
 *
 * The rules that decide what the job form sends live here, out of the page, so
 * they can be tested without Vite:
 *  - the questions the recruiter SAW (and maybe edited) are exactly the ones sent
 *    with the job — never a set made from an older description or language;
 *  - a job is created only with all three questions, or after the recruiter
 *    explicitly chose to continue without them («skip»);
 *  - nothing at all is sent when the backend has the feature off, for voice
 *    (option 3), or when there is no description.
 *
 * The server checks the set again on create (the edit is free text) and is the
 * authority; a refusal comes back as problem CODES, translated here.
 *
 * @typedef {{ id: string, question: string, clarifyHint: string, duty: string }} JdQuestion
 * @typedef {'idle'|'loading'|'ready'|'failed'|'skipped'} JdDraftStatus
 * @typedef {{
 *   status: JdDraftStatus,
 *   key: string,
 *   questions: JdQuestion[],
 *   original: JdQuestion[],
 *   error: string,
 *   problems: Record<number, string[]>,
 *   setProblems: string[],
 * }} JdQuestionsDraft
 */

export const JD_QUESTION_COUNT = 3;
/** Same cut as the server (readSubmittedJdQuestions). */
export const JD_QUESTION_MAX_CHARS = 600;

export const JD_QUESTIONS_CONFIG_OFF = Object.freeze({ enabled: false, languages: [] });

/** What GET …/config answered; anything unexpected reads as «off». */
export function normalizeJdQuestionsConfig(result) {
    if (!result || result.success !== true || result.enabled !== true) return JD_QUESTIONS_CONFIG_OFF;
    const languages = Array.isArray(result.languages)
        ? result.languages.filter((l) => l === 'ar' || l === 'en')
        : [];
    return { enabled: true, languages };
}

/**
 * The flows that carry part one: Start Process (`process`), AI Screening (`form`)
 * and Video Interview (`video`). Voice (`audio`) never does.
 */
export function jdQuestionsFlowSupported(interviewType) {
    return interviewType === 'process' || interviewType === 'form' || interviewType === 'video';
}

/**
 * Where the preview stands for the form as it is now.
 * @returns {'off'|'no_description'|'no_language'|'language_not_enabled'|'on'}
 */
export function jdQuestionsApplicability({ config, interviewType, jobDescription, interviewLanguage }) {
    if (!config?.enabled || !jdQuestionsFlowSupported(interviewType)) return 'off';
    if (!String(jobDescription || '').trim()) return 'no_description';
    if (interviewLanguage !== 'ar' && interviewLanguage !== 'en') return 'no_language';
    if (!(config.languages || []).includes(interviewLanguage)) return 'language_not_enabled';
    return 'on';
}

/** What a set of questions was made from. Any change to either makes the set stale. */
export function jdQuestionsSourceKey(jobDescription, interviewLanguage) {
    return `${interviewLanguage || ''}\n${String(jobDescription || '').trim()}`;
}

/** @returns {JdQuestionsDraft} */
export function emptyJdQuestionsDraft() {
    return { status: 'idle', key: '', questions: [], original: [], error: '', problems: {}, setProblems: [] };
}

/** @returns {JdQuestionsDraft} */
export function loadingJdQuestionsDraft(key) {
    return { ...emptyJdQuestionsDraft(), status: 'loading', key };
}

/** @returns {JdQuestionsDraft} */
export function skippedJdQuestionsDraft() {
    return { ...emptyJdQuestionsDraft(), status: 'skipped' };
}

function cleanQuestion(q, i) {
    return {
        id: `q${i + 1}`,
        question: String(q?.question ?? '').slice(0, JD_QUESTION_MAX_CHARS),
        clarifyHint: String(q?.clarifyHint ?? q?.clarify_hint ?? '').slice(0, JD_QUESTION_MAX_CHARS),
        duty: String(q?.duty ?? ''),
    };
}

/**
 * The preview's answer → a draft. Anything but three questions is a failure: the
 * server never sends fewer, and showing two would let a two-question job through.
 * @returns {JdQuestionsDraft}
 */
export function jdDraftFromPreview(result, key) {
    const raw = Array.isArray(result?.questions) ? result.questions : [];
    if (result?.success !== true || raw.length !== JD_QUESTION_COUNT) {
        return jdDraftFailed(key, 'GENERATION_FAILED');
    }
    const questions = raw.map(cleanQuestion);
    if (questions.some((q) => !q.question.trim())) return jdDraftFailed(key, 'GENERATION_FAILED');
    return {
        ...emptyJdQuestionsDraft(),
        status: 'ready',
        key,
        questions,
        original: questions.map((q) => ({ ...q })),
    };
}

/** @returns {JdQuestionsDraft} */
export function jdDraftFailed(key, error) {
    return { ...emptyJdQuestionsDraft(), status: 'failed', key, error: String(error || 'FAILED') };
}

/** The preview request's error → the code the section shows. */
export function jdPreviewErrorCode(err) {
    const code = err?.data?.error;
    if (code === 'RATE_LIMITED' || err?.status === 429) return 'RATE_LIMITED';
    if (code === 'JOB_DESCRIPTION_TOO_LONG') return 'JOB_DESCRIPTION_TOO_LONG';
    if (code === 'GENERATION_FAILED') return 'GENERATION_FAILED';
    return 'FAILED';
}

/**
 * What the section shows. A set made — or still being made — from another description
 * or language is `stale` (an answer in flight for the old text is useless the moment
 * the text changes); a skip is the recruiter's choice and survives edits.
 * @returns {JdDraftStatus|'stale'}
 */
export function jdDraftView(draft, currentKey) {
    const status = draft?.status || 'idle';
    if ((status === 'ready' || status === 'failed' || status === 'loading') && draft.key !== currentKey) return 'stale';
    return status;
}

/** True when any question or clarification differs from what the generator wrote. */
export function isJdDraftEdited(draft) {
    const qs = draft?.questions || [];
    const orig = draft?.original || [];
    if (qs.length !== orig.length) return true;
    return qs.some(
        (q, i) =>
            q.question.trim() !== String(orig[i]?.question || '').trim() ||
            q.clarifyHint.trim() !== String(orig[i]?.clarifyHint || '').trim()
    );
}

/** One field typed by the recruiter. Clears that question's server notes, and the set's. */
export function applyJdQuestionEdit(draft, index, field, value) {
    if (field !== 'question' && field !== 'clarifyHint') return draft;
    if (!draft?.questions?.[index]) return draft;
    const questions = draft.questions.map((q, i) =>
        i === index ? { ...q, [field]: String(value ?? '').slice(0, JD_QUESTION_MAX_CHARS) } : q
    );
    const problems = { ...(draft.problems || {}) };
    delete problems[index];
    return { ...draft, questions, problems, setProblems: [] };
}

/**
 * Whether the job may be created now, and what to send with it.
 * @returns {{ allowed: true, fields: object } | { allowed: false, reason: 'loading'|'needs_generate'|'failed'|'incomplete' }}
 */
export function jdQuestionsCreateDecision(draft, { applicability, currentKey }) {
    if (applicability !== 'on') return { allowed: true, fields: {} };
    const view = jdDraftView(draft, currentKey);
    if (view === 'skipped') return { allowed: true, fields: { jdInterviewQuestionsSkip: true } };
    if (view === 'loading') return { allowed: false, reason: 'loading' };
    if (view === 'failed') return { allowed: false, reason: 'failed' };
    if (view !== 'ready') return { allowed: false, reason: 'needs_generate' };
    const questions = draft.questions.map((q, i) => ({
        id: `q${i + 1}`,
        question: q.question.trim(),
        clarifyHint: q.clarifyHint.trim(),
        duty: q.duty.trim(),
    }));
    if (questions.length !== JD_QUESTION_COUNT || questions.some((q) => !q.question || !q.clarifyHint)) {
        return { allowed: false, reason: 'incomplete' };
    }
    return {
        allowed: true,
        fields: {
            jdInterviewQuestions: questions,
            jdInterviewQuestionsSource: isJdDraftEdited(draft) ? 'edited' : 'preview',
        },
    };
}

/** The preview request. The names let the generator avoid the title and company — the same names the create route checks. */
export function buildJdQuestionsPreviewBody({ jobDescription, interviewLanguage, position, company }) {
    const body = { text: String(jobDescription || '').trim(), interviewLanguage };
    const pos = String(position || '').trim();
    const co = String(company || '').trim();
    if (pos) body.position = pos;
    if (co) body.company = co;
    return body;
}

/**
 * A create refused with JD_QUESTIONS_INVALID → notes per question and for the set.
 * @returns {{ problems: Record<number, string[]>, setProblems: string[] } | null}
 */
export function readJdQuestionsRejection(data) {
    if (data?.error !== 'JD_QUESTIONS_INVALID') return null;
    const problems = {};
    for (const p of Array.isArray(data.problems) ? data.problems : []) {
        const index = Number(p?.index);
        if (!Number.isInteger(index) || index < 0 || index >= JD_QUESTION_COUNT) continue;
        problems[index] = (Array.isArray(p.codes) ? p.codes : []).map(String);
    }
    const setProblems = (Array.isArray(data.setProblems) ? data.setProblems : []).map(String);
    return { problems, setProblems };
}

/** Server problem codes (services/jdInterviewQuestions.ts checkJdQuestion) → translation keys. */
const PROBLEM_KEYS = {
    empty: 'newCampaign_jdq_p_empty',
    question_marks: 'newCampaign_jdq_p_questionMark',
    text_after_question: 'newCampaign_jdq_p_questionMark',
    contact_or_link: 'newCampaign_jdq_p_contact',
    personal_trait: 'newCampaign_jdq_p_personal',
    cv_fact: 'newCampaign_jdq_p_cvFact',
    graphic: 'newCampaign_jdq_p_graphic',
    names_company_or_title: 'newCampaign_jdq_p_names',
    hint_missing: 'newCampaign_jdq_p_hintMissing',
    hint_question_mark: 'newCampaign_jdq_p_hintQuestion',
    hint_not_iraqi: 'newCampaign_jdq_p_dialect',
    too_long: 'newCampaign_jdq_p_tooLong',
    yes_no: 'newCampaign_jdq_p_yesNo',
    two_asks: 'newCampaign_jdq_p_twoAsks',
    not_iraqi_levantine: 'newCampaign_jdq_p_dialect',
    not_iraqi_msa: 'newCampaign_jdq_p_dialect',
    lamma: 'newCampaign_jdq_p_dialect',
    kurdish_letters: 'newCampaign_jdq_p_kurdish',
    glued_latin: 'newCampaign_jdq_p_gluedLatin',
    arabic_in_english: 'newCampaign_jdq_p_englishOnly',
};

const SET_PROBLEM_KEYS = {
    count: 'newCampaign_jdq_s_count',
    same_opener: 'newCampaign_jdq_s_sameOpener',
    same_ending: 'newCampaign_jdq_s_sameEnding',
    duplicate: 'newCampaign_jdq_s_duplicate',
};

/** Translation keys for one question's codes — one line per distinct message, unknown codes as a generic note. */
export function jdProblemMessageKeys(codes, interviewLanguage) {
    const keys = (codes || []).map((code) =>
        code === 'not_situational'
            ? interviewLanguage === 'en'
                ? 'newCampaign_jdq_p_notSituationalEn'
                : 'newCampaign_jdq_p_notSituationalAr'
            : PROBLEM_KEYS[code] || 'newCampaign_jdq_p_generic'
    );
    return [...new Set(keys)];
}

export function jdSetProblemMessageKeys(codes) {
    return [...new Set((codes || []).map((code) => SET_PROBLEM_KEYS[code] || 'newCampaign_jdq_p_generic'))];
}

/** Why creation is waiting → the line shown in the section. */
export function jdWaitMessageKey(reason) {
    switch (reason) {
        case 'loading':
            return 'newCampaign_jdq_waitLoading';
        case 'needs_generate':
            return 'newCampaign_jdq_waitReview';
        case 'failed':
            return 'newCampaign_jdq_waitDecide';
        case 'incomplete':
            return 'newCampaign_jdq_waitIncomplete';
        default:
            return '';
    }
}

/** A failed draft's error → the line shown in the section. */
export function jdFailureMessageKey(error) {
    switch (error) {
        case 'RATE_LIMITED':
            return 'newCampaign_jdq_errRateLimited';
        case 'JOB_DESCRIPTION_TOO_LONG':
            return 'newCampaign_jd_errTooLong';
        case 'GENERATION_FAILED':
            return 'newCampaign_jdq_errGenerationFailed';
        default:
            return 'newCampaign_jdq_errFailed';
    }
}
