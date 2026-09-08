/**
 * Regression for three defects found in voice session da098dee (زهراء عقيل,
 * 2026-09-07), all confirmed against production data before being fixed.
 *
 * 1. THE GENDER SIGNAL WAS SIMPLY ABSENT. `candidates.gender` is empty for 5 of
 *    12 people in production - including both women - because the form field is
 *    optional. And when it is empty everything downstream silently does nothing:
 *    buildGenderAgreementSection returns 0 characters and applyIraqiGenderPhrasing
 *    is a no-op. So nothing enforced gender and the model guessed from the name,
 *    getting the opening turn wrong for both Zahraa and Fatima. The corrector was
 *    never at fault - it was never given a gender. It now falls back to the given
 *    name.
 *
 *    Note what this means about the earlier `\b` repair to the female branch: it
 *    revived dead code that was still unreachable for the very candidates it was
 *    written for. One dead layer behind another.
 *
 * 2. «ما اعرف» - the commonest Arabic non-answer - matched nothing. Only
 *    "i don't know" did. She said "Don't know" three times and was thanked for
 *    sharing each time.
 *
 * 3. Praise suppression was Arabic-only, so the English phase had none at all.
 *
 * Run: npm run test:voice-gender-nonanswer
 */
import {
    inferGenderFromGivenName,
    applyIraqiGenderPhrasing,
    buildGenderAgreementSection,
} from '../services/iraqiDialectReference.js';
import { isNegativeAnswer, polishVoiceArabicReply } from '../services/llmService.js';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
    if (actual === expected) {
        console.log(`ok   ${name}`);
    } else {
        failures += 1;
        console.error(`FAIL ${name}: expected ${String(expected)}, got ${String(actual)}`);
    }
}

// ── 1. gender inferred from the given name ───────────────────────────────────
//
// These are the twelve real names in production. Five had no gender field.
console.log('— the real names, as stored —');
check('Zahraa Aqeel Salim', inferGenderFromGivenName('Zahraa Aqeel Salim'), 'female');
check('Fatima Dakhil Hlail', inferGenderFromGivenName('Fatima Dakhil Hlail'), 'female');
check('Sajjad Mohammed Shaker', inferGenderFromGivenName('Sajjad Mohammed Shaker'), 'male');
check('Ali Mahmood', inferGenderFromGivenName('Ali Mahmood'), 'male');
check('عمار عماد', inferGenderFromGivenName('عمار عماد'), 'male');
check('سجاد محمد معز', inferGenderFromGivenName('سجاد محمد معز'), 'male');
check('علي محمود نجم', inferGenderFromGivenName('علي محمود نجم'), 'male');
check('HASAN OMAR AHMED BHLLAMH (upper)', inferGenderFromGivenName('HASAN OMAR AHMED BHLLAMH'), 'male');
check('حیدر حازم', inferGenderFromGivenName('حيدر حازم'), 'male');

console.log('\n— only the FIRST name is read —');
// «عقيل» is her father's name and is a male name; it must not be consulted.
check('عقيل is male on its own', inferGenderFromGivenName('عقيل سالم'), 'male');
check('but زهراء عقيل is female', inferGenderFromGivenName('زهراء عقيل'), 'female');

console.log('\n— spelling variants normalise —');
check('فاطمه (ta marbuta → ha)', inferGenderFromGivenName('فاطمه داخل'), 'female');
check('اية / آية', inferGenderFromGivenName('آية كريم'), 'female');
check('إسراء with hamza', inferGenderFromGivenName('اسراء علي'), 'female');

console.log('\n— and it refuses to guess —');
check('unknown name stays unknown', inferGenderFromGivenName('Xyzzy Qwerty'), 'unknown');
check('empty stays unknown', inferGenderFromGivenName(''), 'unknown');
check('undefined stays unknown', inferGenderFromGivenName(undefined), 'unknown');

console.log('\n— the consequence: the correction can now fire —');
const openingMasculine = 'شنو تحب تعرف عن نفسك قبل ما نبدأ بالمقابلة؟';
check(
    'unknown gender leaves it masculine (the old behaviour)',
    applyIraqiGenderPhrasing(openingMasculine, 'unknown'),
    openingMasculine
);
check(
    'female gender corrects it',
    applyIraqiGenderPhrasing(openingMasculine, 'female'),
    'شنو تحبين تعرفين عن نفسك قبل ما نبدأ بالمقابلة؟'
);
check(
    'and the prompt now carries an instruction',
    (buildGenderAgreementSection('female') ?? '').length > 0,
    true
);
check(
    'while unknown still carries none',
    (buildGenderAgreementSection('unknown') ?? '').length,
    0
);

// The phase-2 turn from her session, which stayed masculine on two verbs.
check(
    'the phase-2 role question is fully corrected',
    applyIraqiGenderPhrasing('شنو المهمة اليومية اللي تتوقع تسويها، وشلون راح تتعامل وياها؟', 'female'),
    'شنو المهمة اليومية اللي تتوقعين تسوينها، وشلون راح تتعاملين وياها؟'
);

// End to end: the name alone must be enough.
check(
    'polish() corrects from the NAME alone, no gender field',
    polishVoiceArabicReply(openingMasculine, { fullName: 'Zahraa Aqeel Salim' }),
    'شنو تحبين تعرفين عن نفسك قبل ما نبدأ بالمقابلة؟'
);
check(
    'a stored gender still wins over the name',
    polishVoiceArabicReply(openingMasculine, { gender: 'male', fullName: 'Zahraa Aqeel Salim' }),
    openingMasculine
);

// ── 2. non-answers ───────────────────────────────────────────────────────────
console.log('\n— the forms she actually used —');
check('«ما اعرف»', isNegativeAnswer('ما اعرف'), true);
check('"Don\'t know."', isNegativeAnswer("Don't know."), true);
check('"Don\'t. No. Don\'t know"', isNegativeAnswer("Don't. No. Don't know"), true);
check('«انا فهمت المعنى. لكن ما اعرف شنو»', isNegativeAnswer('انا فهمت المعنى. لكن ما اعرف شنو'), true);
check('«ما ادري»', isNegativeAnswer('ما ادري'), true);
check('"no idea"', isNegativeAnswer('no idea'), true);
check('"I don\'t know" (already worked)', isNegativeAnswer("I don't know"), true);

console.log('\n— but a real answer that merely contains the words is NOT a non-answer —');
check(
    'a long answer containing «ما اعرف» is an answer',
    isNegativeAnswer(
        'بالبداية كنت ما اعرف البرنامج ابدا، فقعدت اتعلمه من الفيديوهات والمانوال حتى صار عندي خبرة كافية بيه واشتغلت عليه بمشروع كامل'
    ),
    false
);
check(
    'and the older negative forms still fire regardless of length',
    isNegativeAnswer('انا لم اعمل في مجال ال hr سابقا وما عندي اي سنوات خبرة اطلاقا بهذا المجال المحدد'),
    true
);

// ── 3. the English phase ─────────────────────────────────────────────────────
console.log('\n— praise on an English non-answer —');
const enPraise = 'Good, thank you for sharing that. Can you explain the methods you use?';
check(
    'the false "thank you for sharing" is removed',
    polishVoiceArabicReply(enPraise, { clarificationRequested: true }),
    'Okay. Can you explain the methods you use?'
);
check(
    'a bare English praise opener is neutralised',
    polishVoiceArabicReply('Good, now can you share an experience?', { clarificationRequested: true }),
    'Okay. Now can you share an experience?'
);
check(
    'an answered English turn keeps its opener',
    polishVoiceArabicReply('Great, can you describe a recent success?').startsWith('Great,'),
    true
);

// ── 4. opener variety ────────────────────────────────────────────────────────
console.log('\n— «ممتاز» opened 6 of 17 turns; openers now rotate —');
const seen = new Set<string>();
for (let turn = 1; turn <= 6; turn += 1) {
    const out = polishVoiceArabicReply('ممتاز، شنو التحديات اللي واجهتيها؟', {
        gender: 'female',
        acknowledgmentTurn: turn,
    });
    seen.add(out.split('،')[0] ?? '');
}
check('six consecutive turns do not all open the same way', seen.size > 1, true);
check('the first turn is left alone', polishVoiceArabicReply('ممتاز، شنو رأيك؟', { acknowledgmentTurn: 0 }).startsWith('ممتاز'), true);

if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
}
console.log('\nvoice-gender-and-nonanswer-test: OK');
