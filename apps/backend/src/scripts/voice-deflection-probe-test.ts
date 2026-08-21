/**
 * Regression for deflection probing.
 *
 * In prod session b4e9e4b7 the candidate said "ما واجهت تحديات" twice and the
 * agent just switched topics instead of asking for a concrete example. Now an
 * explicit denial of a challenge — in reply to a challenge/example question —
 * earns one gentle probe, capped per interview and never firing in Phase 3.
 *
 * This covers the two pure pieces: the `isEvasiveNonAnswer` detector and the
 * `deflectionProbesUsed` bookkeeping (which enforces the cap).
 *
 * Run: npx tsx src/scripts/voice-deflection-probe-test.ts
 */
import { isEvasiveNonAnswer } from '../evaalo-only-voice/questionEngine.js';
import {
    createInterviewState,
    getInterviewState,
    onExchangeComplete,
    removeInterviewState,
} from '../evaalo-only-voice/interviewState.js';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
    if (actual === expected) {
        console.log(`ok   ${name}`);
    } else {
        failures += 1;
        console.error(`FAIL ${name}: expected ${String(expected)}, got ${String(actual)}`);
    }
}

// --- detector: evasive / denial of challenge -> true -------------------------
check('short denial "ما واجهت تحديات"', isEvasiveNonAnswer('ما واجهت تحديات'), true);
check(
    'denial embedded in a long generic answer',
    isEvasiveNonAnswer(
        'ما واجهت تحديات. لان انت مهما تكون التاسك او المهمة صعبة انت تقدر تتعامل وياها بهاي الطريقة'
    ),
    true
);
check('ماكو مشاكل', isEvasiveNonAnswer('ماكو مشاكل بصراحة'), true);
check('لا يوجد صعوبات', isEvasiveNonAnswer('لا يوجد صعوبات تذكر'), true);
check('short dismissal "عادي"', isEvasiveNonAnswer('عادي'), true);
check('English "no challenges at all"', isEvasiveNonAnswer('No challenges at all'), true);
check('English "nothing much"', isEvasiveNonAnswer('Nothing much'), true);
check("English \"didn't have any problems\"", isEvasiveNonAnswer("I didn't have any problems"), true);

// --- detector: real answers -> false (no false probing) ----------------------
check('affirmative "واجهت تحديات كثيرة"', isEvasiveNonAnswer('واجهت تحديات كثيرة وتعلمت منها الكثير'), false);
check('valid short answer "AI"', isEvasiveNonAnswer('AI'), false);
check(
    'substantive normal answer',
    isEvasiveNonAnswer('حقيقة عندي الكثير من المهارات اللي اكتسبتها خلال عملي بالقطاع الخاص'),
    false
);
check('empty', isEvasiveNonAnswer('   '), false);
check('English positive', isEvasiveNonAnswer('I faced many challenges and solved them'), false);

// --- bookkeeping: the probe counter enforces the cap -------------------------
const SID = 'deflection';
createInterviewState(SID);
check('starts at zero', getInterviewState(SID)?.deflectionProbesUsed, 0);

const MAX = Number(process.env.VOICE_DEFLECTION_PROBE_MAX) || 1;
// Simulate a probe turn.
onExchangeComplete(SID, 'probe', 3, { deflectionProbeUsed: true });
check('increments after a probe', getInterviewState(SID)?.deflectionProbesUsed, 1);
check(
    'cap reached blocks further probes',
    (getInterviewState(SID)?.deflectionProbesUsed ?? 0) < MAX,
    false
);
// A normal turn does not touch the counter.
onExchangeComplete(SID, 'answer', 4, {});
check('normal turn leaves counter unchanged', getInterviewState(SID)?.deflectionProbesUsed, 1);
removeInterviewState(SID);

if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
}
console.log('\nvoice-deflection-probe-test: OK');
