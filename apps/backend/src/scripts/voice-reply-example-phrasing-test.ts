/**
 * Regression: asking for an example must use the imperative, not "شنو مثال…".
 *
 * Fixtures are verbatim agent turns from production session 0b77c999
 * (2026-08-26): the model produced "شنو مثال على مشروع…" and "شنو مثال على كيف
 * استخدمت…" because the prompt required every question to open with an explicit
 * interrogative, which left no room for the imperative. "شنو مثال" is not
 * grammatical Arabic and not Iraqi dialect, and "على كيف" also violates the
 * كيف→شلون rule.
 *
 * Run: npx tsx src/scripts/voice-reply-example-phrasing-test.ts
 */
import { polishVoiceArabicReply } from '../services/llmService.js';

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

const mustRewrite = [
    'طيب، شنو مثال على مشروع أو مهمة استخدمت بيها هالطريقة ونجحت فيها؟',
    'حلو، شنو مثال على كيف استخدمت برامج الذكاء الاصطناعي في تحسين عمليات الموارد البشرية عندك؟',
    'ممتاز، شنو أمثلة على المهام اللي تنجزها أسبوعياً؟',
    'شنو مثال عن موقف صعب واجهته؟',
];

/** مثال بلا «شنو» قبله صياغة سليمة — لا يجوز أن يلمسها المصحّح */
const mustKeep = [
    'ولو موقف بسيط — تگدر تعطيني مثال محدد صار وياك وشلون تعاملت وياه؟',
    'ممتاز، شنو خبراتك السابقة في مجال عملك؟',
    'Could you give me an example of a project you led?',
];

let failures = 0;

for (const input of mustRewrite) {
    const out = polishVoiceArabicReply(input);
    try {
        assert(!/(شنو|شو)\s+(?:هو\s+|هي\s+)?(مثال|أمثلة|امثلة)/u.test(out), `"شنو مثال" survived: "${out}"`);
        assert(/انطيني\s+(مثال|أمثلة|امثلة)/u.test(out), `imperative missing: "${out}"`);
        assert(!/على\s+كيف/u.test(out), `"على كيف" survived: "${out}"`);
        assert(/[؟?]\s*$/.test(out), `question mark lost from the end: "${out}"`);
        console.log(`ok   rewrite → ${out}`);
    } catch (err: any) {
        failures += 1;
        console.error(`FAIL rewrite → ${err.message}`);
    }
}

for (const input of mustKeep) {
    const out = polishVoiceArabicReply(input);
    if (out === input) {
        console.log(`ok   keep    → ${out}`);
    } else {
        failures += 1;
        console.error(`FAIL keep    → expected unchanged\n  in:  ${input}\n  out: ${out}`);
    }
}

if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
}
console.log('\nall example-phrasing cases passed');
