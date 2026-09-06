/**
 * تدقيق: هل تعمل حرّاس السياسة والتصحيحات العربية فعلاً؟
 *
 * الدافع: `\b` في جافاسكربت تُعرَّف عبر `\w` = `[A-Za-z0-9_]`، والحرف العربي ليس
 * منها. فأي `\b` ملاصقة لذرّة عربية لا تُطابق إلا إذا جاور العربيةَ حرفٌ لاتيني أو
 * رقم — وهو ما لا يحدث في نصّ عربي. ظهر ذلك أولاً في تصحيح «ويها» الذي لم يعمل
 * يوماً، ومسحٌ للمستودع وجد ٢٠ موضعاً آخر.
 *
 * هذا الملفّ يستدعي الدوالّ المصدَّرة نفسها بمدخلات واقعية، فيقيس الأثر الحقيقي
 * لا سلامة التعبير معزولاً: بعض الحرّاس بدائل متعدّدة، فقد يُنقذها بديل سليم.
 *
 * Run: npx tsx src/scripts/arabic-word-boundary-audit.ts
 */
import { isAskingAgentIdentity, classifyInterviewPolicyIntent } from '../evaalo-only-voice/questionEngine.js';
import { isSupportScopeRole } from '../shared/jobCatalog/careerLevelOverlays.js';
import { applyIraqiGenderPhrasing } from '../services/iraqiDialectReference.js';

let pass = 0;
let fail = 0;

function check(label: string, got: unknown, expected: unknown) {
    const okNow = JSON.stringify(got) === JSON.stringify(expected);
    if (okNow) pass += 1;
    else fail += 1;
    console.log(`  ${okNow ? '✓' : '✗'} ${label.padEnd(46)} متوقع=${JSON.stringify(expected)} فعلي=${JSON.stringify(got)}`);
}

console.log('١) هوية الوكيل — «من أنت؟»');
for (const t of ['مين أنت؟', 'انت مين', 'من أنت', 'منو انته؟', 'شنو أنت؟']) {
    check(t, isAskingAgentIdentity(t), true);
}
check('who are you? (إنجليزي — مرجع سليم)', isAskingAgentIdentity('who are you?'), true);

console.log('\n٢) طلب تقييم/نتيجة — سياسة الموارد البشرية');
for (const t of ['شلون تقيمني؟', 'شنو رأيك بيّا؟', 'قيمني', 'شنو رأيك بأدائي؟']) {
    const got = classifyInterviewPolicyIntent(t);
    check(t, got !== null, true);
}
for (const t of ['متى تطلع النتيجة؟', 'شصارت النتيجة؟']) {
    const got = classifyInterviewPolicyIntent(t);
    check(t, got !== null, true);
}

console.log('\n٣) أدوار الإسناد — تحديد مستوى المقابلة');
check('كاتب حسابات', isSupportScopeRole('كاتب حسابات'), true);
check('مساعد إداري (بديل سليم)', isSupportScopeRole('مساعد إداري'), true);
check('clerk (لاتيني — مرجع سليم)', isSupportScopeRole('accounts clerk'), true);
check('مهندس نفط (يجب false)', isSupportScopeRole('مهندس نفط'), false);
// الحدّ من الجانبين مقصود: بلا حدٍّ يسار تُطابق «كاتب» داخل «مكاتب».
check('مدير مكاتب (يجب false)', isSupportScopeRole('مدير مكاتب'), false);

console.log('\n٤) المطابقة الجنسية — مخاطبة المرشّحة');
check('أنثى: تگدر → تگدرين', /تگدرين/.test(applyIraqiGenderPhrasing('تگدر تحچيلي عن نفسك؟', 'female')), true);
check('أنثى: تقدر → تگدرين', /تگدرين/.test(applyIraqiGenderPhrasing('تقدر تنطيني مثال؟', 'female')), true);
check('ذكر: يبقى تگدر', applyIraqiGenderPhrasing('تقدر تنطيني مثال؟', 'male').includes('تگدر'), true);
check('ذكر: لا تتحوّل لمؤنّث', /تگدرين/.test(applyIraqiGenderPhrasing('تقدر تنطيني مثال؟', 'male')), false);

console.log(`\n${fail === 0 ? '✅' : '⚠️'}  نجح ${pass} · فشل ${fail}`);
if (fail > 0) {
    console.log('\nالفشل أعلاه = حارس لا يعمل في الإنتاج، لا خطأ في الاختبار.');
    process.exitCode = 1;
}
