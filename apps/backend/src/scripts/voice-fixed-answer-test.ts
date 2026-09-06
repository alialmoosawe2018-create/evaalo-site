/**
 * Regression: a deliberate fixed answer must not be thrown away by the question
 * validator.
 *
 * From production session a8a8d6fd (2026-09-06). The candidate asked who the
 * agent was — twice — and was ignored both times. The chain, from the server log:
 *
 *   [TRANSCRIPT] "ممكن تعرفيني عن انت منو؟ عن"
 *   [LLM TIME]   10ms                       ← canned answer, no model call
 *   [ENGINE VALIDATE] LLM reply invalid, using fallback
 *
 * `getAgentIdentityMergedReply` short-circuits when there is no usable previous
 * question to append, returning the identity text plus «خلينا نكمل المقابلة.» —
 * a statement. `validateLLMQuestion` rejects anything without a question mark or
 * an interrogative, so the answer was replaced by an unrelated fallback question
 * and the candidate never heard it.
 *
 * The validator exists to check questions the MODEL invents. A canned identity or
 * policy answer is neither invented nor a question, so those turns are exempt —
 * exactly as clarification and follow-up turns already were.
 *
 * Run: npx tsx src/scripts/voice-fixed-answer-test.ts
 */
import { resolveFixedAnswerPath } from '../services/llmService.js';
import { validateLLMQuestion, classifyInterviewPolicyIntent } from '../evaalo-only-voice/questionEngine.js';

let pass = 0;
let fail = 0;
function check(label: string, got: unknown, expected: unknown) {
    const okNow = JSON.stringify(got) === JSON.stringify(expected);
    okNow ? (pass += 1) : (fail += 1);
    console.log(`  ${okNow ? '✓' : '✗'} ${label.padEnd(52)} متوقع=${JSON.stringify(expected)} فعلي=${JSON.stringify(got)}`);
}

const base = { currentPhase: 1 as const };

console.log('١) النصوص الحرفية من جلسة a8a8d6fd تُصنَّف ردّاً ثابتاً');
check('اه ممكن تعرفيني عن نفسك لو', resolveFixedAnswerPath('اه ممكن تعرفيني عن نفسك لو', base as never), 'identity');
check('ممكن تعرفيني عن انت منو؟ عن', resolveFixedAnswerPath('ممكن تعرفيني عن انت منو؟ عن', base as never), 'identity');
check('مين أنت؟', resolveFixedAnswerPath('مين أنت؟', base as never), 'identity');
check('قيمني، شنو رأيك بيّا؟', resolveFixedAnswerPath('قيمني، شنو رأيك بيّا؟', base as never), 'policy');

console.log('\n٢) طلب التوضيح يسبق كل شيء — ليس ردّاً ثابتاً');
check(
    'مين أنت؟ + clarificationRequested',
    resolveFixedAnswerPath('مين أنت؟', { ...base, clarificationRequested: true } as never),
    null,
);

console.log('\n٣) الدور العادي يبقى خاضعاً للمدقّق');
check('إجابة عادية', resolveFixedAnswerPath('استخدمت اكسل ووورد بشغلي', base as never), null);
check('إجابة عن التحديات', resolveFixedAnswerPath('واجهت العديد من الملاحظات', base as never), null);

console.log('\n٤) لماذا يلزم الاستثناء: المدقّق يرفض الردّ الثابت');
const cannedIdentity =
    'آني إيفالو، مساعد موارد بشرية افتراضي يعمل بالذكاء الاصطناعي. دوري هو إدارة المقابلة معك خطوة بخطوة، من خلال طرح أسئلة منظمة وتحليل إجاباتك بشكل دقيق.\n\nخلينا نكمل المقابلة.';
check('المدقّق يرفضه (ولذلك نستثنيه)', validateLLMQuestion(cannedIdentity), false);
check('وهو فعلاً بلا سؤال', /[?؟]/.test(cannedIdentity), false);

// ── ٥) ذكر «نتيجة» في إجابة ليس سؤالاً عنها ──────────────────────────────────
// من جلسة d9eb5536: قال المرشح «وطلعنا بنتيجه» وهو يصف عملاً جماعياً، فردّ
// الوكيل بسياسة النتائج وودّعه في منتصف المقابلة — مرتين.
console.log('\n٥) «نتيجة» داخل إجابة عادية — لا تُطلق حارس السياسة');
const notAsking = [
    'عملت بها ضمن فريق كان عندنا شد داون وصار تعاون مشترك بيننا وباقي الاقسام. وطلعنا بنتيجه ورجانا تشغيل',
    'وصلنا لنتيجة ممتازة مع الفريق',
    'النتيجه النهائيه انه اختصرت كثير من الوقت',
    'كان في قبول كبير للفكرة من الإدارة',
];
for (const t of notAsking) check(t.slice(0, 44), classifyInterviewPolicyIntent(t), null);

console.log('\n٦) والسؤال الحقيقي ما زال يُلتقط');
const asking: [string, string][] = [
    ['متى تطلع النتيجة؟', 'ask_result'],
    ['شصارت النتيجة؟', 'ask_result'],
    ['يعني أحب أعرف شوكت راح تنعلن النتيجة', 'ask_result'],
    ['شنو النتيجة؟', 'ask_result'],
    ['هل انقبل؟', 'ask_result'],
];
for (const [t, want] of asking) check(t, classifyInterviewPolicyIntent(t), want);

// ── ٧) صدّ الإنجليزية يبقى تحت المدقّق ──────────────────────────────────────
// استثناؤه ألغى حارس التكرار معه، فطُرح سؤال اللغات أربع مرات في نفس الجلسة.
console.log('\n٧) صدّ الإنجليزية يُصنَّف — لكنه لا يُستثنى من المدقّق');
// المُحدِّد يُرجع المسار؛ والاستثناء في voiceSessionCore محصور في الهوية والسياسة،
// وهو ما نُثبته هنا بنفس الشرط الذي يستعمله هناك.
const EXEMPT = new Set(['identity', 'policy']);
const engPath = resolveFixedAnswerPath(
    'اللغة اللي اقدر احكيها هي اللغة الانجليزية ومستواي متوسط',
    { ...base, sessionLanguage: 'ar' } as never,
);
check('المسار يُصنَّف صحيحاً', engPath, 'early-english');
check('ولا يُعفى من المدقّق (فيبقى حارس التكرار)', EXEMPT.has(String(engPath)), false);
check('بينما الهوية تُعفى', EXEMPT.has(String(resolveFixedAnswerPath('مين أنت؟', base as never))), true);

console.log(`\n${fail === 0 ? '✅' : '⚠️'}  نجح ${pass} · فشل ${fail}`);
if (fail > 0) process.exitCode = 1;
