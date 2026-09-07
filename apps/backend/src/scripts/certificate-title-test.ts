/**
 * A certificate should say what it is, not who uploaded it.
 *
 * Real production data: six files called "Ali Mahmood Najm Abudalha  3.pdf" …
 * " 7.pdf" on one application, plus "image.jpg" and a screenshot. The profile
 * could only show those names, so a reviewer had to open every file.
 *
 * The rule is deliberately high-precision: a certificate's first line is as
 * often the holder's name or an ornament as it is the qualification, and a
 * confident wrong title is worse than a visibly useless filename. When in
 * doubt it returns '' and the view keeps its filename fallback.
 *
 * Run: npx tsx src/scripts/certificate-title-test.ts
 */
import assert from 'node:assert';
import { deriveCertificateTitle } from '../services/certificateTitle.js';

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

test('a known qualification is named exactly, wherever it sits in the header', () => {
    assert.strictEqual(deriveCertificateTitle('SHRM Certified Professional (SHRM-CP)'), 'SHRM-CP');
    assert.strictEqual(deriveCertificateTitle('Project Management Professional (PMP)®'), 'PMP');
    assert.strictEqual(deriveCertificateTitle('This certifies completion of NEBOSH IGC'), 'NEBOSH');
});

test('the more specific variant wins over the shorter one', () => {
    // SHRM-SCP contains "SCP"; ordering must not let SHRM-CP match first.
    assert.strictEqual(deriveCertificateTitle('SHRM-SCP awarded to ...'), 'SHRM-SCP');
    assert.strictEqual(deriveCertificateTitle('SPHR awarded to ...'), 'SPHR');
});

test('a code embedded in a longer word is not a qualification', () => {
    assert.strictEqual(deriveCertificateTitle('Completed the PMPX internal programme'), '');
    // Plural too: "CPAs" is prose about accountants, not a CPA certificate.
    assert.strictEqual(deriveCertificateTitle('Our CPAs reviewed the accounts'), '');
    assert.strictEqual(deriveCertificateTitle('CPA'), 'CPA');
});

test('a line that declares what the certificate is in, is used', () => {
    assert.strictEqual(
        deriveCertificateTitle('AWARDED TO\nAli Mahmood\nCertificate in Human Resources Management\n2024'),
        'Certificate in Human Resources Management'
    );
    assert.strictEqual(
        deriveCertificateTitle('مؤسسة التدريب\nشهادة في إدارة الموارد البشرية\n٢٠٢٤'),
        'شهادة في إدارة الموارد البشرية'
    );
});

test('this is the case that must NOT be guessed: a name under an ornament', () => {
    // The old idea of "use the first meaningful line" would label this file
    // with the applicant's own name — exactly the problem being fixed.
    assert.strictEqual(deriveCertificateTitle('CERTIFICATE\nAli Mahmood Najm Abudalha\n12 May 2024'), '');
    assert.strictEqual(deriveCertificateTitle('This is to certify that Ali Mahmood Najm'), '');
});

test('an unreadable file yields nothing, and never throws', () => {
    assert.strictEqual(deriveCertificateTitle(''), '');
    assert.strictEqual(deriveCertificateTitle('   \n  '), '');
    assert.strictEqual(deriveCertificateTitle(null), '');
    assert.strictEqual(deriveCertificateTitle(undefined), '');
    assert.strictEqual(deriveCertificateTitle(42 as never), '');
});

test('a long title is trimmed rather than allowed to break the row', () => {
    const long = `Certificate of Completion in ${'Advanced '.repeat(12)}Management`;
    const out = deriveCertificateTitle(long);
    assert.ok(out.length <= 60, `got ${out.length}`);
    assert.ok(out.endsWith('…'));
});

test('only the top of the document is considered', () => {
    // A qualification named on page four is not this document's title.
    const buried = `${'filler line\n'.repeat(200)}PMP`;
    assert.strictEqual(deriveCertificateTitle(buried), '');
});

console.log(`\n[certificate-title] ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
