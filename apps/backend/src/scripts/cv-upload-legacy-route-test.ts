// ============================================
// scripts/cv-upload-legacy-route-test.ts
// A Word CV sent through the LEGACY application route reaches the Stage 1 evaluator
// whole — header, text boxes and all.
//
// S45 (2026-09-27): the legacy form (/form?template=&campaign= → POST /api/candidates,
// the link most applicants actually get) refused Word in the browser. Opening it
// needs every step after the browser to hold too: the server must accept a Word CV
// the phone labelled application/octet-stream (it answered 400), store it under
// its real type, and the extractor must read the parts mammoth skips (header,
// footer, footnotes, text boxes without a VML copy).
//
// LIFECYCLE: the real candidates router on an in-memory database, a request body
// with every key the real legacy form sent (captured from the browser 2026-09-26),
// a SYNTHETIC Word CV, and the Stage 1 request captured at `fetch`.
// Run: npm run test:cv-upload-legacy-route — no external database, no network, no AI call.
// ============================================

// Pinned BEFORE any import — modules read these at load, and dotenv never overrides.
process.env.N8N_WEBHOOK_URL = 'https://n8n.test.local/webhook/cv-upload-legacy-route';
process.env.BILLING_ENFORCE = 'false';
process.env.STAGE_CALLBACK_SECURITY_MODE = 'optional';
process.env.N8N_STAGE_INBOUND_SECRET = '';
process.env.STAGE_CALLBACK_SIGNING_SECRET = '';
process.env.APPLICATION_OWNS_CAMPAIGN_STATE = 'true';
process.env.RBAC_ENFORCEMENT = 'off';
process.env.ENFORCE_AUTH = 'off';
// The route warms the interview blueprint in the background — never let a test
// reach a real model.
process.env.VIDEO_INTERVIEW_USE_BLUEPRINT = 'false';
process.env.OPENAI_API_KEY = '';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { buildSyntheticDocx, para, partParagraphs, textBoxChoiceOnly, textBoxAsWordWritesIt } from './lib/syntheticDocx.js';

type Json = Record<string, any>;
let pass = 0;
let fail = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
    try {
        await fn();
        console.log('  ✓', name);
        pass += 1;
    } catch (err) {
        console.error('  ✗', name, '\n     ', (err as Error).message);
        fail += 1;
    }
}

const ORG = 'org_cv_upload_legacy_route_test';
const CAMPAIGN_ID = 'camp-cv-upload-legacy-route-001';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Every key the real legacy form sent (browser capture, synthetic applicant).
function legacyBody(email: string, phone: string): Record<string, string> {
    return {
        full_name: 'Synthetic Legacy Applicant',
        email,
        phone,
        location: 'Baghdad',
        gender: '',
        position_applied_for: 'HR Specialist',
        researchDomain: '',
        company_applied_to: '',
        years_of_experience: '2',
        current_company: 'Synthetic Retail Co.',
        highest_education_level: 'bachelor',
        linkedin: '',
        skills: '["Recruitment","Onboarding","HR records"]',
        languages: '[]',
        certifications: '',
        availability: 'immediate',
        expectedSalary: '1200000',
        salaryCurrency: 'IQD',
        coverLetter: '',
        hearAboutUs: '',
        agreeToTerms: 'true',
        position: 'HR Specialist',
        campaignId: CAMPAIGN_ID,
        website: '',
        evaluationLanguage: 'en',
    };
}

async function main(): Promise<void> {
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    console.log('[cv-upload-legacy-route] in-memory mongo up\n');

    const express = (await import('express')).default;
    const candidateRoutes = (await import('../routes/candidates.js')).default;
    const Candidate = (await import('../models/Candidate.js')).default;
    const RecruitmentCampaign = (await import('../models/RecruitmentCampaign.js')).default;
    const Stage1EvaluationOutbox = (await import('../models/Stage1EvaluationOutbox.js')).default;

    await RecruitmentCampaign.collection.insertOne({
        campaignId: CAMPAIGN_ID,
        organizationId: ORG,
        createdByClerkUserId: 'user_cv_upload_legacy_route_test',
        status: 'active',
        criteria: { position: 'HR Specialist', evaluationLanguage: 'en' },
        createdAt: new Date(),
        updatedAt: new Date(),
    });

    const app = express();
    app.use(express.json());
    app.use('/api/candidates', candidateRoutes);
    let server: Server | null = null;
    const realFetch = globalThis.fetch;
    // The legacy upload middleware writes to apps/backend/uploads — even for a file
    // the validation then refuses. Remember what was there; remove only ours.
    const UPLOADS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'uploads');
    const listUploads = () => (fs.existsSync(UPLOADS) ? fs.readdirSync(UPLOADS) : []);
    const uploadsBefore = new Set(listUploads());
    try {
        server = await new Promise<Server>((resolve) => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

        const sentToN8n: Json[] = [];
        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            if (url.startsWith(base)) return realFetch(input, init);
            if (url.startsWith('https://n8n.test.local/')) {
                const body: Json = {};
                if (init?.body instanceof FormData) {
                    for (const [k, v] of init.body.entries()) body[k] = typeof v === 'string' ? v : { file: (v as File).name, type: (v as File).type };
                } else Object.assign(body, JSON.parse(String(init?.body || '{}')));
                sentToN8n.push(body);
                return new Response('{"ok":true}', { status: 200 });
            }
            throw new Error(`unexpected network call in test: ${url}`);
        }) as typeof fetch;

        const post = (email: string, phone: string, file: Blob, name: string) => {
            const form = new FormData();
            for (const [k, v] of Object.entries(legacyBody(email, phone))) form.append(k, v);
            form.append('cv', file, name);
            return realFetch(`${base}/api/candidates`, { method: 'POST', body: form });
        };

        // ── A Word CV the phone labelled octet-stream ───────────────────────
        const docx = await buildSyntheticDocx({
            headers: [partParagraphs(['HDR-LEGACY Synthetic Legacy Applicant — HR Officer'])],
            body: [
                para('BODY-LEGACY recruitment and onboarding for store staff'),
                textBoxAsWordWritesIt('TXBX-LEGACY-WORD skills panel'),
                textBoxChoiceOnly('TXBX-LEGACY-MODERN certificates panel'),
            ].join(''),
        });
        const email1 = 'legacy-docx@example.com';
        const res1 = await post(email1, '07800000011', new Blob([docx], { type: 'application/octet-stream' }), 'cv.docx');
        const json1 = (await res1.json().catch(() => ({}))) as Json;
        await test('the legacy route accepts a Word CV sent as application/octet-stream (was 400)', () =>
            assert.equal(res1.status, 201, `status ${res1.status}: ${JSON.stringify(json1)}`));

        const person1 = await Candidate.findOne({ organizationId: ORG, email: email1 }).lean();
        const cv1 = (person1?.files || []).find((f: Json) => f.kind === 'cv') as Json | undefined;
        await test('it is stored under its real type, not octet-stream', () => assert.equal(cv1?.mimeType, DOCX));

        for (let i = 0; i < 200 && sentToN8n.length < 1; i += 1) await new Promise((r) => setTimeout(r, 50));
        const payload = sentToN8n[0] || {};
        await test('Stage 1 receives the CV text — body, header and BOTH text boxes', () => {
            assert.ok(sentToN8n.length >= 1, 'timed out: no Stage 1 dispatch within 10 s (a slow run, not an extraction result)');
            const cvText = String(payload.cvText || '');
            for (const m of ['BODY-LEGACY', 'HDR-LEGACY', 'TXBX-LEGACY-WORD', 'TXBX-LEGACY-MODERN']) {
                assert.equal(cvText.split(m).length - 1, 1, `${m} once in cvText: ${JSON.stringify(cvText)}`);
            }
            assert.ok(cvText.indexOf('HDR-LEGACY') < cvText.indexOf('BODY-LEGACY'), 'header first');
        });
        await test('the file part n8n receives carries the real Word type', () =>
            assert.deepEqual(payload.cv, { file: 'cv.docx', type: DOCX }));

        // ── A real PDF the device reported with no type ─────────────────────
        const pdfBytes = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'certificate-good.synthetic.pdf'));
        const email2 = 'legacy-untyped-pdf@example.com';
        const res2 = await post(email2, '07800000012', new Blob([pdfBytes]), 'cv.pdf');
        await test('a PDF with no type is accepted', async () => {
            assert.equal(res2.status, 201, `status ${res2.status}: ${JSON.stringify(await res2.json().catch(() => ({})))}`);
            const p = await Candidate.findOne({ organizationId: ORG, email: email2 }).lean();
            const cv = (p?.files || []).find((f: Json) => f.kind === 'cv') as Json | undefined;
            assert.equal(cv?.mimeType, 'application/pdf');
        });

        // ── What the platform still cannot read is refused, with a reason ───
        const email3 = 'legacy-doc@example.com';
        const res3 = await post(email3, '07800000013', new Blob([Buffer.from('synthetic old word bytes')], { type: 'application/msword' }), 'cv.doc');
        const json3 = (await res3.json().catch(() => ({}))) as Json;
        await test('Word 97-2003 (.doc) is refused with a validation error on the CV', async () => {
            assert.equal(res3.status, 400, `status ${res3.status}`);
            assert.equal(json3.code, 'APPLICATION_VALIDATION_FAILED');
            assert.ok((json3.details || []).some((d: Json) => d.field === 'cv'), JSON.stringify(json3.details));
            assert.equal(await Candidate.countDocuments({ organizationId: ORG, email: email3 }), 0, 'nothing stored');
        });

        // Let every fire-and-forget dispatch finish before the database closes.
        for (let i = 0; i < 200; i += 1) {
            if ((await Stage1EvaluationOutbox.countDocuments({ status: { $ne: 'delivered' } })) === 0 && sentToN8n.length >= 2) break;
            await new Promise((r) => setTimeout(r, 50));
        }
        await test('one Stage 1 request per accepted application', async () => {
            assert.equal(sentToN8n.length, 2, `n8n requests: ${sentToN8n.length}`);
            assert.equal(await Stage1EvaluationOutbox.countDocuments({ status: 'delivered' }), 2);
        });
    } finally {
        globalThis.fetch = realFetch;
        if (server) await new Promise((r) => server!.close(r));
        await mongoose.disconnect();
        await mongo.stop();
        const ours = listUploads().filter((n) => !uploadsBefore.has(n));
        for (const n of ours) fs.rmSync(path.join(UPLOADS, n), { force: true });
        console.log(`[cv-upload-legacy-route] removed ${ours.length} test upload(s)`);
    }

    console.log(`\n[cv-upload-legacy-route] ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
