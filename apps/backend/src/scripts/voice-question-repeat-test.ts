/**
 * Regression: the agent must not re-ask a question it already asked.
 *
 * Fixture = the full ordered agent turns of production session 86a64336 (2026-08-12),
 * where the candidate said "السؤال كررتي" after the agent repeated the languages
 * question, then the diploma question was repeated too.
 *
 * The `[AGENT]` log line caps at 80 chars, so the two repeated turns are completed
 * to their evident form; every other string is verbatim from the log.
 *
 * Run: npx tsx src/scripts/voice-question-repeat-test.ts
 */
import { validateLLMQuestion } from '../evaalo-only-voice/questionEngine.js';

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

const agentTurns = [
    'ممتاز، شنو هواياتك أو اهتماماتك خارج العمل؟',
    'عاشت ايدك، شنو رأيك بأهمية العمل الجماعي في الألعاب أو في مجال العمل؟',
    'زين، شنو الطرق اللي تستخدمها حتى تحسن مهاراتك في التواصل مع الآخرين؟',
    'تمام، شنو الأدوات الرقمية أو البرامج اللي تستخدمها في شغلك اليومي؟',
    'حلو، ؟ تگدر تحچيلي عن مستواك ببرامج مايكروسوفت أوفيس، وأي برنامج تعتقد هو الأكثر فائدة؟',
    'ممتاز، شنو التحديات اللي واجهتها أثناء استخدامك لبرامج مايكروسوفت، وكيف تعاملت وياها؟',
    'ممتاز، شنو الطرق اللي تستخدمها حتى تنظّم وقتك خلال مشروع جديد أو شغل جديد؟',
    'طيب، شنو تجربتك في العمل ضمن فريق، وكيف تگدر توفق بين مهامك الشخصية ومهام الفريق؟',
    'عاشت ايدك، شنو الخبرات السابقة اللي عندك في مجال العمل، وكيف كانت تأثيرها على مهاراتك؟',
    'ممتاز، تگدر تحچيلي شنو اللغات الي تگدر تحچيها، وشكد مستواك بكل وحدة منهن؟',
    'بعد شوية راح نوصل لمرحلة اختبار الإنجليزية.خلينا نكمل. زين، شنو اللغات اللي تگدر تحچيها؟',
    'تمام، تگدر تحچيلي عن شنو اللي استفدت من سنوات دراستك في الدبلوم، وشلون كانت تجربتك؟',
    'ممتاز، تگدر تحچيلي شنو الدروس اللي استفدت منها خلال سنوات دراستك (الدبلوم)، وشلون كانت؟',
    'هسة راح أختبر لغتك الإنكليزية. جاهز؟',
    'Can you share a recent accomplishment or success you experienced?',
];

/** المكرران فعلياً في الجلسة: إعادة سؤال اللغات، وإعادة سؤال الدبلوم */
const expectedRepeats = new Set([10, 12]);

/** نفس النافذة المستخدمة في الإنتاج: آخر 4 أسئلة للوكيل */
const WINDOW = 4;

const rejected: number[] = [];
for (let i = 0; i < agentTurns.length; i++) {
    const recent = agentTurns.slice(Math.max(0, i - WINDOW), i);
    if (!validateLLMQuestion(agentTurns[i], recent)) rejected.push(i);
}

for (const i of expectedRepeats) {
    assert(rejected.includes(i), `turn ${i} is a known repeat and must be rejected: "${agentTurns[i]}"`);
}
const falsePositives = rejected.filter((i) => !expectedRepeats.has(i));
assert(
    falsePositives.length === 0,
    `legitimate questions rejected: ${falsePositives.map((i) => `#${i} "${agentTurns[i]}"`).join(' | ')}`
);

// بدون تاريخ: الشكل وحده يحكم — سلوك متوافق مع ما قبل الحارس
assert(validateLLMQuestion(agentTurns[10]), 'no history must accept a shape-valid question');
assert(!validateLLMQuestion('حسناً.'), 'non-question must be rejected');
assert(!validateLLMQuestion('نعم', agentTurns), 'too-short reply must be rejected');

// المتابعة تعود لنفس الموضوع بقصد، فالمتصل لا يمرّر التاريخ لها
const followUp = 'شنو صار بالضبط؟ وصفلي الموقف.';
assert(validateLLMQuestion(followUp), 'follow-up prompt must stay valid when history is not passed');

// صياغتان مختلفتان تتشاركان نفس مقدمة السؤال — يجب ألا تُعدّا تكراراً
assert(
    validateLLMQuestion('تگدر تحچيلي شنو خبرتك بالإكسل؟', ['تگدر تحچيلي شنو مستواك بالإنجليزية؟']),
    'shared boilerplate opener alone must not count as a repeat'
);

console.log(`voice-question-repeat-test: OK (rejected exactly turns ${rejected.join(', ')})`);
