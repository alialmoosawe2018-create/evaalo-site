/**
 * Regression for the Phase 2 plan in a long (English) session, and for the phase
 * that gets REPORTED to the evaluator.
 *
 * Measured in production 2026-09-23 — sessions 6cfb7d62 (HSE Engineer) and
 * 2718fd5f (Compensation & Benefits), n8n executions 1922 and 1924:
 *
 *   1. An English session has no Phase 3 (an English test inside an all-English
 *      interview is meaningless), so Phase 2 stays open until the 12-minute cap.
 *      Phase 2 had six topics; they ran out and `pickPhase2Topic` fell into a
 *      round-robin, so BOTH interviews asked the same five questions twice and
 *      one asked teamwork three times.
 *
 *   2. `interviewState` computed the reported phase with the Arabic thresholds
 *      and never looked at the session language, so every English interview was
 *      reported as `phaseReached: 3` — a phase it cannot enter.
 *
 * ⚠️ THE FIRST VERSION OF THIS TEST PASSED WHILE PRODUCTION STILL REPEATED.
 * It called `getControllerOutput(count, state, lang)` with three arguments while
 * voiceSessionCore calls it with four — the fourth being `phase1TopicsExhausted`,
 * which opens Phase 2 at turn 8 rather than 12 whenever a candidate profile is
 * loaded (i.e. every public link). With the real flag a 26-turn interview spends
 * 18 turns in Phase 2 against 15 usable keys. So a bigger bank can never be the
 * fix on its own: turn count is bounded by a wall-clock timer, not by a cap. What
 * holds is the deepening branch — and this replay now passes the flag.
 *
 * Run: npx tsx src/scripts/voice-english-phase2-plan-test.ts
 */
import { getControllerOutput, computePhaseByCount } from '../evaalo-only-voice/interviewController.js';
import {
    selectNextQuestion,
    getAvailableTopicsForPhase1,
    buildPhase2TopicPrompt,
} from '../evaalo-only-voice/questionEngine.js';
import {
    createInterviewState,
    getInterviewState,
    onExchangeComplete,
    removeInterviewState,
} from '../evaalo-only-voice/interviewState.js';
import {
    PHASE2_TOPIC_KEYS,
    PHASE2_TOPIC_KEYS_EXTRA,
    getPhase2TopicKeys,
    POOL_QUESTIONS,
} from '../evaalo-only-voice/interviewConfig.js';
import { endedBeforeEnglishPhase } from '../evaalo-only-voice/voiceSessionEnd.js';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
    if (actual === expected) {
        console.log(`ok   ${name}`);
    } else {
        failures += 1;
        console.error(`FAIL ${name}: expected ${String(expected)}, got ${String(actual)}`);
    }
}

const PROFILE = {
    skills: ['Leadership', 'Reporting'],
    certifications: 'IOSH',
    highest_education_level: 'bachelor',
    current_company: 'Asas',
    position_applied_for: 'HSE Engineer',
    languages: ['English', 'Arabic'],
};

/**
 * One voiceSessionCore turn, reduced to what decides and records a question —
 * including the two things the first version left out: the `phase1TopicsExhausted`
 * flag, and the Phase 1 topic-choice branch that books one topic per turn (core
 * derives it with `inferTopicFromQuestion(llmReply)`).
 */
function runTurn(sid: string, count: number, lang: 'ar' | 'en', inferenceWorks = true) {
    const state = getInterviewState(sid);
    const phase1TopicsExhausted = getAvailableTopicsForPhase1(state).length === 0; // a profile is present
    const controller = getControllerOutput(count, state, lang, phase1TopicsExhausted);
    let selected: ReturnType<typeof selectNextQuestion>;
    let topicUsed: string | undefined;
    if (controller.phase === 1 && !controller.mandatoryQuestionDue) {
        const availableTopics = getAvailableTopicsForPhase1(state);
        if (availableTopics.length > 0) {
            selected = { availableTopics, preferArabic: lang === 'ar' };
            topicUsed = inferenceWorks ? availableTopics[0] : undefined;
        } else {
            selected = selectNextQuestion(controller, state, lang, false, PROFILE, 'an answer', []);
            topicUsed = selected?.topic;
        }
    } else {
        selected = selectNextQuestion(controller, state, lang, false, PROFILE, 'an answer', []);
        topicUsed = selected?.topic;
    }
    onExchangeComplete(sid, selected?.text ?? 'q', count, {
        mandatoryQuestion1Asked: controller.mandatoryQuestionDue === 1,
        mandatoryQuestion2Asked: controller.mandatoryQuestionDue === 2,
        mandatoryQuestion3Asked: controller.mandatoryQuestionDue === 3,
        poolUsed: selected?.pool,
        topicUsed,
        phase2TopicUsed: selected?.topicKey,
        deepDiveUsed: selected?.isDeepDive === true,
        phase3Reached: controller.phase === 3,
        sessionLanguage: lang,
    });
    return { controller, selected };
}

function replay(sid: string, lang: 'ar' | 'en', turns: number, inferenceWorks = true) {
    removeInterviewState(sid);
    createInterviewState(sid);
    const topics: string[] = [];
    const questions: string[] = [];
    const phases: number[] = [];
    let deepDives = 0;
    let phase2StartsAt = -1;
    for (let i = 0; i < turns; i += 1) {
        const { controller, selected } = runTurn(sid, i, lang, inferenceWorks);
        phases.push(controller.phase);
        if (controller.phase === 2 && phase2StartsAt < 0) phase2StartsAt = i;
        if (controller.phase === 2 && selected?.topicKey) topics.push(selected.topicKey);
        if (selected?.isDeepDive) deepDives += 1;
        if (selected?.text) questions.push(selected.text);
    }
    const state = getInterviewState(sid);
    return { topics, questions, phases, deepDives, phase2StartsAt, state };
}

/* ── 1. the English session at the length both production sessions ran ─────── */
const EN = replay('en-plan-26', 'en', 26);
console.log(`   EN Phase 2 opens at turn ${EN.phase2StartsAt}; topics: ${EN.topics.join(' > ')}`);
console.log(`   deep dives: ${EN.deepDives}`);

check('Phase 2 really does open early in the production shape', EN.phase2StartsAt, 8);
check('the plan has 16 topics', getPhase2TopicKeys().length, 16);
check('no Phase 2 topic is served twice', EN.topics.length, new Set(EN.topics).size);
check('the English session never enters Phase 3', EN.phases.includes(3), false);
check('phaseReached stays 2 on an English session', EN.state?.phase, 2);
/* The five that came round a second time in production. */
for (const key of ['certification', 'education', 'company', 'language', 'skill']) {
    check(`"${key}" is served exactly once`, EN.topics.filter((t) => t === key).length, 1);
}
check('the role topic is never served in Phase 2', EN.topics.includes('role'), false);
check('because the Phase 1 mandatory booked it', EN.state?.askedPhase2Topics.includes('role'), true);
check('the bank runs out inside 26 turns, so deepening carries the rest', EN.deepDives > 0, true);
check('and no question text is repeated verbatim', EN.questions.length, new Set(EN.questions).size);

/* ── 2. longer sessions — a wall-clock cap, not a turn cap, decides ────────── */
for (const turns of [30, 34]) {
    const r = replay(`en-plan-${turns}`, 'en', turns);
    check(`${turns} turns: still no repeated topic`, r.topics.length, new Set(r.topics).size);
    check(`${turns} turns: still no repeated question text`, r.questions.length, new Set(r.questions).size);
    check(`${turns} turns: deepening carried the tail`, r.deepDives > 0, true);
}
/* Past 14 deep dives the angles cycle, deliberately (see DEEP_DIVE_ANGLES): reaching
   turn 40 inside a 12-minute cap means ~18s per exchange, and the candidate has already
   had 36 distinct questions. What must still hold is that no TOPIC repeats and that the
   reuse is bounded — a cycled angle is still a different question, because the model
   builds it from a different answer. */
const LONG = replay('en-plan-40', 'en', 40);
check('40 turns: still no repeated topic', LONG.topics.length, new Set(LONG.topics).size);
check('40 turns: deepening carried the tail', LONG.deepDives > 0, true);
check(
    '40 turns: no deepening angle is used more than twice',
    Math.max(...[...new Set(LONG.questions)].map((q) => LONG.questions.filter((x) => x === q).length)) <= 2,
    true
);

/* ── 3. the Arabic session is untouched ───────────────────────────────────── */
const AR = replay('ar-plan', 'ar', 16);
check('the Arabic session still reaches Phase 3', AR.phases.includes(3), true);
check('and reports it', AR.state?.phase, 3);
check('Arabic needs no deep dive in its short Phase 2', AR.deepDives, 0);
check(
    'Arabic Phase 2 serves base topics only',
    AR.topics.every((t) => (PHASE2_TOPIC_KEYS as readonly string[]).includes(t)),
    true
);

/* ── 4. the bank must not shrink when a session switches to Arabic ─────────── */
check(
    'one bank for both languages',
    getPhase2TopicKeys().length,
    PHASE2_TOPIC_KEYS.length + PHASE2_TOPIC_KEYS_EXTRA.length
);
check(
    'the base six come first, so a short Arabic Phase 2 is unchanged',
    getPhase2TopicKeys().slice(0, 6).join(','),
    PHASE2_TOPIC_KEYS.join(',')
);

/* ── 5. no extra topic may duplicate a Phase 1 pool question ───────────────── */
/* The first attempt at this plan shipped `mistake`, `feedback`, `conflict`,
   `pressure` and `motivation` — every one already asked by a Phase 1 pool (p7 "a
   time you made a mistake", p7 "the last piece of feedback", p3 "conflict within
   a team", p3 "time pressure", p1 "what motivated you to apply"). A repetition
   fix that re-created repetition. This pins the retreat. */
const POOL_TEXT = Object.values(POOL_QUESTIONS as Record<string, any>)
    .flatMap((p: any) => ['L1', 'L2', 'L3'].flatMap((l) => (p[l] ?? []).map((q: any) => String(q.en).toLowerCase())))
    .join(' | ');
const EXTRA_TEXT = PHASE2_TOPIC_KEYS_EXTRA.map((k) =>
    buildPhase2TopicPrompt(k, false, PROFILE).toLowerCase()
).join(' | ');
for (const phrase of ['made a mistake', 'piece of feedback', 'criticism', 'conflict', 'time pressure', 'motivated you to apply']) {
    check(`the pools already ask about "${phrase}"`, POOL_TEXT.includes(phrase), true);
    check(`so no extra topic re-asks "${phrase}"`, EXTRA_TEXT.includes(phrase), false);
}
check(
    'tool_depth does not fall back to the skill the base topic already used',
    buildPhase2TopicPrompt('tool_depth', false, { skills: ['Reporting'] }).includes('Reporting'),
    false
);
/* ⚠️ The English side alone is not enough: a mutation that re-introduced the
   `mistake` question on the ARABIC side of a handler passed this file untouched.
   Both renderings reach a candidate — the Arabic one after a mid-session switch. */
const EXTRA_TEXT_AR = PHASE2_TOPIC_KEYS_EXTRA.map((k) => buildPhase2TopicPrompt(k, true, PROFILE)).join(' | ');
for (const phrase of ['غلط', 'ملاحظة', 'انتقاد', 'خلاف', 'ضغط الوقت', 'حمسك']) {
    check(`nor does any Arabic rendering re-ask "${phrase}"`, EXTRA_TEXT_AR.includes(phrase), false);
}
check(
    'every extra renders a real prompt, not the generic fallback',
    PHASE2_TOPIC_KEYS_EXTRA.every(
        (k) => !buildPhase2TopicPrompt(k, false, PROFILE).startsWith('Ask the candidate about the most relevant')
    ),
    true
);
check(
    'and each extra also renders in Arabic, for a mid-session switch',
    PHASE2_TOPIC_KEYS_EXTRA.every((k) => /[؀-ۿ]/.test(buildPhase2TopicPrompt(k, true, PROFILE))),
    true
);

/* ── 6. one formula, two readers ──────────────────────────────────────────── */
check('reported phase at turn 13, Arabic', computePhaseByCount(13, 'ar'), 3);
check('reported phase at turn 13, English', computePhaseByCount(13, 'en'), 2);
check('reported phase at turn 25, English', computePhaseByCount(25, 'en'), 2);
check('an unspecified language keeps the Arabic behaviour', computePhaseByCount(13, undefined), 3);

/* ── 7. the honest-report rule must not swallow every English interview ────── */
check(
    'a browser-closed English interview that got past Phase 1 is not reported incomplete',
    endedBeforeEnglishPhase({
        completedByServer: false,
        phaseReached: 2,
        sessionLanguage: 'en',
        userMessageCount: 20,
    }),
    false
);
check(
    'but one cut short inside Phase 1 still is',
    endedBeforeEnglishPhase({
        completedByServer: false,
        phaseReached: 1,
        sessionLanguage: 'en',
        userMessageCount: 4,
    }),
    true
);
check(
    'a browser-closed Arabic interview below Phase 3 still is',
    endedBeforeEnglishPhase({ completedByServer: false, phaseReached: 2, sessionLanguage: 'ar' }),
    true
);
check(
    'a server-completed interview never is',
    endedBeforeEnglishPhase({
        completedByServer: true,
        phaseReached: 1,
        sessionLanguage: 'en',
        userMessageCount: 2,
    }),
    false
);
check(
    'and an unknown phase is still not evidence',
    endedBeforeEnglishPhase({ completedByServer: false, phaseReached: null, sessionLanguage: 'ar' }),
    false
);

if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
}
console.log('\nall checks passed');
