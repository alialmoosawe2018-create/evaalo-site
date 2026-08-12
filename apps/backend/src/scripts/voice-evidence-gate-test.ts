/**
 * Regression: Stage 2 evidence gate — thin sessions must not score.
 * Run: npx tsx src/scripts/voice-evidence-gate-test.ts
 */
import {
    assessVoiceInterviewEvidence,
    collapseRepeatedRuns,
    VOICE_EVAL_MIN_ANSWERED,
    VOICE_EVAL_MIN_DURATION_SEC,
    VOICE_EVAL_MIN_USER_CHARS,
} from '../services/voiceInterviewEvidenceGate.js';

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

const greetingOnly = [
    { role: 'assistant' as const, content: 'أهلاً وسهلاً حسن علاء، عندك مقابلة لوظيفة مساعد موارد بشرية في إيفالو. نتمنى لك التوفيق!' },
    { role: 'user' as const, content: 'اهلينا أهلين وسهلين بطريقة' },
    { role: 'assistant' as const, content: 'ممتاز، شنو أكثر شي تحب تسوي بوقتك الفاضي؟' },
];

const hassan = assessVoiceInterviewEvidence(greetingOnly, 21);
assert(!hassan.ok, 'Hassan-like 21s greeting session must fail');
assert(hassan.userTurns === 1, `expected 1 user turn, got ${hassan.userTurns}`);
assert(
    hassan.reasons.some((r) => r.startsWith('duration_sec=')),
    'must cite duration'
);
assert(
    hassan.reasons.some((r) => r.startsWith('answered_questions=')),
    'must cite answered questions'
);

const ahmedCutOff = [
    { role: 'assistant' as const, content: 'أهلاً وسهلاً أحمد' },
    { role: 'user' as const, content: 'وسهلا بك. وسهلا بحضرتك. التوفيق للجميع يا رب.' },
    { role: 'assistant' as const, content: 'شنو أكثر شي تحب تسويه بوقتك الفاضي؟' },
    { role: 'user' as const, content: 'في' },
    { role: 'assistant' as const, content: 'شنو رأيك بأهمية التواصل؟' },
    { role: 'user' as const, content: 'ممكن توضحي لي سؤالك اكثر؟ والله جذاب.' },
    { role: 'assistant' as const, content: 'ليش التواصل مهم؟' },
    { role: 'user' as const, content: 'في ممكن توضحي لي السؤال اكثر لو' },
    { role: 'assistant' as const, content: 'ليش تگدر تحچيلي؟' },
    { role: 'user' as const, content: 'حكيت النوب رجع انقطع. اول شي' },
];
const ahmed = assessVoiceInterviewEvidence(ahmedCutOff, 71);
assert(!ahmed.ok, 'Ahmed-like 71s cut-off must fail duration gate');
assert(ahmed.durationSec === 71, 'duration should be 71');

const solid = [
    { role: 'assistant' as const, content: 'Welcome to the interview.' },
    {
        role: 'user' as const,
        content:
            'I have three years of HR experience supporting recruitment, onboarding, and employee records.',
    },
    { role: 'assistant' as const, content: 'Tell me about a conflict you resolved.' },
    {
        role: 'user' as const,
        content:
            'I mediated between two teammates by clarifying ownership and setting a shared checklist that closed the issue in one week.',
    },
    { role: 'assistant' as const, content: 'How is your Microsoft Office level?' },
    {
        role: 'user' as const,
        content:
            'Strong Excel and Word; I build pivot reports and maintain shared trackers for the HR team daily.',
    },
];
const ok = assessVoiceInterviewEvidence(solid, 180);
assert(ok.ok, `solid session must pass: ${ok.reasons.join(', ')}`);
assert(ok.answeredQuestions >= VOICE_EVAL_MIN_ANSWERED, 'answered');
assert(ok.substantiveUserChars >= VOICE_EVAL_MIN_USER_CHARS, 'chars');
assert(ok.durationSec >= VOICE_EVAL_MIN_DURATION_SEC, 'duration');

// --- Quantity can no longer stand in for evidence ---------------------------

assert(
    collapseRepeatedRuns('مستواي البرامج مستواي البرامج مستواي البرامج') === 'مستواي البرامج',
    'repeated runs must collapse to one'
);
assert(collapseRepeatedRuns('نعم نعم نعم') === 'نعم', 'single-token repeats must collapse');
assert(
    collapseRepeatedRuns('عندي خبرة سنتين بالتوظيف') === 'عندي خبره سنتين بالتوظيف',
    'non-repeating speech must survive collapsing'
);

// STT repetition inflated raw characters past the floor; substance did not.
const stuttered = [
    { role: 'assistant' as const, content: 'شنو مستواك بالبرامج المكتبية؟' },
    {
        role: 'user' as const,
        content: 'مستواي بالبرامج مستواي بالبرامج مستواي بالبرامج مستواي بالبرامج مستواي بالبرامج',
    },
    { role: 'assistant' as const, content: 'وشنو خبرتك بالتوظيف؟' },
    { role: 'user' as const, content: 'خبرتي بالتوظيف خبرتي بالتوظيف خبرتي بالتوظيف' },
    { role: 'assistant' as const, content: 'حدثني عن فريقك السابق.' },
    { role: 'user' as const, content: 'فريقي السابق فريقي السابق فريقي السابق فريقي السابق' },
];
const stt = assessVoiceInterviewEvidence(stuttered, 200);
assert(stt.userChars >= VOICE_EVAL_MIN_USER_CHARS, 'raw chars would have passed the old gate');
assert(!stt.ok, 'duplicated STT text must not buy a score');
assert(
    stt.reasons.some((r) => r.startsWith('substantive_user_chars=')),
    'must cite substantive chars'
);

// Wordy refusals are answers in shape only.
const refusals = [
    { role: 'assistant' as const, content: 'شنو خبرتك بالموارد البشرية؟' },
    { role: 'user' as const, content: 'والله ما أعرف' },
    { role: 'assistant' as const, content: 'شنو أهم مهارة عندك؟' },
    { role: 'user' as const, content: 'مو متأكد' },
    { role: 'assistant' as const, content: 'حدثني عن تعاملك مع ضغط العمل.' },
    { role: 'user' as const, content: 'ممكن توضحي لي السؤال أكثر؟' },
    { role: 'assistant' as const, content: 'وشنو خططك المستقبلية؟' },
    { role: 'user' as const, content: 'السؤال التالي' },
];
const refused = assessVoiceInterviewEvidence(refusals, 200);
assert(!refused.ok, 'a session of refusals must not score');
assert(refused.answeredQuestions === 0, `expected 0 answered, got ${refused.answeredQuestions}`);

// The agent carried the call on its own.
const monologue = [
    {
        role: 'assistant' as const,
        content:
            'أهلاً بك في المقابلة. راح أسألك عن خبرتك وعن مهاراتك وعن تعاملك مع الفريق، وكل سؤال خذ وقتك بالجواب عليه بالتفصيل الذي تريده.',
    },
    { role: 'user' as const, content: 'تمام' },
    {
        role: 'assistant' as const,
        content:
            'حدثني عن آخر مشروع شاركت فيه، وشنو كان دورك بالتحديد، وشنو التحديات التي واجهتها خلال العمل عليه مع فريقك.',
    },
    { role: 'user' as const, content: 'اوكي' },
    {
        role: 'assistant' as const,
        content:
            'وشنو المهارات التي تعتبرها الأقوى عندك، وكيف طورتها خلال سنوات عملك السابقة في هذا المجال؟',
    },
    { role: 'user' as const, content: 'نعم' },
];
const mono = assessVoiceInterviewEvidence(monologue, 200);
assert(!mono.ok, 'an agent monologue must not score');
assert(
    mono.reasons.some((r) => r.startsWith('candidate_share=')),
    'must cite candidate share'
);

// Short wall clock, but the candidate clearly answered — duration must not veto.
const shortButRich = [
    { role: 'assistant' as const, content: 'شنو خبرتك بالموارد البشرية؟' },
    {
        role: 'user' as const,
        content: 'عندي ثلاث سنوات بالتوظيف ومتابعة ملفات الموظفين وإعداد العقود والتقارير الشهرية.',
    },
    { role: 'assistant' as const, content: 'حدثني عن خلاف حليته.' },
    {
        role: 'user' as const,
        content: 'صار خلاف بين زميلين على المسؤوليات فجلسنا وقسمنا المهام بجدول واضح وانتهت المشكلة.',
    },
    { role: 'assistant' as const, content: 'شنو مستواك بالبرامج المكتبية؟' },
    {
        role: 'user' as const,
        content: 'قوي بالإكسل والورد وأبني تقارير محورية وأتابع جداول مشتركة للفريق كل يوم.',
    },
    { role: 'assistant' as const, content: 'وشنو خططك؟' },
    {
        role: 'user' as const,
        content: 'أطور نفسي بتحليل بيانات الموارد البشرية وآخذ شهادة مهنية بهذا المجال.',
    },
];
const short = assessVoiceInterviewEvidence(shortButRich, VOICE_EVAL_MIN_DURATION_SEC - 15);
assert(short.ok, `strong answers must survive a short clock: ${short.reasons.join(', ')}`);

console.log('voice-evidence-gate-test: OK');
