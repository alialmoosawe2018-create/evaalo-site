/**
 * S16 — an uploaded certificate that is an image, or a PDF with no text layer,
 * must actually REACH the vision reader through the production entry point.
 *
 * Why this exists — measured 2026-09-25 in production: of 6 applications in one
 * organisation that uploaded a certificate, 3 were JPEG photos and 1 was a fully
 * scanned PDF. None was read. extractTextFromCv throws for both shapes
 * (UNSUPPORTED_TYPE / EMPTY_CV), and the only call to the vision reader sat below
 * that call, so the catch branch took over and wrote "content not extracted".
 * The container logged ZERO `certificate vision` lines since it started.
 *
 * `certificate-vision-test` stayed green the whole time because it calls the
 * reader directly. That proves the reader works; it cannot prove anything calls
 * it. Every assertion here goes through `buildCertificatesTextForN8n` — the
 * function sendToN8N calls — with only the reader swapped for a fake, so the
 * question "was the reader reached?" has a direct answer.
 *
 * ⚠️ One PDF case per process. pdf-parse carries state from one document to the
 * next inside a process. Measured while writing this file: hand-built minimal
 * PDFs (non-embedded Helvetica) extract correctly only when parsed first; the
 * Chrome-generated fixtures below are stable for text PDFs, but the image-only
 * one returned PARSE_FAILED instead of EMPTY_CV once in 12 parses when it was not
 * the first. So each case that parses a PDF runs in its own child process, where
 * its fixture is the first document read. Do not fold them back into one run.
 *
 * All fixtures are synthetic. The three PDFs in fixtures/certificate-*.synthetic.pdf
 * were printed by headless Chrome (Puppeteer page.pdf) from inline HTML: a
 * completion certificate with an invented holder and board, a page holding only
 * that name and an ID, and a page of vector shapes with no text layer. Image
 * bytes are a made-up JPEG shell. Nothing is copied from real uploads — this
 * repository is public.
 *
 * Run: npm run test:certificate-vision-path
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    buildCertificatesTextForN8n,
    CERT_NOT_EXTRACTED,
} from '../services/n8nService.js';
import {
    CERT_VISION_MAX_PER_APPLICATION,
    type CertificateVisionRead,
    type readCertificateWithVision,
} from '../services/certificateVisionReader.js';
import { extractTextFromCv, CvExtractionError } from '../services/cvTextExtractor.js';

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
    if (cond) {
        passed += 1;
        console.log(`  ✓ ${name}`);
    } else {
        failures.push(name);
        console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

// ── synthetic fixtures ──────────────────────────────────────────────────────

const HOLDER = 'Sample Holder Testname';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name: string) => () => readFileSync(join(FIXTURES, name));

const GOOD_PDF = fixture('certificate-good.synthetic.pdf');
const SCANNED_PDF = fixture('certificate-scanned.synthetic.pdf');
const THIN_PDF = fixture('certificate-thin.synthetic.pdf');
const CORRUPT_PDF = () => Buffer.from('%PDF-1.4\nthis body is not a PDF object table at all\n', 'latin1');
// A JPEG shell: SOI, a tiny APP0-ish segment, EOI. The extractor never parses
// image bytes — it refuses them by type — and the vision reader is faked.
const JPEG = () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);

const READ: CertificateVisionRead = {
    title: 'NEBOSH International General Certificate',
    issuer: 'Synthetic Examining Board',
    issuedOn: '2025',
};

let dir = '';
let seq = 0;
function file(bytes: Buffer, mimeType: string, originalName: string) {
    if (!dir) dir = mkdtempSync(join(tmpdir(), 'cert-vision-path-'));
    seq += 1;
    const filename = `cert-${seq}-${originalName}`;
    const path = join(dir, filename);
    writeFileSync(path, bytes);
    return { type: 'certificate' as const, filename, originalName, path, mimeType, size: bytes.length };
}

// ── a fake reader that records every call ───────────────────────────────────

function fakeReader(result: CertificateVisionRead | null | 'throw') {
    const calls: Array<{ mime: string; name?: string; bytes: number }> = [];
    const fn = (async (buf: Buffer, mime: string, name?: string) => {
        calls.push({ mime, name, bytes: buf.length });
        if (result === 'throw') throw new Error('synthetic vision outage');
        return result;
    }) as typeof readCertificateWithVision;
    return { fn, calls };
}

/** Run with console.log captured, so the cost line can be asserted on. */
async function withLogs<T>(fn: () => Promise<T>): Promise<{ value: T; logs: string[] }> {
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => {
        logs.push(a.map(String).join(' '));
    };
    try {
        return { value: await fn(), logs };
    } finally {
        console.log = orig;
    }
}

async function extractCode(bytes: Buffer, mime: string, name: string): Promise<string> {
    try {
        await extractTextFromCv(bytes, mime, name);
        return 'OK';
    } catch (e) {
        return e instanceof CvExtractionError ? e.code : 'OTHER';
    }
}

// ── the cases (each key runs in its own process) ───────────────────────────

const CASES: Record<string, () => Promise<void>> = {
    // Fixture guards: each fixture hits the branch its case assumes. One PDF each.
    'guard-scanned': async () => {
        console.log('\nguard · the scanned fixture throws EMPTY_CV:');
        const c = await extractCode(SCANNED_PDF(), 'application/pdf', 'c.pdf');
        check('scanned PDF → EMPTY_CV', c === 'EMPTY_CV', c);
    },
    'guard-good': async () => {
        console.log('\nguard · the good fixture extracts:');
        const c = await extractCode(GOOD_PDF(), 'application/pdf', 'c.pdf');
        check('good PDF → extracts', c === 'OK', c);
    },
    'guard-thin': async () => {
        console.log('\nguard · the thin fixture extracts (does not throw):');
        const c = await extractCode(THIN_PDF(), 'application/pdf', 'c.pdf');
        check('thin PDF → extracts', c === 'OK', c);
    },
    'guard-corrupt': async () => {
        console.log('\nguard · the corrupt fixture throws PARSE_FAILED:');
        const c = await extractCode(CORRUPT_PDF(), 'application/pdf', 'c.pdf');
        check('corrupt PDF → PARSE_FAILED', c === 'PARSE_FAILED', c);
    },

    // Everything below that does not parse a PDF can share one process.
    images: async () => {
        console.log('\nguard · image fixtures are refused by type, before any PDF parser:');
        check('JPEG → UNSUPPORTED_TYPE', (await extractCode(JPEG(), 'image/jpeg', 'c.jpg')) === 'UNSUPPORTED_TYPE');
        check('HEIC → UNSUPPORTED_TYPE', (await extractCode(JPEG(), 'image/heic', 'c.heic')) === 'UNSUPPORTED_TYPE');

        console.log('\n1 · a supported JPEG reaches the reader and its reading reaches the payload:');
        {
            const v = fakeReader(READ);
            const { value, logs } = await withLogs(() =>
                buildCertificatesTextForN8n([file(JPEG(), 'image/jpeg', 'photo.jpg')], HOLDER, { readVision: v.fn })
            );
            const text = value?.certificatesText || '';
            check('reader was called exactly once', v.calls.length === 1, `calls=${v.calls.length}`);
            check('…with the image mime', v.calls[0]?.mime === 'image/jpeg');
            check('the read title is in the payload', text.includes(READ.title));
            check('…marked as read from the image', text.includes('read from the certificate image'));
            check('no "not extracted" marker for a certificate that WAS read', !text.includes(CERT_NOT_EXTRACTED));
            check('the cost line proves the vision path ran (1/1)', logs.some((l) => l.includes('certificate vision: 1/1')), logs.join(' | '));
        }

        console.log('\n5a · the reader returning nothing leaves the safe marker:');
        {
            const v = fakeReader(null);
            const { value, logs } = await withLogs(() =>
                buildCertificatesTextForN8n([file(JPEG(), 'image/jpeg', 'photo.jpg')], HOLDER, { readVision: v.fn })
            );
            const text = value?.certificatesText || '';
            check('reader was tried', v.calls.length === 1);
            check('marker verbatim after a null read', text.includes(`(image/unsupported certificate — ${CERT_NOT_EXTRACTED})`));
            check('cost line 0/1 (attempted, nothing recovered)', logs.some((l) => l.includes('certificate vision: 0/1')));
        }

        console.log('\n· an image type the reader does not accept (HEIC) is not sent to it:');
        {
            const v = fakeReader(READ);
            const { value } = await withLogs(() =>
                buildCertificatesTextForN8n([file(JPEG(), 'image/heic', 'photo.heic')], HOLDER, { readVision: v.fn })
            );
            check('reader NOT called', v.calls.length === 0, `calls=${v.calls.length}`);
            check('marker verbatim', (value?.certificatesText || '').includes(CERT_NOT_EXTRACTED));
        }

        console.log(`\n· the per-application cap (${CERT_VISION_MAX_PER_APPLICATION}) holds on the new branch:`);
        {
            const v = fakeReader(READ);
            const files = Array.from({ length: CERT_VISION_MAX_PER_APPLICATION + 1 }, (_, i) =>
                file(JPEG(), 'image/jpeg', `photo-${i + 1}.jpg`)
            );
            const { value } = await withLogs(() => buildCertificatesTextForN8n(files, HOLDER, { readVision: v.fn }));
            const text = value?.certificatesText || '';
            check(`reader called exactly ${CERT_VISION_MAX_PER_APPLICATION} times`, v.calls.length === CERT_VISION_MAX_PER_APPLICATION, `calls=${v.calls.length}`);
            check(
                'the one past the cap keeps the marker',
                text.includes(`photo-${CERT_VISION_MAX_PER_APPLICATION + 1}.jpg] (image/unsupported certificate — ${CERT_NOT_EXTRACTED})`)
            );
        }

        console.log('\n· production wiring: no injection ⇒ the REAL reader is reached (flag off, no network):');
        {
            const prev = process.env.STAGE1_CERTIFICATE_VISION;
            process.env.STAGE1_CERTIFICATE_VISION = 'false';
            try {
                const { value, logs } = await withLogs(() =>
                    buildCertificatesTextForN8n([file(JPEG(), 'image/jpeg', 'photo.jpg')], HOLDER)
                );
                check('the real reader was attempted (0/1 logged)', logs.some((l) => l.includes('certificate vision: 0/1')), logs.join(' | '));
                check('flag off ⇒ safe marker', (value?.certificatesText || '').includes(CERT_NOT_EXTRACTED));
            } finally {
                if (prev === undefined) delete process.env.STAGE1_CERTIFICATE_VISION;
                else process.env.STAGE1_CERTIFICATE_VISION = prev;
            }
        }
    },

    'case2-scanned': async () => {
        console.log('\n2 · a scanned PDF (EMPTY_CV) falls back to the reader:');
        const v = fakeReader(READ);
        const { value, logs } = await withLogs(() =>
            buildCertificatesTextForN8n([file(SCANNED_PDF(), 'application/pdf', 'scan.pdf')], HOLDER, { readVision: v.fn })
        );
        const text = value?.certificatesText || '';
        check('reader was called exactly once', v.calls.length === 1, `calls=${v.calls.length}`);
        check('…with the PDF mime', v.calls[0]?.mime === 'application/pdf');
        check('the read title is in the payload', text.includes(READ.title));
        check('no marker for a certificate that WAS read', !text.includes(CERT_NOT_EXTRACTED));
        check('cost line 1/1', logs.some((l) => l.includes('certificate vision: 1/1')));
    },

    'case3-good': async () => {
        console.log('\n3 · a PDF with a sound text layer never costs a vision call:');
        const v = fakeReader(READ);
        const { value, logs } = await withLogs(() =>
            buildCertificatesTextForN8n([file(GOOD_PDF(), 'application/pdf', 'good.pdf')], HOLDER, { readVision: v.fn })
        );
        const text = value?.certificatesText || '';
        check('reader NOT called', v.calls.length === 0, `calls=${v.calls.length}`);
        check(
            'the extracted text is in the payload',
            text.replace(/\s+/g, ' ').includes('successfully completed the NEBOSH International General Certificate')
        );
        check('no cost line printed', !logs.some((l) => l.includes('certificate vision')));
    },

    'case4-corrupt': async () => {
        console.log('\n4 · a corrupt file (PARSE_FAILED) fails safe and never reaches the reader:');
        const v = fakeReader(READ);
        const { value } = await withLogs(() =>
            buildCertificatesTextForN8n([file(CORRUPT_PDF(), 'application/pdf', 'broken.pdf')], HOLDER, { readVision: v.fn })
        );
        const text = value?.certificatesText || '';
        check('reader NOT called for PARSE_FAILED', v.calls.length === 0, `calls=${v.calls.length}`);
        check('marker present verbatim', text.includes(`could not read certificate — ${CERT_NOT_EXTRACTED}`));
        check('no fabricated title', !text.includes(READ.title));
    },

    'case5b-throw': async () => {
        console.log('\n5b · a reader that throws leaves the safe marker and does not reject the build:');
        const v = fakeReader('throw');
        let resolved = true;
        let text = '';
        try {
            text =
                (await withLogs(() =>
                    buildCertificatesTextForN8n([file(SCANNED_PDF(), 'application/pdf', 'scan.pdf')], HOLDER, { readVision: v.fn })
                )).value?.certificatesText || '';
        } catch {
            resolved = false;
        }
        check('reader was tried', v.calls.length === 1, `calls=${v.calls.length}`);
        check('a throwing reader does not reject the whole build', resolved);
        check('marker verbatim after a thrown read', text.includes(`likely a scanned/image certificate — ${CERT_NOT_EXTRACTED}`));
    },

    'thin-unchanged': async () => {
        console.log('\n· the existing thin-text PDF path still uses the reader (unchanged):');
        const v = fakeReader(READ);
        const { value } = await withLogs(() =>
            buildCertificatesTextForN8n([file(THIN_PDF(), 'application/pdf', 'thin.pdf')], HOLDER, { readVision: v.fn })
        );
        check('reader called once', v.calls.length === 1, `calls=${v.calls.length}`);
        check('reading reaches the payload', (value?.certificatesText || '').includes(READ.title));
    },
};

// ── runner ──────────────────────────────────────────────────────────────────

async function runOne(name: string): Promise<void> {
    const fn = CASES[name];
    if (!fn) {
        console.error(`unknown case: ${name}`);
        process.exit(2);
    }
    try {
        await fn();
    } finally {
        if (dir) rmSync(dir, { recursive: true, force: true });
    }
    console.log(`@@RESULT ${name} ${passed} ${failures.length}`);
    process.exit(failures.length ? 1 : 0);
}

function runAll(): void {
    const self = fileURLToPath(import.meta.url);
    let total = 0;
    let failed = 0;
    const failedCases: string[] = [];
    for (const name of Object.keys(CASES)) {
        const r = spawnSync(process.execPath, [...process.execArgv, self, name], { encoding: 'utf8' });
        const out = (r.stdout || '') + (r.stderr || '');
        for (const line of out.split(/\r?\n/)) {
            if (/^\s+[✓✗]/.test(line) || /^\s*(\d|guard|·)/.test(line) || line.startsWith('\n')) console.log(line);
        }
        const m = out.match(/@@RESULT \S+ (\d+) (\d+)/);
        if (!m) {
            failed += 1;
            failedCases.push(`${name} (no result — exit ${r.status})`);
            console.log(out.split(/\r?\n/).slice(-8).join('\n'));
            continue;
        }
        total += Number(m[1]);
        failed += Number(m[2]);
        if (Number(m[2]) || r.status !== 0) failedCases.push(name);
    }
    console.log(`\n[certificate-vision-path] ${total} passed, ${failed} failed across ${Object.keys(CASES).length} isolated runs`);
    if (failed || failedCases.length) {
        for (const c of failedCases) console.error(`  FAILED CASE: ${c}`);
        process.exit(1);
    }
}

const requested = process.argv[2];
if (requested) void runOne(requested);
else runAll();
