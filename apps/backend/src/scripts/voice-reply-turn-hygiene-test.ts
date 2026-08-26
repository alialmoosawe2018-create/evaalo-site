/**
 * Regression: one question per spoken turn, and no system instructions spoken aloud.
 *
 * Fixtures are verbatim agent turns from the concurrent sessions of 2026-08-26
 * (cb68531d, 02b581b7, f06e9ac7):
 *
 *  - The Phase 2 language topic was written as a directive carrying constraints
 *    ("استخدم تگدر تحچيلي وليس تقوليلي"), so the rephrase step rephrased the
 *    constraint too and the candidate heard it. The directive is now clean, and
 *    this guard keeps any future bank edit from reaching audio silently.
 *  - Multi-part directives produced three questions in one breath; a candidate
 *    can only hold the last one by ear, which showed up as truncated answers.
 *
 * Run: npx tsx src/scripts/voice-reply-turn-hygiene-test.ts
 */
import { polishVoiceArabicReply } from '../services/llmService.js';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
    if (cond) console.log(`ok   ${name}`);
    else {
        failures += 1;
        console.error(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
    }
}

// ── تسريب التعليمات ────────────────────────────────────────────────────────────
const leaked = 'ممتاز، شنو اللغات اللي تگدر تحچيها وشكد مستواك بكل وحدة؟ ويفضل تگدر تحچيلي وليس تحچيلي.';
const leakOut = polishVoiceArabicReply(leaked);
check('leaked dialect directive is stripped', !/وليس\s+تح[چج]يلي/u.test(leakOut), leakOut);
check('a question survives the strip', /[؟?]\s*$/u.test(leakOut), leakOut);

const leakedForm = 'طيب، شنو مستواك بالإنكليزية؟ لا تذكر مستوى أي لغة من الاستمارة.';
const leakedFormOut = polishVoiceArabicReply(leakedForm);
check('leaked form directive is stripped', !/من\s+الاستمارة/u.test(leakedFormOut), leakedFormOut);

// ── سؤال واحد في الدور ─────────────────────────────────────────────────────────
const twoQuestions =
    'ممتاز، شنو خبرتك في مجال Compensation and Benefits Specialist؟ وكم سنة اشتغلت بهالمجال، وشو الشركات اللي اشتغلت بيها؟';
const oneOut = polishVoiceArabicReply(twoQuestions);
check('second question is dropped', (oneOut.match(/[؟?]/gu) || []).length === 1, oneOut);
check('first question is kept intact', oneOut.includes('شنو خبرتك في مجال'), oneOut);

const single = 'طيب، شلون تتعامل مع الضغوط في العمل؟';
check('a single question is untouched', polishVoiceArabicReply(single) === single);

// إعلان اختبار الإنجليزية: نقطة ثم سؤال قصير — لا يجوز أن يُقصّ
const announcement = 'هسة راح أختبر لغتك الإنكليزية. جاهز؟';
check('English test announcement is untouched', polishVoiceArabicReply(announcement) === announcement);

// علامة شاردة في المقدمة لا تُعتبر سؤالاً أولاً فيُمسح الردّ
const strayLead = 'طيب؟ شنو أهم مهارة تعتمد عليها في شغلك؟';
const strayOut = polishVoiceArabicReply(strayLead);
check('stray leading mark does not truncate the reply', /مهارة/u.test(strayOut), strayOut);

if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
}
console.log('\nall turn-hygiene cases passed');
