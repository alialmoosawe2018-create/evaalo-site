// ============================================
// scripts/public-apply-languages-test.ts
// A NEW applicant on a public link (`/form?pub=`) who adds a language must be
// able to submit.
//
// Until this test, they could not. The public form sends each language as
// { name, level }; validation keeps the objects; the public route handed them
// to `new Candidate(...)`, whose `languages` is [String] — a CastError, and the
// route answered 500 "Failed to submit application". Found 2026-09-26 by a
// synthetic production submission. The logged-in route never failed because it
// converted the objects before validation, so every stored application looked
// fine and nothing pointed at the public link.
//
// This is a LIFECYCLE test: the real public router on a real (in-memory)
// database, the form config the browser loads, and the Stage 1 request the
// backend then sends, captured at `fetch`. The request bodies come from two
// sources: a builder that follows DynamicApplicationForm.jsx field by field,
// and — because a hand copy can drift from the component — the VERBATIM body a
// real browser sent from that form on 2026-09-26 (synthetic applicant, captured
// by a local mock). A test of the converter alone would pass with the route
// still broken.
//
// Run: npm run test:public-apply-languages
// Uses mongodb-memory-server — no external database, nothing leaves the machine.
// ============================================

// The payload module loads the real .env on import. dotenv never overrides a
// variable that is already set, so everything that matters is pinned FIRST.
process.env.N8N_WEBHOOK_URL = 'https://n8n.test.local/webhook/public-apply-languages';
process.env.BILLING_ENFORCE = 'false';
process.env.STAGE_CALLBACK_SECURITY_MODE = 'optional';
process.env.N8N_STAGE_INBOUND_SECRET = '';
process.env.STAGE_CALLBACK_SIGNING_SECRET = '';
process.env.APPLICATION_OWNS_CAMPAIGN_STATE = 'true';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

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

const ORG = 'org_public_apply_languages_test';
const CAMPAIGN_ID = 'camp-public-apply-languages-001';
const PUB = 'pub_PublicApplyLanguagesTest000000001';
// A second campaign of the same organisation, for the returning applicant.
const CAMPAIGN_ID_2 = 'camp-public-apply-languages-002';
const PUB_2 = 'pub_PublicApplyLanguagesTest000000002';

// Every key a real browser sent from `/form?pub=` on 2026-09-26, verbatim —
// including the role fields and the honeypot the hand-built body leaves out.
// The applicant is synthetic; "RecruitmentOnboarding" is a typing slip in that
// session, kept as sent.
const BROWSER_CAPTURE: Record<string, string> = {
    full_name: 'Synthetic Browser Applicant',
    email: 'browser-languages@example.com',
    phone: '07800000003',
    location: 'Baghdad',
    gender: '',
    position_applied_for: 'HR Specialist',
    company_applied_to: '',
    years_of_experience: '2',
    current_company: 'Synthetic Retail Co.',
    highest_education_level: 'bachelor',
    linkedin: '',
    skills: '["Recruitment","RecruitmentOnboarding","HR records"]',
    languages: '[{"name":"English","level":"intermediate"},{"name":"Arabic","level":"native"}]',
    certifications: '',
    availability: '',
    expectedSalary: '1200000',
    salaryCurrency: 'IQD',
    coverLetter: 'I coordinate recruitment and onboarding for store staff.',
    hearAboutUs: '',
    agreeToTerms: 'true',
    website: '',
    evaluationLanguage: 'en',
    roleKey: 'hr_specialist',
    careerLevel: 'mid',
    managementTrack: 'ic',
    labelKey: 'hr_specialist.mid',
    roleMatchSource: 'exact_catalog',
};

// What a synthetic applicant typed. `languages` is what the form keeps in
// state: addLanguage() pushes { name, level } (DynamicApplicationForm.jsx).
function typedValues(email: string, languages: unknown[]): Json {
    return {
        full_name: 'Synthetic Applicant',
        email,
        phone: '07800000002',
        location: 'Baghdad',
        gender: 'female',
        position_applied_for: 'HR Specialist',
        years_of_experience: '2',
        highest_education_level: 'bachelor',
        current_company: 'Synthetic Retail Co.',
        skills: ['Recruitment', 'Onboarding', 'HR records'],
        languages,
        expectedSalary: '1200000',
        salaryCurrency: 'IQD',
        availability: 'immediate',
        coverLetter: 'I coordinate recruitment and onboarding for store staff.',
        agreeToTerms: true,
    };
}

function syntheticCv(): Blob {
    const text = 'Synthetic Applicant\nHR Officer, Baghdad\nRecruitment coordination, onboarding, HR records.\n';
    return new Blob([text], { type: 'text/plain' });
}

// The request body, built the way DynamicApplicationForm.jsx submits it: one
// entry per field in the config the browser loaded, arrays as JSON, booleans as
// 'true'/'false', then the files, the honeypot and the evaluation language.
function buildBrowserBody(fields: Array<{ id: string; type: string }>, values: Json): FormData {
    const body = new FormData();
    for (const field of fields) {
        if (field.type === 'file') continue;
        const val = values[field.id];
        if (field.type === 'string_array' || field.type === 'language_array') {
            body.append(field.id, JSON.stringify(val ?? []));
        } else if (field.type === 'boolean') {
            body.append(field.id, val ? 'true' : 'false');
        } else {
            body.append(field.id, val ?? '');
        }
    }
    body.append('cv', syntheticCv(), 'resume.txt');
    body.append('website', '');
    body.append('evaluationLanguage', 'en');
    return body;
}

function capturedBrowserBody(): FormData {
    const body = new FormData();
    for (const [key, value] of Object.entries(BROWSER_CAPTURE)) body.append(key, value);
    body.append('cv', syntheticCv(), 'synthetic-cv.txt');
    return body;
}

async function main(): Promise<void> {
    // The router creates `uploads/` in the working directory and multer writes
    // the CV there — keep that out of the repository.
    const startDir = process.cwd();
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'public-apply-languages-'));
    process.chdir(workDir);

    const realFetch = globalThis.fetch;
    let mongo: MongoMemoryServer | null = null;
    let server: Server | null = null;
    try {
        mongo = await MongoMemoryServer.create();
        await mongoose.connect(mongo.getUri());
        console.log('[public-apply-languages] in-memory mongo up\n');

        const express = (await import('express')).default;
        const publicCampaignRoutes = (await import('../routes/publicCampaign.js')).default;
        const Candidate = (await import('../models/Candidate.js')).default;
        const CandidateApplication = (await import('../models/CandidateApplication.js')).default;
        const RecruitmentCampaign = (await import('../models/RecruitmentCampaign.js')).default;
        const Stage1EvaluationOutbox = (await import('../models/Stage1EvaluationOutbox.js')).default;
        const { normalizeLanguagesToStringArray, mergeValidatedIntoCandidateData } = await import(
            '../services/applicationSubmitValidation.js'
        );

        // Raw insert, like the production campaign this reproduces: active, a
        // public token, no form binding (so the default template applies).
        for (const [campaignId, pub] of [[CAMPAIGN_ID, PUB], [CAMPAIGN_ID_2, PUB_2]]) {
            await RecruitmentCampaign.collection.insertOne({
                campaignId,
                organizationId: ORG,
                createdByClerkUserId: 'user_public_apply_languages_test',
                status: 'active',
                publicApplicationToken: pub,
                criteria: { position: 'HR Specialist', evaluationLanguage: 'en' },
                createdAt: new Date(),
                updatedAt: new Date(),
            });
        }

        const app = express();
        app.use(express.json());
        app.use('/api/public', publicCampaignRoutes);
        server = await new Promise<Server>((resolve) => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

        // Let the test's own calls to the local server through; capture what
        // the backend sends to n8n; refuse anything else.
        const sentToN8n: Array<{ url: string; body: Json }> = [];
        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            if (url.startsWith(base)) return realFetch(input, init);
            if (url.startsWith('https://n8n.test.local/')) {
                let body: Json = {};
                if (init?.body instanceof FormData) {
                    for (const [k, v] of init.body.entries()) body[k] = typeof v === 'string' ? v : '[file]';
                } else {
                    body = JSON.parse(String(init?.body || '{}'));
                }
                sentToN8n.push({ url, body });
                return new Response('{"ok":true}', { status: 200 });
            }
            throw new Error(`unexpected network call in test: ${url}`);
        }) as typeof fetch;

        const waitForN8n = async (count: number): Promise<void> => {
            for (let i = 0; i < 100 && sentToN8n.length < count; i += 1) {
                await new Promise((r) => setTimeout(r, 50));
            }
        };
        const n8nLanguages = (body: Json): unknown =>
            typeof body.languages === 'string' ? JSON.parse(body.languages) : body.languages;
        const apply = (pub: string, body: FormData) =>
            realFetch(`${base}/api/public/campaigns/${pub}/apply`, { method: 'POST', body });
        const personByEmail = (email: string) => Candidate.findOne({ organizationId: ORG, email }).lean();

        const cfgRes = await realFetch(`${base}/api/public/campaigns/${PUB}/form-config`);
        const cfg = (await cfgRes.json()) as Json;
        const fields: Array<{ id: string; type: string }> = cfg?.form?.fields ?? [];

        await test('the public form offers a language field of type language_array', () => {
            assert.equal(cfgRes.status, 200);
            const lang = fields.find((f) => f.id === 'languages');
            assert.ok(lang, `form-config has no languages field: ${fields.map((f) => f.id).join(',')}`);
            assert.equal(lang!.type, 'language_array');
        });

        // ── The case that failed in production ─────────────────────────────
        const email1 = 'languages-objects@example.com';
        const res1 = await apply(
            PUB,
            buildBrowserBody(
                fields,
                typedValues(email1, [
                    { name: 'Arabic', level: 'native' },
                    { name: 'English', level: 'intermediate' },
                ]),
            ),
        );
        const json1 = (await res1.json().catch(() => ({}))) as Json;

        await test('a new applicant who added languages is accepted (was 500)', () => {
            assert.equal(res1.status, 201, `status ${res1.status}: ${JSON.stringify(json1)}`);
            assert.equal(json1.success, true);
        });
        const person1 = await personByEmail(email1);
        const app1 = await CandidateApplication.findOne({
            organizationId: ORG,
            campaignId: CAMPAIGN_ID,
            candidateId: person1?._id,
        }).lean();
        await test('the person stores each language as "Name (level)"', () => {
            assert.deepEqual(person1?.languages, ['Arabic (native)', 'English (intermediate)']);
        });
        await test('the application stores the same languages', () => {
            assert.deepEqual(app1?.languages, ['Arabic (native)', 'English (intermediate)']);
        });
        await waitForN8n(1);
        await test('Stage 1 receives the languages (and the other typed fields)', () => {
            assert.equal(sentToN8n.length, 1, `n8n requests: ${sentToN8n.length}`);
            const b = sentToN8n[0].body;
            assert.deepEqual(n8nLanguages(b), ['Arabic (native)', 'English (intermediate)']);
            assert.equal(b.years_of_experience, '2');
            assert.equal(b.salaryCurrency, 'IQD');
        });

        // ── The exact body a real browser sent ─────────────────────────────
        const res4 = await apply(PUB, capturedBrowserBody());
        const json4 = (await res4.json().catch(() => ({}))) as Json;
        await test('the verbatim body a real browser sent is accepted and its languages stored', async () => {
            assert.equal(res4.status, 201, `status ${res4.status}: ${JSON.stringify(json4)}`);
            const p = await personByEmail(BROWSER_CAPTURE.email);
            assert.deepEqual(p?.languages, ['English (intermediate)', 'Arabic (native)']);
        });

        // ── An applicant who added no language must stay unaffected ────────
        const email2 = 'languages-none@example.com';
        const res2 = await apply(PUB, buildBrowserBody(fields, typedValues(email2, [])));
        await test('an applicant with no language is still accepted', async () => {
            assert.equal(res2.status, 201, `status ${res2.status}: ${JSON.stringify(await res2.json().catch(() => ({})))}`);
            const p = await personByEmail(email2);
            assert.deepEqual(p?.languages, []);
        });

        // ── Plain strings (an older client, or the legacy form) pass through
        const email3 = 'languages-strings@example.com';
        const res3 = await apply(PUB, buildBrowserBody(fields, typedValues(email3, ['Arabic', 'English (advanced)'])));
        await test('languages sent as plain strings are stored unchanged', async () => {
            assert.equal(res3.status, 201, `status ${res3.status}`);
            const p = await personByEmail(email3);
            assert.deepEqual(p?.languages, ['Arabic', 'English (advanced)']);
        });

        // ── A returning applicant with languages is not turned away ────────
        // Only the status is asserted: which languages a returning applicant's
        // new application should carry is a separate, deferred decision (S25) —
        // today the public route does not store a returning applicant's new
        // answers at all, and this test must not pin that down as correct.
        const res5 = await apply(
            PUB_2,
            buildBrowserBody(fields, typedValues(email1, [{ name: 'Kurdish', level: 'advanced' }])),
        );
        await test('a returning applicant who added languages is accepted', async () => {
            assert.equal(res5.status, 201, `status ${res5.status}: ${JSON.stringify(await res5.json().catch(() => ({})))}`);
        });

        // Every dispatch is fire-and-forget; let each one finish (and mark its
        // row) before the database closes under it.
        const applications = await CandidateApplication.countDocuments({ organizationId: ORG });
        for (let i = 0; i < 100; i += 1) {
            if ((await Stage1EvaluationOutbox.countDocuments({ status: 'delivered' })) >= applications) break;
            await new Promise((r) => setTimeout(r, 50));
        }
        await test('one Stage 1 request per application, each row delivered', async () => {
            assert.equal(applications, 5, `applications: ${applications}`);
            assert.equal(sentToN8n.length, applications, `n8n requests: ${sentToN8n.length}`);
            assert.equal(await Stage1EvaluationOutbox.countDocuments({}), applications);
            assert.equal(await Stage1EvaluationOutbox.countDocuments({ status: 'delivered' }), applications);
        });

        // ── The converter, the same one the logged-in route uses ───────────
        await test('converter: { name, level } → "name (level)", name alone → name', () => {
            assert.deepEqual(
                normalizeLanguagesToStringArray([{ name: 'Arabic', level: 'native' }, { name: 'Kurdish' }]),
                ['Arabic (native)', 'Kurdish'],
            );
        });
        await test('converter: trims, drops empties, de-duplicates case-insensitively', () => {
            assert.deepEqual(
                normalizeLanguagesToStringArray([' Arabic ', '', { name: '', level: '' }, 'arabic', { name: 'English', level: 'good' }]),
                ['Arabic', 'English (good)'],
            );
        });
        await test('converter: not an array → []', () => {
            assert.deepEqual(normalizeLanguagesToStringArray('Arabic'), []);
            assert.deepEqual(normalizeLanguagesToStringArray(undefined), []);
        });
        await test('merge: converts every language_array field and is idempotent', () => {
            const snapshot = {
                fields: [
                    { id: 'languages', type: 'language_array' },
                    { id: 'skills', type: 'string_array' },
                ],
            } as any;
            const once = mergeValidatedIntoCandidateData(
                { languages: [{ name: 'Arabic', level: 'native' }], skills: ['Recruitment'] },
                snapshot,
            );
            assert.deepEqual(once.languages, ['Arabic (native)']);
            assert.deepEqual(once.skills, ['Recruitment']);
            const twice = mergeValidatedIntoCandidateData(once, snapshot);
            assert.deepEqual(twice.languages, ['Arabic (native)']);
        });
    } finally {
        globalThis.fetch = realFetch;
        if (server) await new Promise((r) => server!.close(r));
        await mongoose.disconnect();
        if (mongo) await mongo.stop();
        process.chdir(startDir);
        fs.rmSync(workDir, { recursive: true, force: true });
    }

    console.log(`\n[public-apply-languages] ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
