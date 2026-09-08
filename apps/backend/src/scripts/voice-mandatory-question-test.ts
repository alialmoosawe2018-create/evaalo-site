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
import { selectNextQuestion } from '../evaalo-only-voice/questionEngine.js';
import { getControllerOutput } from '../evaalo-only-voice/interviewController.js';
import { MANDATORY_QUESTIONS } from '../evaalo-only-voice/interviewConfig.js';

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

// ── a pool question must still be built from its topic ────────────────────────
//
// The fix must not disable topic mode; only questions carrying an explicit text
// change branch. Pool questions carry topic alone.
// A pool question carries BOTH text and topic — the topic purely as bookkeeping
// for the topic memory (questionEngine ~957). So the branch cannot key on the
// presence of `text`, or every phase-1 question would switch mode at once.
const poolTurn = getControllerOutput(
    6,
    { firstMandatoryAsked: true, secondMandatoryAsked: true } as never,
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
