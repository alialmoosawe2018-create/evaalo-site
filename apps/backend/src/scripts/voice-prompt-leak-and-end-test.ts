/**
 * Regression for three defects found in voice session c6660f6c (2026-09-08).
 *
 * 1. THE AGENT READ ITS OWN INSTRUCTIONS ALOUD, including form data. The phase-2
 *    topic prompts in questionEngine are written as commands to the model
 *    («اسأل المرشح: … لا تذكر … استخدم كذا وليس كذا») and then placed in
 *    SelectedQuestion.text, which the rephrase branch hands over labelled
 *    "Question to rephrase". validateLLMQuestion passed the echo because it
 *    contains «؟».
 *
 * 2. A candidate saying he was leaving got another question. He said
 *    "I will end the interview. ثانك يو. Now I should go" and the agent asked
 *    how he prioritises tasks.
 *
 * 3. Polish was per-branch, so it could be skipped. Asserted here as idempotence:
 *    the single exit polish re-runs over already-polished text, and must not
 *    change it.
 *
 * Run: npm run test:voice-prompt-leak-end
 */
import { looksLikePromptInstruction, polishVoiceArabicReply } from '../services/llmService.js';
import { isEndInterviewRequest, buildRequestedClosing } from '../evaalo-only-voice/questionEngine.js';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
    if (actual === expected) {
        console.log(`ok   ${name}`);
    } else {
        failures += 1;
        console.error(`FAIL ${name}: expected ${String(expected)}, got ${String(actual)}`);
    }
}

// ── 1. the leak, verbatim as the candidate heard it ──────────────────────────
const LEAKED =
    'اسأل المرشح: شنو اللغات الي تگدر تحچيها؟ وشكد مستواك بكل لغة؟ اللغات من الاستمارة: Arabic، English، Persian. لا تذكر مستوى أي لغة من الاستمارة — اسأله عن المستوى بنفسك. استخدم تگدر تحچيلي وليس تحچيلي.';
check('the exact leaked line is caught', looksLikePromptInstruction(LEAKED), true);

// the rest of the family — every phase-2 topic prompt opens the same way
check(
    'the daily-task prompt is caught',
    looksLikePromptInstruction('اسأل المرشح عن مهمّة يوميّة يتوقّع أن يقوم بها في وظيفة Senior HR Specialist.'),
    true
);
check(
    'the skill prompt is caught',
    looksLikePromptInstruction('اسأل المرشح كيف يستخدم مهارة "HR operations" في عمله.'),
    true
);
check('a form-data leak alone is caught', looksLikePromptInstruction('اللغات من الاستمارة: Arabic، English.'), true);
check('an English-style instruction is caught', looksLikePromptInstruction('Ask the candidate about their background.'), true);

// and real questions must pass untouched
for (const good of [
    'طيب، تگدر تحچيلي شوية عن نفسك؟',
    'شنو اللغات الي تگدر تحچيها؟ وشكد مستواك بكل وحدة؟',
    'عاشت ايدك، شنو الأدوات الرقمية اللي استخدمتها في شغلك؟',
    'انطيني مثال محدد صار وياك.',
    'Can you share your professional background?',
]) {
    check(`a real question passes: "${good.slice(0, 34)}…"`, looksLikePromptInstruction(good), false);
}

// ── 2. the end request ───────────────────────────────────────────────────────
check(
    'his exact words are recognised',
    isEndInterviewRequest('I will end the interview. . ثانك يو. Now I should go'),
    true
);
for (const yes of [
    'اريد انهي المقابلة',
    'خلصنا المقابلة',
    'لازم اروح',
    'المقابلة خلصت',
    'I need to go',
    "I'm leaving",
    'can we end the interview please',
    'I want to stop',
]) {
    check(`end request: "${yes}"`, isEndInterviewRequest(yes), true);
}

// ⚠️ The asymmetry that governs this detector: ignoring a real request costs one
// awkward turn; ending by mistake costs the candidate their whole interview.
for (const no of [
    'انتهيت من المشروع قبل الموعد',
    'خلصت الشغل اللي عليّا',
    'باي باي',
    'مع السلامة',
    'شكرا جزيلا',
    'I finished the project last week',
    'we had to stop the machine for maintenance',
    'thank you',
]) {
    check(`NOT an end request: "${no}"`, isEndInterviewRequest(no), false);
}

// ── the closing it produces ends the session ─────────────────────────────────
const closingAr = buildRequestedClosing(true);
check('closing is fixed text (no LLM)', closingAr.isFixed, true);
check('closing ends the session', closingAr.isInterviewEnd, true);
check('closing acknowledges the request first', closingAr.text?.startsWith('تمام،'), true);
const closingEn = buildRequestedClosing(false);
check('english closing is english', /^Of course/.test(closingEn.text ?? ''), true);
check('english closing ends the session', closingEn.isInterviewEnd, true);

// ── 3. the single-exit polish must be idempotent ─────────────────────────────
//
// It now runs over text that inner paths may already have polished. If it were
// not idempotent, every reply would be altered twice.
for (const [label, raw, opts] of [
    ['praise opener', 'ممتاز، شنو الأدوات اللي استخدمتها؟', { gender: 'male', acknowledgmentTurn: 3 }],
    ['suppressed praise', 'ممتاز، تگدر تحچيلي عن نفسك؟', { mandatoryQuestionDue: 1 as const, gender: 'male' }],
    ['stray question mark', 'طيب، ؟ تگدر تحچيلي شوية عن نفسك؟', { gender: 'male' }],
    ['female gender by name', 'شنو تحب تعرف عن نفسك؟', { fullName: 'Zahraa Aqeel Salim' }],
    ['english praise', 'Good, thank you for sharing that. Can you explain?', { clarificationRequested: true }],
] as const) {
    const once = polishVoiceArabicReply(raw, opts as never);
    const twice = polishVoiceArabicReply(once, opts as never);
    check(`polish is idempotent — ${label}`, twice, once);
}

// and the exit polish still fixes what the inner paths missed
check(
    'the stray ؟ is removed at the exit',
    polishVoiceArabicReply('طيب، ؟ تگدر تحچيلي شوية عن نفسك؟', { gender: 'male' }),
    'طيب، تگدر تحچيلي شوية عن نفسك؟'
);
check(
    'gender is inferred at the exit from the name alone',
    polishVoiceArabicReply('شنو تحب تعرف عن نفسك؟', { fullName: 'Zahraa Aqeel Salim' }),
    'شنو تحبين تعرفين عن نفسك؟'
);

if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
}
console.log('\nvoice-prompt-leak-and-end-test: OK');
