/**
 * Regression for the opening question in production session 6afff73c.
 *
 * The agent's first question to Fatima was:
 *
 *   «ممتاز، بما أنك بدأت بالتقديم عن نفسك، شنو أكثر شي تحب تسوي لما تعرف نفسك
 *    للآخرين؟»
 *
 * Three things are wrong with one sentence, and they share one cause.
 *
 * `selectNextQuestion` returns the mandatory opening question with BOTH `text`
 * («ممكن تحچيلي شوية عن نفسك؟») and `topic` («warmup_and_self_introduction»).
 * `createSystemPrompt` tested `topic` FIRST, so the text was dropped and the
 * model was handed the topic slug plus the candidate's last words. It read the
 * slug literally - "self introduction" - and asked what she likes to do when
 * introducing herself, which is a question about the act, not about her. Her
 * last words were «شكرا جزيلا», a reply to the greeting, so the model both
 * invented a bridge from them («بما أنك بدأت بالتقديم عن نفسك» - she had not)
 * and praised them («ممتاز»).
 *
 * The type's own comment says `topic` means "topic فقط". The fix makes the code
 * say that too, and the mandatory text now reaches the model.
 *
 * Run: npm run test:voice-mandatory-question
 */
import { buildSystemPrompt, polishVoiceArabicReply } from '../services/llmService.js';
import { selectNextQuestion, pickPhase2Topic } from '../evaalo-only-voice/questionEngine.js';
import { getControllerOutput } from '../evaalo-only-voice/interviewController.js';
import { buildRoleTaskQuestion, MANDATORY_QUESTIONS } from '../evaalo-only-voice/interviewConfig.js';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
    if (actual === expected) {
        console.log(`ok   ${name}`);
    } else {
        failures += 1;
        console.error(`FAIL ${name}: expected ${String(expected)}, got ${String(actual)}`);
    }
}

// ── the controller still asks for the opening question ────────────────────────
const opening = getControllerOutput(0, undefined, 'ar');
check('turn 0 is the opening mandatory question', opening.mandatoryQuestionDue, 1);
check('and it is phase 1', opening.phase, 1);

// ── the engine still carries both fields (this is not the bug) ────────────────
const selected = selectNextQuestion(opening, undefined, 'ar');
check('engine selects the mandatory text', selected?.text, MANDATORY_QUESTIONS[1].iq);
check('and tags it with a topic too', selected?.topic, 'warmup_and_self_introduction');
check('and marks it as pool 0 (mandatory)', selected?.pool, 0);

// ── the fix: that text must reach the model ───────────────────────────────────
//
// This is the assertion that would have caught the defect. Before the fix the
// prompt contained the slug and not one word of the question.
const prompt = buildSystemPrompt({
    currentPhase: 1,
    mandatoryQuestionDue: 1,
    selectedQuestion: selected ?? undefined,
    candidateLastAnswer: 'شكرا جزيلا',
    candidateProfile: { gender: 'female' },
});

check(
    'the mandatory question text is in the prompt',
    prompt.includes(MANDATORY_QUESTIONS[1].iq),
    true
);
check(
    'the topic slug is NOT what the model is asked to build from',
    /ask a question about this topic/i.test(prompt),
    false
);
check('the model is told to rephrase, not invent', /Rephrase this question/i.test(prompt), true);
check(
    'and told to keep a mandatory question intact',
    /MANDATORY question asked to every candidate/i.test(prompt),
    true
);
check(
    'and forbidden from asserting what the candidate did',
    /may not assert anything about the candidate/i.test(prompt),
    true
);
// The guard that already existed but sat in the branch that was never reached.
check(
    'the anti-narrowing rule now applies to it',
    /Do NOT narrow a broad question/i.test(prompt),
    true
);

// ── the opening question is REPHRASED by the model, not pinned ───────────────
//
// It was pinned in 1286890 after the model narrowed it to «شنو خبرتك في مجال
// الهندسة البترولية؟» (session d4cec7ea). The owner overruled that on 2026-09-12:
// pinning treats the symptom. It now behaves like the second mandatory (Office) —
// the model phrases it, and `textIsAuthoritative` guarantees the model receives
// the TEXT rather than the topic slug, which is what caused the original defect
// in 64bc19d (a question invented from `warmup_and_self_introduction`).
//
// What still holds it: the "do NOT narrow" rule and the pool===0 MANDATORY note
// in llmService. If narrowing returns, the fix is a guard on the OUTPUT — never
// a second pin.
check('the opening question is left to the model', selected?.isFixed ?? false, false);
check('but the model receives its exact text, not the topic slug', selected?.text, MANDATORY_QUESTIONS[1].iq);
check('and that text is authoritative in the prompt', selected?.textIsAuthoritative, true);

// ── the role question: mandatory, early, and immune to narrowing ──────────────
//
// ⚠️ Measured over 16 real interviews (2026-09-10). `relevant_experience_role_fit`
// carries 20 of the 100 points and was rated in 16/16 — while a role question was
// asked in only 6/16. Ten candidates were scored on a question never put to them,
// from crumbs dropped in the self-introduction; crumbs never reach "Good", which
// is why that dimension read Intermediate 14, Good 0, Excellent 0.
//
// It lived in phase 2 and short interviews never got there: every run of 5-10
// questions asked it zero times. It sits at turn 2 now, before Office, so the
// shortest measured interview (5 questions) still reaches it.
//
// And it is FIXED, like the opener and for the same reason: the phase-2 directive
// said "ask about a day-to-day task", and the model turned it into "how many years
// have you worked" 6 times against 2 — three to one. Past-experience is a different
// question measuring a different thing, and it dead-ends on "I have no experience",
// which is honest and measures nothing.
const roleDue = getControllerOutput(2, { firstMandatoryAsked: true } as never, 'ar');
check('turn 2 is the role mandatory', roleDue.mandatoryQuestionDue, 3);

const roleQ = selectNextQuestion(roleDue, undefined, 'ar', undefined, {
    position_applied_for: 'Senior HR Specialist',
} as never);
check('the role question skips the LLM entirely', roleQ?.isFixed, true);
check('its text is authoritative', roleQ?.textIsAuthoritative, true);
check(
    'and it is the exact role text, with the position in it',
    roleQ?.text,
    buildRoleTaskQuestion('Senior HR Specialist').iq
);
check('it asks forward, not for past years', /المهمّة اليوميّة/.test(roleQ?.text ?? ''), true);
check('it never asks how many years', /كم سنة|شكد سنة/.test(roleQ?.text ?? ''), false);
check('it books its own topic so a pool cannot repeat it', roleQ?.topic, 'role_task_and_fit');

// ── and it must book the PHASE 2 topic too — the repeat the owner heard ───────
//
// Two registries, deliberately separate: `askedTopics` (phase 1, keyed by
// `topic`) and `askedPhase2Topics` (phase 2, keyed by `topicKey`). The role
// question lives in BOTH — mandatory at turn 2, and the FIRST phase-2 topic
// since d88e1af. Booking only the phase-1 key let phase 2 serve it again.
//
// Measured in production session 621efd4e (2026-09-11): turn 2 «شنو المهمّة
// اليوميّة اللي تتوقّع تسويها بوظيفة …»، turn 9 the same question reworded, and
// the candidate answered «سألتيني هذا السؤال وجاوبتك».
check('it also books the phase-2 role topic', roleQ?.topicKey, 'role');
check('the other mandatories book no phase-2 topic', selected?.topicKey, undefined);

// …and the picker must then skip it.
check(
    'phase 2 no longer opens on role once the mandatory booked it',
    pickPhase2Topic({ askedPhase2Topics: ['role'], userMessageCount: 9 } as never, false) !== 'role',
    true
);
check(
    'while an interview that never booked it still gets it',
    pickPhase2Topic({ askedPhase2Topics: [], userMessageCount: 9 } as never, false),
    'role'
);

// No position on file must not drop the question — it falls back to a neutral wording.
const roleNoPos = selectNextQuestion(roleDue, undefined, 'ar');
check('still asked when no position is known', !!roleNoPos?.text, true);
check('and stays forward-looking', /المهمّة اليوميّة/.test(roleNoPos?.text ?? ''), true);

// Once asked, it must not come back and block Office.
const afterRole = getControllerOutput(
    3,
    { firstMandatoryAsked: true, roleMandatoryAsked: true } as never,
    'ar'
);
check('it is not re-asked once answered', afterRole.mandatoryQuestionDue !== 3, true);

// The second mandatory (Microsoft Office) deliberately stays on the rephrase
// path: its text is already specific so there is nothing to narrow, and it lands
// mid-interview where an acknowledgment opener reads naturally.
const secondDue = getControllerOutput(
    5,
    { firstMandatoryAsked: true, roleMandatoryAsked: true, secondMandatoryAsked: false } as never,
    'ar'
);
check('turn 5 is the second mandatory', secondDue.mandatoryQuestionDue, 2);
const secondQ = selectNextQuestion(secondDue, undefined, 'ar');
check('the second mandatory is its own text', secondQ?.text, MANDATORY_QUESTIONS[2].iq);
check('but is NOT fixed — it keeps its opener', secondQ?.isFixed, false);
check('and its text is still authoritative', secondQ?.textIsAuthoritative, true);

// ── a pool question must still be built from its topic ────────────────────────
//
// The fix must not disable topic mode; only questions carrying an explicit text
// change branch. Pool questions carry topic alone.
// A pool question carries BOTH text and topic — the topic purely as bookkeeping
// for the topic memory (questionEngine ~957). So the branch cannot key on the
// presence of `text`, or every phase-1 question would switch mode at once.
const poolTurn = getControllerOutput(
    6,
    { firstMandatoryAsked: true, roleMandatoryAsked: true, secondMandatoryAsked: true } as never,
    'ar'
);
const poolQ = selectNextQuestion(poolTurn, undefined, 'ar');
check('a pool question carries a text too', !!poolQ?.text, true);
check('and a topic', !!poolQ?.topic, true);
check('but its text is NOT authoritative', poolQ?.textIsAuthoritative, undefined);

const poolPrompt = buildSystemPrompt({
    currentPhase: 1,
    selectedQuestion: poolQ ?? undefined,
    candidateLastAnswer: 'اشتغلت بشركة نفط',
});
check(
    'so a pool question still uses topic mode (unchanged)',
    /ask a question about this topic/i.test(poolPrompt),
    true
);

// ── no praise on the opening turn ─────────────────────────────────────────────
//
// «شكرا جزيلا» is a reply to a greeting, not an answer. Praising it is the
// agent failing to tell the two apart, in the first thing it says.
const praised = polishVoiceArabicReply('ممتاز، ممكن تحچيلي شوية عن نفسك؟', {
    gender: 'female',
    mandatoryQuestionDue: 1,
});
check('the opening turn does not praise', /^ممتاز/.test(praised), false);
check('it opens neutrally instead', praised.startsWith('طيب،'), true);

// and praise is still allowed on an ordinary answered turn
const ordinary = polishVoiceArabicReply('ممتاز، شنو الأدوات اللي تستخدمينها؟', {
    gender: 'female',
});
check('an ordinary turn may still acknowledge', /^ممتاز/.test(ordinary), true);

if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
}
console.log('\nvoice-mandatory-question-test: OK');
