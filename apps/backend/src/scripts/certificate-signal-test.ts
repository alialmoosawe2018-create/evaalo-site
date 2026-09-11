/**
 * A certificate whose text layer says nothing must not reach the evaluator as
 * evidence.
 *
 * Why this exists — measured 2026-09-11 on real Stage 1 executions:
 * of the NINE applications that carried uploaded certificates, EIGHT extracted
 * "successfully" and produced 37-46 characters per file: the holder's own name
 * and an identifier, nothing more. Only ONE was correctly flagged unreadable.
 *
 * The consequence was not a missing strength, it was a false one. The Stage 1
 * evaluator had nothing but an ID, so it reported exactly that — "الشهادات
 * المرفوعة موجودة (رقم الشهادة: PTTFL721)" — a line that looks like evidence
 * and tells a reviewer nothing about what the certificate is or whether it
 * matters for the role.
 *
 * The error path could not catch it: extraction did not throw. "Succeeded" and
 * "produced meaning" were the same state.
 *
 * Both directions are asserted. A detector that discards anything short would
 * silence real certificates, which is the worse failure of the two.
 *
 * Run: npm run test:certificate-signal
 */
import assert from 'node:assert/strict';
import {
    meaningfulCertificateChars,
    CERT_MIN_MEANINGFUL_CHARS,
    CERT_NOT_EXTRACTED,
} from '../services/n8nService.js';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown): void {
    if (actual === expected) {
        console.log(`ok   ${name}`);
        return;
    }
    failures += 1;
    console.error(`FAIL ${name}: expected ${String(expected)}, got ${String(actual)}`);
}

const isLowSignal = (text: string, holder?: string) =>
    meaningfulCertificateChars(text, holder) < CERT_MIN_MEANINGFUL_CHARS;

/** ⚠️ The exact text production handed the evaluator (n8n execution 1789). */
const REAL_PRODUCTION_TEXT_1 = 'Ali Mahmood najm abudalha\nCert ID: PTTFL721';
const REAL_PRODUCTION_TEXT_2 = 'Ali Mahmood najm abudalha\nCertID: SLBSept25-1454';
const HOLDER = 'Ali Mahmood najm abudalha';

function testTheRealProductionCaseIsCaught(): void {
    check('production cert 1 (name + Cert ID) is low signal', isLowSignal(REAL_PRODUCTION_TEXT_1, HOLDER), true);
    check('production cert 2 (name + CertID) is low signal', isLowSignal(REAL_PRODUCTION_TEXT_2, HOLDER), true);
    // The same text WITHOUT knowing the holder must still be caught: the name is
    // stripped when we know it, but an ID line alone is already meaningless.
    check('caught even with no holder name supplied', isLowSignal(REAL_PRODUCTION_TEXT_1), true);
}

function testOtherIdentifierSpellings(): void {
    for (const line of [
        'Certificate No: 12345',
        'Certificate Number 998877',
        'Serial No. AB-99213',
        'Reference: XY9931',
        'Registration No: 55512',
        'ID: 4482',
    ]) {
        check(`"${line}" alone is low signal`, isLowSignal(`${HOLDER}\n${line}`, HOLDER), true);
    }
}

/**
 * The other direction — these must survive. A real certificate is wordy, and
 * silencing one is worse than the noise this change removes.
 */
function testRealCertificatesSurvive(): void {
    const real = [
        [
            'a full completion certificate',
            'This is to certify that Ali Mahmood najm abudalha has successfully completed the Well Control Fundamentals training programme, IWCF accredited, held in Basra.',
        ],
        [
            'a terse but genuine qualification line',
            'Ali Mahmood najm abudalha\nCertificate of Completion in Occupational Health and Safety Management Systems',
        ],
        [
            'an HR qualification with an ID alongside it',
            'Ali Mahmood najm abudalha\nCert ID: 8891\nSociety for Human Resource Management Certified Professional examination passed',
        ],
        [
            'Arabic certificate text',
            'شهادة مشاركة\nيشهد بأن علي محمود نجم قد أتم بنجاح دورة إدارة الموارد البشرية المتقدمة المنعقدة في بغداد',
        ],
    ] as const;
    for (const [label, text] of real) {
        check(`${label} survives`, isLowSignal(text, HOLDER), false);
    }
}

/**
 * The marker the Stage 1 prompt keys on. Two of the three error notes used to
 * read "no readable text" and "could not read certificate" — neither contains
 * the phrase the prompt looks for, so the guard could not fire on exactly the
 * files it was written for.
 */
function testTheMarkerMatchesWhatThePromptLooksFor(): void {
    check('canonical marker is the phrase the prompt keys on', CERT_NOT_EXTRACTED, 'content not extracted');
    check('marker contains "not extracted"', CERT_NOT_EXTRACTED.includes('not extracted'), true);
}

function testThresholdIsWhereTheMeasurementPutIt(): void {
    // Real files measured 37-46 chars RAW; after stripping the holder name and
    // the ID line they fall to single digits. Genuine text runs to hundreds.
    check('threshold unchanged', CERT_MIN_MEANINGFUL_CHARS, 40);
    check('empty text is low signal', isLowSignal('', HOLDER), true);
    check('whitespace only is low signal', isLowSignal('   \n  \n ', HOLDER), true);
}

testTheRealProductionCaseIsCaught();
testOtherIdentifierSpellings();
testRealCertificatesSurvive();
testTheMarkerMatchesWhatThePromptLooksFor();
testThresholdIsWhereTheMeasurementPutIt();

assert.equal(failures, 0, `${failures} case(s) failed`);
console.log('\ncertificate-signal-test: all passed');
