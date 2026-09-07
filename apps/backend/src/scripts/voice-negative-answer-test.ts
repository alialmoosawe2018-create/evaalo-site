import { isNegativeAnswer } from '../services/llmService.js';

/**
 * Regression for the praise-and-probe defect in voice session 6afff73c.
 *
 * Three times the candidate said a thing did not exist in her work, and three
 * times the agent opened its next turn with «ممتاز». Twice it also followed up,
 * digging into the topic she had just closed — teamwork ended up asked three
 * times, communication twice.
 *
 * The strings below are hers, verbatim from the transcript. The negatives must
 * be caught; the real answers must not, because suppressing praise and follow-up
 * on a genuine answer would cost more than the defect did.
 *
 * Run: npm run test:voice-negative-answer
 */

let failures = 0;

function check(text: string, expected: boolean, note: string): void {
    const got = isNegativeAnswer(text);
    const ok = got === expected;
    if (!ok) failures += 1;
    console.log(`${ok ? '✅' : '❌'} ${expected ? 'negative' : 'answer  '}  ${note}`);
    if (!ok) console.log(`     got ${got} for: ${text.slice(0, 80)}`);
}

console.log('— her actual negatives (session 6afff73c) —');
check('ما يطلب أي عمل جماعي', true, 'no teamwork required');
check('عادة أنا لا أستخدم أي أدوات رقمية في', true, 'uses no digital tools');
check('لا يوجد لدينا مهارات رقمي بالتواصل عملي لا يتطلب اي تواصل لا رقمي ولا', true, 'no comms skills');
check('انا لم اعمل في مجال ال hr. Specialist سابقا وما عندي اي سنوات خبرة', true, 'no HR experience');

console.log('\n— her actual answers, which must still earn praise and follow-up —');
check(
    'من التحديات التقنية التي واجهتها هو عطل في البرنامج يعرض لي الداتا اللي توصل لي من البئر اثناء الحفر',
    false,
    'the firmware fault story',
);
check(
    'الاستماع للاخرين. معرفة وجهات نظرهم بالكامل وعدم التسرع بالحكم عليها. الصبر وروح العمل الجماعي',
    false,
    'listening and patience',
);
check(
    'الطرق التقليدية من ناحية البحث على مواقع العالمية ، وأيضا الاستماع للفيديوهات والمحاضرات',
    false,
    'how she learns',
);
check('اللغة العربية هي اللغة الأم، واللغة الثانية هي اللغة الإنجليزية', false, 'her languages');

console.log('\n— other phrasings —');
check('ماكو شي من هذا القبيل', true, 'Iraqi ماكو');
check('ولا شي', true, 'ولا شي');
check('I have no experience in this field', true, 'English: no experience');
check("I don't use any of those tools", true, "English: I don't");
check('نعم عندي خبرة واسعة في هذا المجال', false, 'affirmative with عندي');
check('', false, 'empty string is not a negative answer');

console.log('\n— the boundary trap —');
// «لا» inside a longer word must not trigger: JS \b is dead next to Arabic, so
// the patterns use \p{L} lookarounds. A false positive here silences praise on
// a normal answer.
check('استعملت البلاستيك في التغليف', false, 'لا inside بلاستيك');
check('عملت على تحسين الاداء', false, 'ما not present as a word');

console.log(`\n${failures === 0 ? '✅ all passed' : `❌ ${failures} failed`}`);
process.exit(failures === 0 ? 0 : 1);
