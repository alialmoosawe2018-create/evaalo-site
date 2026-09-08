/**
 * The phone key, tested against every phone format actually in the production
 * database on 2026-09-08 — not against invented ones.
 *
 * Why it exists: the public-application duplicate guard matched on EMAIL only, so
 * re-applying to the same campaign with a different email produced a new person,
 * a new application, and therefore a fresh interview link. The owner found this
 * by doing it. Phone is the stronger identifier here and was collected but never
 * used.
 *
 * Run: npm run test:phone-identity
 */
import { normalizePhoneKey, isSamePhone } from '../services/phoneIdentity.js';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
    if (actual === expected) {
        console.log(`ok   ${name}`);
    } else {
        failures += 1;
        console.error(`FAIL ${name}: expected ${String(expected)}, got ${String(actual)}`);
    }
}

// ── the 18 real values, verbatim ─────────────────────────────────────────────
console.log('— every phone format present in production —');
const REAL: Array<[string, string]> = [
    ['+9647828119667', 'IQ:7828119667'],
    ['07715636018', 'IQ:7715636018'],
    ['+964782819667', 'IQ:782819667'],
    ['(783) 309-9675', 'IQ:7833099675'], // US-style punctuation, bare 10-digit mobile
    ['07811315889', 'IQ:7811315889'],
    ['+9647727625061', 'IQ:7727625061'],
    ['07731002610', 'IQ:7731002610'],
    ['077315464645', 'IQ:77315464645'], // one digit too many — still deterministic
    ['+967 778971562', 'INTL:967778971562'], // Yemen — must NOT become Iraqi
    ['07735358401', 'IQ:7735358401'],
    ['+96407734045591', 'IQ:7734045591'], // country code AND a redundant leading 0
    ['+9647744892979', 'IQ:7744892979'],
    ['+9647841030235', 'IQ:7841030235'],
    ['+9647800983355', 'IQ:7800983355'],
    ['07846113078', 'IQ:7846113078'],
    ['07815172006', 'IQ:7815172006'],
    ['07800286226', 'IQ:7800286226'],
    ['+964 780 386 7299', 'IQ:7803867299'], // spaces
];
for (const [raw, expected] of REAL) {
    check(`${raw.padEnd(20)} → ${expected}`, normalizePhoneKey(raw), expected);
}

// ── the same subscriber written every way we have seen ───────────────────────
console.log('\n— one number, many spellings, one key —');
const SPELLINGS = ['07800286226', '+9647800286226', '964 780 028 6226', '00964 780 028 6226', '+964-780-028-6226', '7800286226'];
for (const s of SPELLINGS) {
    check(`${s.padEnd(22)} matches the stored form`, isSamePhone(s, '07800286226'), true);
}

// ── and what must NOT collide ────────────────────────────────────────────────
console.log('\n— distinct people must stay distinct —');
// From the real data: these two differ by one digit and belong to two people.
check(
    '+9647828119667 vs +964782819667 (one digit apart)',
    isSamePhone('+9647828119667', '+964782819667'),
    false
);
// ⚠️ The Yemeni number must not collide with an Iraqi local form.
check(
    'Yemen +967 778971562 vs Iraqi 0778971562',
    isSamePhone('+967 778971562', '0778971562'),
    false
);
check('empty never matches empty', isSamePhone('', ''), false);
check('null never matches null', isSamePhone(null, null), false);
check('empty never matches a real number', isSamePhone('', '07800286226'), false);
check('garbage yields no key', normalizePhoneKey('n/a'), '');
check('a lone plus yields no key', normalizePhoneKey('+'), '');
check('zeros only yield no key', normalizePhoneKey('000'), '');

// ── the owner's own two records — the honest limit of this fix ───────────────
//
// He re-applied with a different email AND a different phone, so phone matching
// would NOT have caught his test. It closes the door on someone who reuses their
// number, which is the common case, not on someone changing both deliberately.
console.log('\n— the limit, stated explicitly —');
check(
    "the owner's two records are genuinely different numbers",
    isSamePhone('+964782819667', '07715636018'),
    false
);

if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
}
console.log('\nphone-identity-test: OK');
