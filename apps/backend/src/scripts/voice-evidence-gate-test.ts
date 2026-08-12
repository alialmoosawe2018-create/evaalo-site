/**
 * Regression: Stage 2 evidence gate — thin sessions must not score.
 * Run: npx tsx src/scripts/voice-evidence-gate-test.ts
 */
import {
    assessVoiceInterviewEvidence,
    VOICE_EVAL_MIN_DURATION_SEC,
    VOICE_EVAL_MIN_USER_CHARS,
    VOICE_EVAL_MIN_USER_TURNS,
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
    hassan.reasons.some((r) => r.startsWith('user_turns=')),
    'must cite user turns'
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
assert(ok.userTurns >= VOICE_EVAL_MIN_USER_TURNS, 'turns');
assert(ok.userChars >= VOICE_EVAL_MIN_USER_CHARS, 'chars');
assert(ok.durationSec >= VOICE_EVAL_MIN_DURATION_SEC, 'duration');

console.log('voice-evidence-gate-test: OK');
