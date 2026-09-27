/**
 * ONE rule for which CV files an applicant may upload — in both forms and the backend.
 * Run: npm run test:cv-file-types   (offline, no network, no database)
 *
 * S45 (2026-09-27): the legacy form (pages/Form.jsx — the link most applicants
 * get) accepted PDF only while the hint above the field, shared with the public
 * form, said "PDF, DOCX or TXT". A Word CV was refused in the browser, where
 * nothing reached the server to show it happening. The cause was two lists that
 * drifted apart on 2026-09-15; now there is one rule on each side, and this test
 * fails if the two sides disagree on a single case.
 *
 * The frontend rule is loaded from the REAL source (see stage1-parity-test.ts for
 * why the specifier is computed) — frontend test scripts do not run in CI; this one does.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    CV_ACCEPTED_MIME_TYPES,
    CV_FILE_TYPES,
    classifyCvUpload,
    storedCvMimeType,
} from '../shared/formTemplates/types.js';
import { createFormBindingForTemplate } from '../services/formTemplateService.js';
import { DEFAULT_FORM_TEMPLATE_ID, validateApplicationSubmission } from '../shared/formTemplates/index.js';

const FRONTEND_SRC = new URL('../../../frontend/src/', import.meta.url).href;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const front: any = await import(`${FRONTEND_SRC}utils/cvFileTypes.js`);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dynamicValidation: any = await import(`${FRONTEND_SRC}components/form/dynamicFormClientValidation.js`);
const readFrontend = (rel: string) => fs.readFileSync(fileURLToPath(`${FRONTEND_SRC}${rel}`), 'utf8');

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

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// [type the browser reports, file name, what the platform must decide]
const CASES: Array<[string, string, 'pdf' | 'docx' | 'txt' | null]> = [
    ['application/pdf', 'cv.pdf', 'pdf'],
    [DOCX, 'cv.docx', 'docx'],
    ['text/plain', 'cv.txt', 'txt'],
    ['', 'cv.pdf', 'pdf'], // a real PDF the device reported with no type — refused before
    ['', 'CV.PDF', 'pdf'],
    ['application/octet-stream', 'cv.docx', 'docx'], // how phones often send Word — refused before
    ['binary/octet-stream', 'cv.txt', 'txt'],
    ['application/x-pdf', 'cv.pdf', 'pdf'], // vendor alias, accepted before and still
    ['text/plain;charset=utf-8', 'cv.txt', 'txt'],
    // text/plain is also a multipart parser's default for an untyped part: it does
    // not overrule a file that names itself as another CV format…
    ['text/plain', 'cv.pdf', 'pdf'],
    ['text/plain', 'cv.docx', 'docx'],
    // …but it still covers other text files, as before.
    ['text/plain', 'cv.md', 'txt'],
    ['text/plain', 'cv', 'txt'],
    ['application/msword', 'cv.doc', null], // Word 97-2003: the extractor cannot read it
    ['application/octet-stream', 'cv.doc', null],
    ['image/png', 'cv.png', null],
    ['image/png', 'cv.pdf', null], // a named type wins over the extension
    ['', 'cv.exe', null], // an empty type used to skip the check entirely
    ['application/octet-stream', 'cv', null],
    ['', '.pdf', null],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.template', 'cv.dotx', null],
];

test('frontend and backend list the same CV types', () => {
    const f = front.CV_FILE_TYPES.map((t: { extension: string; mimeType: string; mimeKeyword: string }) => [t.extension, t.mimeType, t.mimeKeyword]);
    const b = CV_FILE_TYPES.map((t) => [t.extension, t.mimeType, t.mimeKeyword]);
    assert.deepEqual(f, b);
    assert.deepEqual(CV_ACCEPTED_MIME_TYPES, CV_FILE_TYPES.map((t) => t.mimeType));
});

for (const [mime, name, expected] of CASES) {
    test(`"${mime || '(no type)'}" + ${name} → ${expected ?? 'refused'} — on BOTH sides`, () => {
        assert.equal(classifyCvUpload(mime, name), expected, 'backend');
        assert.equal(front.classifyCvFile(mime, name), expected, 'frontend');
        assert.equal(front.isAcceptedCvFile({ type: mime, name }), expected !== null, 'frontend File check');
    });
}

test('the file picker lists every readable type, by extension AND by type', () => {
    for (const t of CV_FILE_TYPES) {
        assert.ok(front.CV_ACCEPT_ATTRIBUTE.split(',').includes(`.${t.extension}`), t.extension);
        assert.ok(front.CV_ACCEPT_ATTRIBUTE.split(',').includes(t.mimeType), t.mimeType);
    }
    assert.equal(front.CV_MAX_BYTES, 5 * 1024 * 1024);
});

test('an accepted CV is STORED under one canonical type per format', () => {
    assert.equal(storedCvMimeType('application/octet-stream', 'cv.docx'), DOCX);
    assert.equal(storedCvMimeType('', 'cv.pdf'), 'application/pdf');
    assert.equal(storedCvMimeType('application/pdf', 'cv.pdf'), 'application/pdf');
    // An alias would otherwise leave the extractor unable to tell the format
    // without an extension.
    assert.equal(storedCvMimeType('application/x-pdf', 'resume'), 'application/pdf');
    assert.equal(storedCvMimeType('text/plain;charset=utf-8', 'cv.txt'), 'text/plain');
    assert.equal(storedCvMimeType('text/plain', 'cv.pdf'), 'application/pdf');
    assert.equal(storedCvMimeType('image/png', 'cv.png'), 'image/png', 'a file that is not a CV is kept as received');
});

// ── What the applicant is told (the same helper on both forms), in EN/AR/KU ───
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { translations }: any = await import(`${FRONTEND_SRC}translations.js`);
for (const lang of ['en', 'ar', 'ku']) {
    const dict = translations[lang];
    const t = (key: string) => dict[key] ?? `MISSING:${key}`;
    test(`${lang}: the refusal names the accepted types; the note appears only with an earlier file`, () => {
        assert.equal(front.cvRejectionMessage(t, { reason: 'type', hasPreviousFile: false }), dict.formValidation_cvType);
        assert.equal(front.cvRejectionMessage(t, { reason: 'type', hasPreviousFile: true }), `${dict.formValidation_cvType} ${dict.formUpload_cvKeptPrevious}`);
        const size = front.cvRejectionMessage(t, { reason: 'size', hasPreviousFile: true, maxLabel: '5MB' });
        assert.ok(size.startsWith(dict.formValidation_maxFileSize.replace('{max}', '5MB')), size);
        assert.ok(size.endsWith(dict.formUpload_cvKeptPrevious), size);
        for (const k of ['formValidation_cvType', 'formUpload_cvKeptPrevious']) assert.ok(String(dict[k] || '').trim(), `${lang}.${k}`);
        assert.ok(/PDF/.test(dict.formValidation_cvType) && /DOCX/.test(dict.formValidation_cvType) && /TXT/.test(dict.formValidation_cvType));
        assert.ok(/PDF/.test(dict.formUpload_cvHint) && /DOCX/.test(dict.formUpload_cvHint) && /TXT/.test(dict.formUpload_cvHint), 'the hint promises the same');
    });
}

// ── The server check both routes run (validateApplicationSubmission) ───────────
const binding = createFormBindingForTemplate(DEFAULT_FORM_TEMPLATE_ID);
const minimalBody = {
    full_name: 'Synthetic Applicant',
    email: 'cv-types@example.com',
    phone: '07800000007',
    position_applied_for: 'HR Specialist',
    years_of_experience: '2',
    skills: JSON.stringify(['Recruitment', 'Onboarding', 'HR records']),
    agreeToTerms: 'true',
};
const submitWith = (mimeType: string, name: string) =>
    validateApplicationSubmission(binding.snapshot, { body: { ...minimalBody }, files: { cv: { mimeType, size: 40_000, name } } });
const cvError = (r: ReturnType<typeof submitWith>) => r.errors.find((e) => e.field === 'cv');

test('server: a Word CV sent as octet-stream is accepted (was 400)', () => assert.equal(cvError(submitWith('application/octet-stream', 'cv.docx')), undefined));
test('server: a PDF with no type is accepted', () => assert.equal(cvError(submitWith('', 'cv.pdf')), undefined));
test('server: an unknown file with no type is refused (used to pass unchecked)', () => assert.ok(cvError(submitWith('', 'cv.exe'))));
test('server: Word 97-2003 (.doc) is refused', () => assert.ok(cvError(submitWith('application/msword', 'cv.doc'))));
test('server: a named non-CV type is refused whatever its name', () => assert.ok(cvError(submitWith('image/png', 'cv.pdf'))));
test('server: the ordinary PDF / DOCX / TXT still pass', () => {
    for (const [m, n] of [['application/pdf', 'cv.pdf'], [DOCX, 'cv.docx'], ['text/plain', 'cv.txt']]) {
        assert.equal(cvError(submitWith(m, n)), undefined, n);
    }
});
test('server: the photo field keeps its own image rule', () => {
    const r = validateApplicationSubmission(binding.snapshot, {
        body: { ...minimalBody },
        files: { cv: { mimeType: 'application/pdf', size: 40_000, name: 'cv.pdf' }, photo: { mimeType: 'application/pdf', size: 1000, name: 'p.pdf' } },
    });
    assert.ok(r.errors.find((e) => e.field === 'photo'), 'a PDF is not a photo');
});

// ── The public form's own check, including an OLD campaign snapshot ────────────
test('public form: the CV check uses the live rule, not an old PDF-only snapshot', () => {
    const oldSnapshotCv = { id: 'cv', type: 'file', required: true, validation: { mimeTypes: ['application/pdf'], maxBytes: 5 * 1024 * 1024 } };
    assert.equal(dynamicValidation.validateDynamicField(oldSnapshotCv, null, { type: 'application/octet-stream', name: 'cv.docx', size: 1000 }), null);
    assert.equal(dynamicValidation.validateDynamicField(oldSnapshotCv, null, { type: 'application/msword', name: 'cv.doc', size: 1000 }), dynamicValidation.CV_TYPE_ERROR);
});

// ── The drift must not come back: both forms use the shared rule ─────────────
test('the legacy form uses the shared rule — no PDF-only list of its own', () => {
    const src = readFrontend('pages/Form.jsx');
    assert.ok(src.includes("from '../utils/cvFileTypes.js'"), 'imports the shared rule');
    assert.ok(/!isAcceptedCvFile\(file\)\s*\?\s*'type'\s*:\s*file\.size > CV_MAX_BYTES\s*\?\s*'size'/.test(src), 'refuses what the shared rule refuses, then anything over the size limit');
    assert.ok(/cvFile:\s*cvRejectionMessage\(t, \{ reason: refused, hasPreviousFile: Boolean\(cvFile\) \}\)/.test(src), 'tells the applicant with the shared message');
    assert.ok(/if \(refused\) \{\s*\/\/[^\n]*\n\s*e\.target\.value = '';/.test(src), 'a refused pick resets the picker');
    assert.ok(/id="cvFile"[\s\S]{0,120}accept=\{CV_ACCEPT_ATTRIBUTE\}/.test(src), 'the CV picker lists every readable type');
    assert.ok(!/["']application\/pdf["']\]/.test(src.slice(src.indexOf("if (fileType === 'cv')"), src.indexOf("} else if (fileType === 'photo')"))), 'no PDF-only list in the CV branch');
    assert.ok(/setCvPreview\(null\);\s*\/\/[^\n]*\n\s*setErrors\(prev => \{[\s\S]{0,200}delete next\.cvFile/.test(src), 'Remove clears the "still attached" note');
});
test('the public form uses the shared picker list and message', () => {
    const src = readFrontend('components/form/DynamicApplicationForm.jsx');
    assert.ok(/field\.id === 'cv'\s*\?\s*CV_ACCEPT_ATTRIBUTE/.test(src), 'the CV picker takes the shared list');
    assert.ok(!src.includes("'.pdf,.docx,.txt,"), 'no hand-written copy of the list');
    assert.ok(/msg === CV_TYPE_ERROR\s*\?\s*'type'/.test(src) && src.includes('cvRejectionMessage(t, {'), 'CV refusals use the shared message');
    assert.ok(/const clearFile[\s\S]{0,700}setErrors\(\(prev\) => \{[\s\S]{0,80}delete next\[fieldId\]/.test(src), 'removing the file clears the note');
});

console.log(`\n[cv-file-types] ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
