/**
 * The emailed compare report must put a face on each card.
 *
 * The report is rendered by headless Chromium from an HTML string with no
 * session, so a `/uploads/...` src silently renders as nothing — the photo has
 * to be inlined as a data URI. And a candidate with no photo must still get a
 * card of the same shape, or the column of avatars goes ragged down the page.
 *
 * Run: npx tsx src/scripts/compare-report-photo-test.ts [--pdf <outfile>]
 */
import assert from 'node:assert';
import { writeFileSync } from 'node:fs';
import { buildCompareReportHtml, renderCompareReportPdf } from '../services/compareReportPdf.js';
import type { IAiCompareTopResult } from '../models/RecruitmentCampaign.js';

let pass = 0;
let fail = 0;
function test(name: string, fn: () => void): void {
    try {
        fn();
        console.log('  ✓', name);
        pass += 1;
    } catch (err) {
        console.error('  ✗', name, '\n     ', (err as Error).message);
        fail += 1;
    }
}

/** A real 1x1 PNG — enough to prove an <img> is emitted and rendered. */
const PNG_1PX =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const RESULT: IAiCompareTopResult = {
    requestId: 'req-sample-0001',
    emails: ['hiring@example.com'],
    status: 'completed',
    decisionSummary: 'نور سالم عبدالرحمن يتصدّر بدرجة 80 لملاءمته العملية ولغة العمل.',
    contextualIntroduction: 'مقارنة مرشّحَين اجتازا المرحلة الأولى لوظيفة أخصائي موارد بشرية أول.',
    summary: 'كلاهما يُظهر خلفية تعليمية مناسبة لقطاع النفط والغاز وخبرة عملية في شؤون الموارد.',
    comparativeInsights: { 'الموقع والتوثيق': 'نور أقرب لمتطلبات بغداد.' },
    whyTopCandidateWins: 'درجة إجمالية أعلى وتوافق أوثق مع وصف الدور.',
    finalRecommendation: 'ادعُ نور للمقابلة بشرط تحقّق صارم من المستندات.',
    ranking: [
        {
            rank: 1,
            candidateId: 'p1',
            candidateName: 'Noor Salim Abdulrahman',
            score: 80,
            recommendation: 'Consider',
            confidence: 72,
            executiveComment: 'مرشّح ذو أفضلية مهنية واضحة لكنه يحمل مخاطر نزاهة وتقصير في المستندات.',
            reasons: ['درجة إجمالية أعلى وتوافق مع وصف الدور.'],
            strengthsList: ['خبرة سنتين أو أكثر في عمليات الموارد البشرية.'],
            risks: ['تناقضات بين الطلب المنظم والسيرة الذاتية.'],
        },
        {
            rank: 2,
            candidateId: 'p2-no-photo',
            candidateName: 'علي محمود نجم',
            score: 68,
            recommendation: 'Consider',
            confidence: 60,
            executiveComment: 'مرشّح عملي ذو خبرة، لكنه يعاني من تعارض موقع جغرافي ونقص في بيانات الطلب.',
            risks: ['الموقع الحالي لا يتطابق مع مطلب بغداد.'],
        },
    ],
} as IAiCompareTopResult;

const withPhoto = buildCompareReportHtml(RESULT, { stage: 'screening', photos: { p1: PNG_1PX } });
const withNone = buildCompareReportHtml(RESULT, { stage: 'screening' });

test('the photo is inlined as a data URI, not linked to /uploads', () => {
    assert.ok(withPhoto.includes(`src="${PNG_1PX}"`), 'the data URI must appear in the img src');
    assert.ok(!/src="[^"]*\/uploads\//.test(withPhoto), 'no /uploads URL may reach the renderer');
});

/** Count rendered avatars only — `.avatar--initials` also appears in the stylesheet. */
const initialsAvatars = (html: string) =>
    (html.match(/<span class="avatar avatar--initials">/g) || []).length;

test('a candidate with no photo still gets an avatar — their initials', () => {
    assert.strictEqual(initialsAvatars(withPhoto), 1, 'only the photo-less card falls back');
    // Arabic initials come from the same rule: first letter of the first and last name.
    assert.ok(withPhoto.includes('>عن<'), 'علي … نجم → عن');
});

test('with no photos at all, every card falls back cleanly', () => {
    assert.ok(!withNone.includes('<img class="avatar"'), 'no img when nothing was loaded');
    assert.strictEqual(initialsAvatars(withNone), 2);
    assert.ok(withNone.includes('>NA<'), 'Noor … Abdulrahman → NA');
});

test('the candidate name is still escaped in the alt attribute', () => {
    const evil = buildCompareReportHtml(
        { ...RESULT, ranking: [{ rank: 1, candidateId: 'p1', candidateName: '<img onerror=x>' }] } as IAiCompareTopResult,
        { stage: 'screening', photos: { p1: PNG_1PX } }
    );
    assert.ok(!evil.includes('<img onerror=x>'), 'candidate text must never render as markup');
    assert.ok(evil.includes('&lt;img onerror=x&gt;'));
});

test('every avatar sits inside the card head, before the name', () => {
    const head = withPhoto.slice(withPhoto.indexOf('card-head'), withPhoto.indexOf('cand-name'));
    assert.ok(head.includes('avatar'), 'the avatar belongs between the rank badge and the name');
});

console.log(`\n[compare-report-photo] ${pass} passed, ${fail} failed`);

const pdfFlag = process.argv.indexOf('--pdf');
if (pdfFlag !== -1 && process.argv[pdfFlag + 1]) {
    const out = process.argv[pdfFlag + 1];
    renderCompareReportPdf(RESULT, { stage: 'screening', photos: { p1: PNG_1PX } })
        .then((buf) => {
            writeFileSync(out, buf);
            console.log(`sample PDF written: ${out} (${buf.byteLength} bytes)`);
            process.exit(fail === 0 ? 0 : 1);
        })
        .catch((err) => {
            console.error('PDF render failed:', err instanceof Error ? err.message : err);
            process.exit(1);
        });
} else {
    process.exit(fail === 0 ? 0 : 1);
}
