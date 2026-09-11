/**
 * The selective certificate reader: gating, caps and output shape.
 *
 * ⚠️ This file makes NO network calls. Every path that would reach the API is
 * closed off first (no key, feature off, wrong type, oversized), so the suite
 * stays free and deterministic. The end-to-end behaviour was proven once,
 * manually, against a real production certificate:
 *
 *   text layer  -> "Ali Mahmood najm abudalha / Cert ID: PTTFL721"
 *   vision read -> { title: "Certificate of Attendance",
 *                    issuer: "Pioporoto Foundation",
 *                    subject: "Introduction to High-Pressure Gas Lift",
 *                    issuedOn: "September 2, 2025" }   (466 tokens)
 *
 * What matters most here is the GATE. The reader is only affordable because it
 * fires on the ~2 in 3 files whose text layer is empty and never on the rest;
 * a gate that leaks would turn a targeted fix into a per-file bill.
 *
 * Run: npm run test:certificate-vision
 */
import assert from 'node:assert/strict';
import {
    readCertificateWithVision,
    formatVisionRead,
    isCertificateVisionEnabled,
    CERT_VISION_MAX_PER_APPLICATION,
    isReadableCertificateType,
    CERT_VISION_MAX_FILE_BYTES,
} from '../services/certificateVisionReader.js';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown): void {
    if (actual === expected) {
        console.log(`ok   ${name}`);
        return;
    }
    failures += 1;
    console.error(`FAIL ${name}: expected ${String(expected)}, got ${String(actual)}`);
}

function withEnv(vars: Record<string, string | undefined>, fn: () => void | Promise<void>) {
    const prev: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) {
        prev[k] = process.env[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    try {
        return fn();
    } finally {
        for (const [k, v] of Object.entries(prev)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
}

const PDF = Buffer.from('%PDF-1.4 fake');

function testTheFeatureCanBeTurnedOffWithoutADeploy(): void {
    withEnv({ STAGE1_CERTIFICATE_VISION: 'false' }, () => {
        check('flag off disables the reader', isCertificateVisionEnabled(), false);
    });
    withEnv({ STAGE1_CERTIFICATE_VISION: 'true' }, () => {
        check('flag on enables it', isCertificateVisionEnabled(), true);
    });
    withEnv({ STAGE1_CERTIFICATE_VISION: undefined }, () => {
        check('default is on', isCertificateVisionEnabled(), true);
    });
}

async function testEveryRefusalPathReturnsNullAndNeverThrows(): Promise<void> {
    // Off: must not even consider the file.
    await withEnv({ STAGE1_CERTIFICATE_VISION: 'false' }, async () => {
        check('returns null when the flag is off', await readCertificateWithVision(PDF, 'application/pdf', 'a.pdf'), null);
    });

    // No key: the whole n8n send must survive a missing key.
    await withEnv({ STAGE1_CERTIFICATE_VISION: 'true', OPENAI_API_KEY: undefined }, async () => {
        const r = await readCertificateWithVision(PDF, 'application/pdf', 'a.pdf');
        check('returns null with no API key', r, null);
    });

    // Types it must not spend a call on, checked before any request is built.
    await withEnv({ STAGE1_CERTIFICATE_VISION: 'true', OPENAI_API_KEY: undefined }, async () => {
        for (const [mime, name] of [
            ['application/msword', 'a.doc'],
            ['text/plain', 'a.txt'],
            ['application/zip', 'a.zip'],
            ['', 'a.xyz'],
        ] as const) {
            check(`refuses ${mime || '(no mime)'}`, await readCertificateWithVision(PDF, mime, name), null);
        }
        check('refuses an empty buffer', await readCertificateWithVision(Buffer.alloc(0), 'application/pdf', 'a.pdf'), null);
        check(
            'refuses an oversized file',
            await readCertificateWithVision(Buffer.alloc(9 * 1024 * 1024), 'application/pdf', 'big.pdf'),
            null
        );
    });
}

/**
 * The type gate, tested directly. Through `readCertificateWithVision` it could
 * not be: with no key every call returns null anyway, so a mutation deleting
 * the gate outright survived the suite.
 */
function testOnlyPdfsAndImagesAreWorthACall(): void {
    for (const [mime, name] of [
        ['application/pdf', 'cert.pdf'],
        ['image/jpeg', 'cert.jpg'],
        ['image/png', 'cert.png'],
        ['image/webp', 'cert.webp'],
        ['', 'cert.pdf'], // extension alone is enough
        ['', 'scan.PNG'], // and case must not matter
    ] as const) {
        check(`accepts ${mime || '(no mime)'} / ${name}`, isReadableCertificateType(mime, name), true);
    }
    for (const [mime, name] of [
        ['application/msword', 'cv.doc'],
        ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'cv.docx'],
        ['text/plain', 'notes.txt'],
        ['application/zip', 'bundle.zip'],
        ['video/mp4', 'clip.mp4'],
        ['', 'unknown.xyz'],
        ['', ''],
    ] as const) {
        check(`refuses ${mime || '(no mime)'} / ${name || '(no name)'}`, isReadableCertificateType(mime, name), false);
    }
}

/** The cap is what stops twenty uploads becoming twenty calls. */
function testThePerApplicationCapExists(): void {
    check('cap is a positive finite number', Number.isFinite(CERT_VISION_MAX_PER_APPLICATION) && CERT_VISION_MAX_PER_APPLICATION > 0, true);
    check('cap defaults to 5', CERT_VISION_MAX_PER_APPLICATION, 5);
    // Asserted on the constant: through the reader this is indistinguishable from
    // the no-key path, so a mutation removing the cap survived the suite.
    check('file size cap is 8MB', CERT_VISION_MAX_FILE_BYTES, 8 * 1024 * 1024);
}

/**
 * The line handed to the evaluator must say where it came from. A title read
 * off an image is weaker evidence than one printed in the file, and presenting
 * the two identically would hide that.
 */
function testTheOutputDeclaresItsSource(): void {
    const line = formatVisionRead({
        title: 'Certificate of Attendance',
        issuer: 'Pioporoto Foundation',
        subject: 'Introduction to High-Pressure Gas Lift',
        issuedOn: 'September 2, 2025',
    });
    check('names the qualification', line.includes('Certificate of Attendance'), true);
    check('names the issuer', line.includes('Pioporoto Foundation'), true);
    check('names the subject', line.includes('Introduction to High-Pressure Gas Lift'), true);
    check('declares it was read from the image', line.includes('read from the certificate image'), true);

    const bare = formatVisionRead({ title: 'PMP' });
    check('works with title alone', bare.includes('PMP'), true);
    check('adds no empty separator when there is nothing else', bare.includes('—'), false);
}

testTheFeatureCanBeTurnedOffWithoutADeploy();
await testEveryRefusalPathReturnsNullAndNeverThrows();
testOnlyPdfsAndImagesAreWorthACall();
testThePerApplicationCapExists();
testTheOutputDeclaresItsSource();

assert.equal(failures, 0, `${failures} case(s) failed`);
console.log('\ncertificate-vision-test: all passed');
