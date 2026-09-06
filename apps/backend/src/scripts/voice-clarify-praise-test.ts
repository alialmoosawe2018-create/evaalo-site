/**
 * Regression for two defects seen in production voice session 1fc16115
 * (2026-09-06, HR supervisor interview, candidate answering in Iraqi Arabic).
 *
 * 1. «ويها» — the agent said "وكيف تعاملت ويها؟". The form does not exist in the
 *    dialect (iraqiDialectReference marks it FORBIDDEN; the correct word is
 *    «وياها»). A correction already existed, written as
 *    `/\bتتعامل\s+ويها\b/` — and it had never once fired: JavaScript defines \b
 *    through \w, which is [A-Za-z0-9_], so there is no word boundary between a
 *    space and an Arabic letter. Not even the present-tense case it was written
 *    for was ever corrected.
 *
 * 2. Praise after a non-answer. The candidate said "يعني سؤالك مو منطقي صراحه"
 *    and the agent opened its reply with "عاشت ايدك"; he then said "السؤال غير
 *    واضح" and it opened with "ممتاز". The system prompt asks for an
 *    acknowledgment on every turn, so the model praises even when nothing was
 *    answered — it reads as not listening. A clarification turn now gets a
 *    neutral opener instead.
 *
 * Run: npx tsx src/scripts/voice-clarify-praise-test.ts
 */
import { polishVoiceArabicReply } from '../services/llmService.js';

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

let checks = 0;
const ok = (label: string) => {
    checks += 1;
    console.log('  ✓ ' + label);
};

// ── 1) «ويها» → «وياها» ──────────────────────────────────────────────────────
console.log('«ويها» تُصحَّح بعد أي فعل:');

const mustFix: [string, string][] = [
    // النصّ الحرفي من جلسة 1fc16115
    [
        'جيد، شنو التحديات اللي واجهتك خلال تطوير الأداة الجديدة، وكيف تعاملت ويها؟',
        'تعاملت وياها',
    ],
    // الحالة المضارعة — التي كانت القاعدة القديمة تدّعي إصلاحها ولا تفعل
    ['طيب، شلون تتعامل ويها بالعادة؟', 'تتعامل وياها'],
    // فعل ثالث، لإثبات أن الإصلاح ليس مقيّداً بفعل بعينه
    ['تمام، شنو سويت ويها بعدين؟', 'سويت وياها'],
];

for (const [input, expectedFragment] of mustFix) {
    const out = polishVoiceArabicReply(input);
    assert(
        out.includes(expectedFragment),
        `لم تُصحَّح «ويها»:\n  دخل : ${input}\n  خرج : ${out}\n  متوقع أن يحتوي: ${expectedFragment}`
    );
    assert(!out.includes('ويها '), `بقيت «ويها» في المخرج: ${out}`);
    ok(expectedFragment);
}

// لا تُمسّ الصيغة الصحيحة، ولا كلمة تبدأ بالحروف نفسها.
console.log('\nلا يمسّ ما هو سليم:');
for (const untouched of [
    'ممتاز، شلون تعاملت وياها؟',
    'طيب، ويهاب زميلك شنو رأيه؟',
]) {
    const out = polishVoiceArabicReply(untouched);
    assert(
        out === untouched,
        `تغيّر نصّ سليم:\n  دخل: ${untouched}\n  خرج: ${out}`
    );
    ok(untouched);
}

// ── 2) لا مديح حين لم يُجب المرشح ────────────────────────────────────────────
console.log('\nطلب التوضيح لا يُقابَل بمديح:');

const praiseOpeners: [string, string][] = [
    // النصّان الحرفيان من الجلسة
    [
        'عاشت ايدك، شلون تحچي مع زملاء العمل لما تستخدمون تقنيات الذكاء الاصطناعي؟',
        'عاشت ايدك',
    ],
    ['ممتاز، تگدر تحچيلي شلون تستخدم مهاراتك في شغلك؟', 'ممتاز'],
    ['زين، شنو تقصد بالضبط بهالسؤال؟', 'زين'],
    ['حلو، خلني أعيد صياغة السؤال.', 'حلو'],
];

for (const [input, praise] of praiseOpeners) {
    const suppressed = polishVoiceArabicReply(input, { clarificationRequested: true });
    assert(
        !suppressed.startsWith(praise),
        `بقي المديح رغم طلب التوضيح:\n  دخل: ${input}\n  خرج: ${suppressed}`
    );
    assert(
        suppressed.startsWith('طيب،'),
        `لم تُستبدل بإقرار محايد:\n  خرج: ${suppressed}`
    );
    // الجملة نفسها يجب أن تبقى — الاستبدال يمسّ الافتتاحية وحدها.
    const body = input.slice(input.indexOf('،') + 1).trim();
    assert(
        suppressed.includes(body.slice(0, 20)),
        `فُقد نصّ السؤال:\n  خرج: ${suppressed}`
    );
    ok(`${praise} → طيب`);
}

// بعد إجابة حقيقية يبقى المديح كما هو — الكتم مشروط لا مطلق.
console.log('\nبعد إجابة حقيقية يبقى المديح:');
const answered = 'عاشت ايدك، شنو الأدوات الرقمية اللي استخدمتها بشغلك؟';
const kept = polishVoiceArabicReply(answered);
assert(
    kept.startsWith('عاشت ايدك'),
    `كُتم المديح في دور عادي:\n  خرج: ${kept}`
);
ok('دور عادي بلا كتم');

// طلب تغيير السؤال يُعامَل معاملة طلب التوضيح.
const changed = polishVoiceArabicReply(answered, { changeRequested: true });
assert(changed.startsWith('طيب،'), `طلب التغيير لم يكتم المديح: ${changed}`);
ok('طلب تغيير السؤال');

// ── 3) لا اقتباس حول مصطلح في كلام مسموع ────────────────────────────────────
console.log('\nاقتباس القالب يُنزع:');

const quoted: [string, string][] = [
    // النصّ الحرفي من جلسة 1fc16115
    [
        'ممتاز، تگدر تحچيلي شلون تستخدم مهارة "التواصل" في شغلك؟',
        'مهارة التواصل',
    ],
    // القوالب الأخرى في questionEngine تستعمل الاصطلاح نفسه
    ['طيب، حدثني عن شهادتك "PMP" وشلون تفيدك؟', 'شهادتك PMP'],
    ['تمام، شنو التحديات بشركتك الحالية "زين العراق"؟', 'شركتك الحالية زين العراق'],
];

for (const [input, expectedFragment] of quoted) {
    const out = polishVoiceArabicReply(input);
    assert(
        out.includes(expectedFragment),
        `لم يُنزع الاقتباس:\n  دخل: ${input}\n  خرج: ${out}`
    );
    assert(!/["“”«»]/u.test(out), `بقيت علامة اقتباس: ${out}`);
    ok(expectedFragment);
}

console.log(`\n✅ نجحت ${checks} حالة.`);
