/**
 * Regression for the five defects found in sessions 1768–1770 (2026-09-08).
 *
 * Each is pinned to what a real candidate actually said or was actually called.
 *
 *   1768  4aa600d4  أنور صالح    — addressed by name in 7 of 7 turns
 *   1769  96608883  نور الهدى    — a woman addressed in the masculine for 43 messages
 *   1770  d05890bc  علي رياض     — asked for clarification twice, ignored twice
 *         b307fb8f              — an unknown STT error classified as a configuration fault,
 *                                 and a Speechmatics connection opened after SESSION END
 *
 * Run: npm run test:voice-sessions-1768-1770
 */
import { detectIntent, isClarificationRequest } from '../evaalo-only-voice/questionEngine.js';
import { inferGenderFromGivenName, applyIraqiGenderPhrasing } from '../services/iraqiDialectReference.js';
import { isTransientSttError, isConfigurationSttError } from '../services/sttRouterService.js';
import { stripRepeatedNameAddress, polishVoiceArabicReply } from '../services/llmService.js';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
    if (actual === expected) {
        console.log(`ok   ${name}`);
    } else {
        failures += 1;
        console.error(`FAIL ${name}: expected ${String(expected)}, got ${String(actual)}`);
    }
}

// ── A. clarification, in the words he actually used ──────────────────────────
console.log('— علي رياض asked twice and was ignored twice —');
check('«تقصدين؟ بالادوات»', detectIntent('تقصدين؟ بالادوات'), 'clarification');
check('«مثال محدد مثل. مثال على شنو؟ ماذا افعل»', isClarificationRequest('مثال محدد مثل. مثال على شنو؟ ماذا افعل'), true);
check('«اعيدي السؤال»', isClarificationRequest('اعيدي السؤال'), true);
check('«شنو المطلوب مني»', isClarificationRequest('شنو المطلوب مني'), true);
check('«مو فاهم عليك»', isClarificationRequest('مو فاهم عليك'), true);

console.log('\n— what already worked must keep working —');
for (const s of ['شنو تقصد؟', 'ما فهمت السؤال', 'ممكن توضحين السؤال', 'can you explain']) {
    check(`still clarification: "${s}"`, isClarificationRequest(s), true);
}

console.log('\n— and a real answer must NOT be read as a clarification —');
for (const s of [
    'اشتغلت بشركة الناجي جروب اربع سنوات وكانت تجربة جيدة',
    'استخدمت برامج المحاكاة مثل سي إم جي',
    'نعم عندي خبرة بالسلامة المهنية',
]) {
    check(`not a clarification: "${s.slice(0, 34)}…"`, isClarificationRequest(s), false);
}

// ── B. the compound name that cost نور الهدى her whole interview ─────────────
console.log('\n— compound names —');
check('«نور الهدى» → female', inferGenderFromGivenName('نور الهدى'), 'female');
check('"Noor Alhuda" (as stored) → female', inferGenderFromGivenName('Noor Alhuda'), 'female');
check('«نور الهدى محمد» → female', inferGenderFromGivenName('نور الهدى محمد'), 'female');
// ⚠️ The very ambiguity that made me exclude «نور» is why the compound must win.
check('«نور الدين» → male', inferGenderFromGivenName('نور الدين'), 'male');
check('«عبد الله» → male', inferGenderFromGivenName('عبد الله'), 'male');
check('«عبدالله» written as one token → male', inferGenderFromGivenName('عبدالله'), 'male');
check('bare «نور» stays unknown', inferGenderFromGivenName('نور'), 'unknown');
// the first-token rule must still hold: the father's name is never consulted
check('«زهراء عقيل سالم» → female (not «عقيل»)', inferGenderFromGivenName('زهراء عقيل سالم'), 'female');
check('single names still work', inferGenderFromGivenName('فاطمة داخل'), 'female');

console.log('\n— and the consequence: her turn is now addressed correctly —');
check(
    'the actual line she heard, corrected',
    applyIraqiGenderPhrasing('شنو الأدوات الرقمية اللي تستخدمها في شغلك؟', inferGenderFromGivenName('Noor Alhuda')),
    'شنو الأدوات الرقمية اللي تستخدمينها في شغلك؟'
);

// ── C. the name repeated every turn ─────────────────────────────────────────
console.log('\n— أنور was named in 7 of 7 turns —');
check(
    'the name after the opener is dropped',
    stripRepeatedNameAddress('عاشت ايدك، أنور. شنو الأدوات الرقمية اللي استخدمتها؟', 'أنور صالح'),
    'عاشت ايدك، شنو الأدوات الرقمية اللي استخدمتها؟'
);
check(
    'another opener, same rule',
    stripRepeatedNameAddress('تمام، أنور. شلون تعاملت مع قلة البيانات؟', 'أنور صالح'),
    'تمام، شلون تعاملت مع قلة البيانات؟'
);
// The name inside the question itself is left alone — it may be deliberate.
check(
    'a name inside the sentence is untouched',
    stripRepeatedNameAddress('طيب، شنو رأيك يا أنور بهالموضوع؟', 'أنور صالح'),
    'طيب، شنو رأيك يا أنور بهالموضوع؟'
);
check(
    'no name stored → unchanged',
    stripRepeatedNameAddress('عاشت ايدك، أنور. شنو الأدوات؟', undefined),
    'عاشت ايدك، أنور. شنو الأدوات؟'
);
check(
    'it runs inside the exit polish',
    polishVoiceArabicReply('عاشت ايدك، أنور. شنو الأدوات الرقمية؟', { fullName: 'أنور صالح', gender: 'male' }),
    'عاشت ايدك، شنو الأدوات الرقمية؟'
);

// ── D. the classification default, inverted ─────────────────────────────────
//
// The costs are asymmetric: treating a permanent fault as transient costs six
// seconds of retry and one failover attempt, both safe. Treating a transient
// fault as permanent ends a person's interview.
console.log('\n— unknown errors are recoverable, not configuration —');
check('the bare "Error" from b307fb8f', isTransientSttError(new Error('Error')), true);
check('an error with no message at all', isTransientSttError(new Error()), true);
check('something unrecognised', isTransientSttError(new Error('something odd happened')), true);
check('the DNS outage (unchanged)', isTransientSttError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })), true);

console.log('\n— but a KNOWN configuration fault still hard-fails —');
for (const [label, msg] of [
    ['missing key', 'Speechmatics API key is not configured'],
    ['invalid key', 'Unauthorized: invalid API key'],
    ['401', 'Request failed with status 401'],
    ['403', '403 Forbidden'],
] as const) {
    check(`not transient: ${label}`, isTransientSttError(new Error(msg)), false);
    check(`  and is configuration: ${label}`, isConfigurationSttError(new Error(msg)), true);
}
check('null is still not an error', isTransientSttError(null), false);
check('undefined is still not an error', isTransientSttError(undefined), false);

if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
}
console.log('\nvoice-sessions-1768-1770-test: OK');
