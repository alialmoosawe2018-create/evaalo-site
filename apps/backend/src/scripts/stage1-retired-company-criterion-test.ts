// ============================================
// scripts/stage1-retired-company-criterion-test.ts
// The Stage 1 «Company» criterion is retired (owner, 2026-10-03).
//
// Recruiters read it as "the hiring company": two of the three production jobs
// that used it held the employer's own name, so every applicant was reported
// "missing: no mention of <employer>". It had zero weight, so scores did not move,
// but the report showed a false unmet criterion. Now:
//  - a new job never stores it and never gets it as a rubric item, even when an old
//    browser tab still sends it;
//  - the AI criteria suggestion no longer offers it;
//  - an EXISTING job that holds it stops sending it to the evaluator, in both the
//    criteria list and the rubric. The trap this guards: once `company` stopped being
//    a preset key, the legacy derivation would have turned it into a CUSTOM criterion
//    scored at full weight.
//
// LIFECYCLE: the real router and the real Stage 1 outbox flush on an in-memory
// database; the OpenAI SDK points at a local fake; the n8n request is captured at
// `fetch`. Synthetic data only.
// Run: npm run test:stage1-retired-company-criterion
// ============================================

process.env.BILLING_ENFORCE = 'false';
process.env.RBAC_ENFORCEMENT = 'off';
process.env.ENFORCE_AUTH = 'off';
process.env.VIDEO_INTERVIEW_USE_BLUEPRINT = 'false';
process.env.OPENAI_API_KEY = 'sk-test-retired-company';
process.env.N8N_WEBHOOK_URL = 'https://n8n.test.local/webhook/retired-company';
process.env.STAGE_CALLBACK_SECURITY_MODE = 'optional';
process.env.N8N_STAGE_INBOUND_SECRET = '';
process.env.STAGE_CALLBACK_SIGNING_SECRET = '';
process.env.APPLICATION_OWNS_CAMPAIGN_STATE = 'true';

import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

const FRONTEND_SRC = new URL('../../../frontend/src/', import.meta.url).href;
const { buildScreeningCampaignCreateBody }: any = await import(`${FRONTEND_SRC}utils/screeningCampaignPayload.js`);

type Json = Record<string, any>;
let pass = 0;
let fail = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
    replies.length = 0;
    try {
        await fn();
        console.log('  ✓', name);
        pass += 1;
    } catch (err) {
        console.error('  ✗', name, '\n     ', (err as Error).message);
        fail += 1;
    }
}

// ── Fake model ──────────────────────────────────────────────────────────────
const replies: string[] = [];
const modelRequests: Json[] = [];
const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
        modelRequests.push(JSON.parse(body || '{}'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
            JSON.stringify({
                id: 'chatcmpl-fake',
                object: 'chat.completion',
                created: 0,
                model: 'fake',
                choices: [{ index: 0, message: { role: 'assistant', content: replies.shift() || '{}' }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            })
        );
    });
});
await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1`;

const ORG = 'org_retired_company_test';
const EMPLOYER = 'Synthetic Aluminium Extrusion Co';

/** Anything that would make the evaluator judge a "company" criterion. */
function mentionsCompanyCriterion(items: Json[] | undefined): string | null {
    for (const it of items || []) {
        const key = String(it?.key ?? '').toLowerCase();
        const label = String(it?.label ?? '').toLowerCase();
        if (key === 'company' || label === 'company') return JSON.stringify(it);
        if (String(it?.expectation ?? it?.value ?? '').includes(EMPLOYER)) return JSON.stringify(it);
    }
    return null;
}

async function main(): Promise<void> {
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());

    const sentToN8n: Json[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.startsWith('https://n8n.test.local/')) {
            sentToN8n.push(JSON.parse(String(init?.body || '{}')));
            return new Response('{"ok":true}', { status: 200 });
        }
        return realFetch(input as any, init);
    }) as typeof fetch;

    const express = (await import('express')).default;
    const routes = (await import('../routes/recruitmentCampaigns.js')).default;
    const RecruitmentCampaign = (await import('../models/RecruitmentCampaign.js')).default;
    const Candidate = (await import('../models/Candidate.js')).default;
    const CandidateApplication = (await import('../models/CandidateApplication.js')).default;
    const Stage1EvaluationOutbox = (await import('../models/Stage1EvaluationOutbox.js')).default;
    const AuditLog = (await import('../models/AuditLog.js')).default;
    const { flushStage1EvaluationOutboxEntry } = await import('../services/stage1EvaluationOutboxService.js');
    const { PRESET_RUBRIC_KEYS, RETIRED_CRITERION_KEYS } = await import('../shared/formTemplates/types.js');
    const { deriveLegacyRubricFromCriteria } = await import('../services/evaluationRubricService.js');

    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api/recruitment-campaigns', routes);
    let server: Server | null = null;
    let audits = 0;
    try {
        server = await new Promise<Server>((resolve) => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/recruitment-campaigns`;
        const call = async (method: string, url: string, body?: Json): Promise<{ status: number; json: Json }> => {
            const res = await fetch(`${base}${url}`, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            return { status: res.status, json: (await res.json()) as Json };
        };
        const create = async (body: Json): Promise<Json> => {
            const { status, json } = await call('POST', '', body);
            assert.equal(status, 201, `create failed: ${status} ${JSON.stringify(json).slice(0, 300)}`);
            audits += 1;
            const saved = await RecruitmentCampaign.findOne({ campaignId: json.campaignId }).lean();
            assert.ok(saved, 'campaign not in the database');
            return saved as Json;
        };

        console.log('the key itself');

        await test('company is retired and is no longer a preset criterion', () => {
            assert.equal(RETIRED_CRITERION_KEYS.has('company'), true);
            assert.equal(PRESET_RUBRIC_KEYS.has('company'), false);
        });

        await test('deriving a rubric from criteria holding company yields neither a preset nor a CUSTOM company item', () => {
            const items = deriveLegacyRubricFromCriteria({ position: 'HSE Engineer', skills: 'Risk assessment', company: EMPLOYER });
            assert.equal(mentionsCompanyCriterion(items as Json[]), null, 'company came back as a criterion');
            const keys = (items as Json[]).map((i) => i.key || i.label);
            assert.ok(keys.includes('position') && keys.includes('skills'), `real criteria lost: ${keys}`);
        });

        console.log('new jobs (an old browser tab still sends company)');

        await test('start process: company is not stored on the job', async () => {
            const saved = await create({
                position: 'HSE Engineer',
                experienceYears: '4-5',
                skills: 'Risk assessment',
                company: EMPLOYER,
                interviewLanguage: 'en',
                language: 'en',
            });
            assert.equal('company' in (saved.criteria || {}), false, 'company stored in criteria');
            assert.equal(saved.criteria.skills, 'Risk assessment', 'the real criteria are kept');
        });

        await test('AI screening flow — body from the frontend builder — no company in criteria or the rubric', async () => {
            const body = buildScreeningCampaignCreateBody({
                jobDetails: { position: 'HSE Engineer', experienceYears: '4-5', company: EMPLOYER },
                selectedCriteria: { position: true, experienceYears: true, company: true },
                certificationRows: [''],
                skillRows: [''],
                languageRows: [''],
                aiCompareEmailRows: [''],
                customCriteria: [],
                essentialCriteria: {},
                formTemplateId: 'template-remote',
                language: 'en',
                interviewLanguage: 'en',
            });
            const saved = await create(body);
            assert.equal('company' in (saved.criteria || {}), false, 'company stored in criteria');
            assert.ok((saved.evaluationRubric || []).length > 0, 'the rubric was not built');
            assert.equal(mentionsCompanyCriterion(saved.evaluationRubric), null, 'company stored as a rubric item');
        });

        console.log('AI criteria suggestion');

        await test('company is not offered to the model, and is dropped if the model returns it', async () => {
            replies.push(
                JSON.stringify({
                    criteria: [
                        // With a label: the shape that used to slip through as a CUSTOM suggestion.
                        { type: 'preset', key: 'company', label: 'Company', expectation: EMPLOYER },
                        { type: 'preset', key: 'company', expectation: EMPLOYER },
                        { type: 'preset', key: 'industryType', expectation: 'Manufacturing' },
                    ],
                })
            );
            const before = modelRequests.length;
            const r = await call('POST', '/suggest-criteria', { position: 'HSE Engineer', language: 'en' });
            assert.equal(r.status, 200, JSON.stringify(r.json));
            const prompt = (modelRequests[before]?.messages || []).map((m: Json) => String(m.content)).join('\n');
            assert.ok(prompt.includes('- industryType:'), 'the preset list was not in the prompt');
            assert.equal(/-\s*company\s*:/i.test(prompt), false, 'company still offered to the model');
            const out = JSON.stringify(r.json);
            assert.equal(out.includes(EMPLOYER), false, 'a company suggestion reached the recruiter');
            assert.ok(out.includes('Manufacturing'), 'the other suggestion was lost');
        });

        console.log('existing jobs: what the Stage 1 evaluator receives');

        let n = 0;
        const dispatch = async (job: Json): Promise<Json> => {
            n += 1;
            const campaignId = `camp-retired-company-${n}`;
            await RecruitmentCampaign.collection.insertOne({
                campaignId,
                organizationId: ORG,
                status: 'active',
                createdAt: new Date(),
                updatedAt: new Date(),
                ...job,
            });
            const person = await Candidate.create({
                organizationId: ORG,
                full_name: `Synthetic Applicant ${n}`,
                email: `retired-company-${n}@example.com`,
                phone: `0781111111${n}`,
                location: 'Babil',
                position_applied_for: 'HSE Engineer',
                years_of_experience: '5',
            });
            await CandidateApplication.create({
                organizationId: ORG,
                candidateId: person._id,
                campaignId,
                applicationId: `APP-RC-${n}`,
                emailDenorm: person.email,
                position_applied_for: 'HSE Engineer',
                years_of_experience: '5',
            });
            const row = await Stage1EvaluationOutbox.create({
                candidateId: String(person._id),
                campaignId,
                organizationId: ORG,
                rubricSnapshotHash: 'test',
                idempotencyKey: `stage1-evaluation:retired-company-${n}`,
                status: 'pending',
                attempts: 0,
            });
            const before = sentToN8n.length;
            assert.equal(await flushStage1EvaluationOutboxEntry(String(row._id)), true, 'the outbox did not deliver');
            assert.equal(sentToN8n.length, before + 1, 'not exactly one Stage 1 request');
            return sentToN8n[sentToN8n.length - 1];
        };

        await test('a job holding company in criteria (as two production jobs do): not in the list, not in the rubric', async () => {
            const p = await dispatch({
                criteria: { position: 'HSE Engineer', experienceYears: '4-5', skills: 'Risk assessment', company: EMPLOYER, evaluationLanguage: 'en' },
            });
            assert.equal(mentionsCompanyCriterion(p.criteria), null, 'company in the criteria list');
            assert.equal(mentionsCompanyCriterion(p.evaluationRubric), null, 'company in the rubric');
            assert.equal(JSON.stringify([p.criteria, p.evaluationRubric]).includes(EMPLOYER), false, 'the employer name reached the evaluator');
            const keys = (p.evaluationRubric || []).map((r: Json) => r.key || r.label);
            for (const k of ['position', 'experienceYears', 'skills']) assert.ok(keys.includes(k), `lost ${k}: ${keys}`);
        });

        await test('a job with a STORED rubric that lists company: the item is not sent, the rest are', async () => {
            const item = (id: string, key: string, expectation: string): Json => ({ id, type: 'preset', key, label: key, expectation });
            const p = await dispatch({
                criteria: { position: 'HSE Engineer', company: EMPLOYER, evaluationLanguage: 'en' },
                evaluationRubric: [
                    item('preset__position__aaaa1111', 'position', 'HSE Engineer'),
                    item('preset__company__bbbb2222', 'company', EMPLOYER),
                    item('preset__experienceYears__cccc3333', 'experienceYears', '4-5'),
                ],
            });
            assert.equal(mentionsCompanyCriterion(p.evaluationRubric), null, 'stored company item was sent');
            assert.deepEqual(
                (p.evaluationRubric || []).map((r: Json) => r.key).sort(),
                ['experienceYears', 'position'],
                'the other stored items must be sent unchanged'
            );
        });

        await test('a job without company is unaffected', async () => {
            const p = await dispatch({ criteria: { position: 'HSE Engineer', experienceYears: '4-5', evaluationLanguage: 'en' } });
            const keys = (p.evaluationRubric || []).map((r: Json) => r.key || r.label).sort();
            assert.deepEqual(keys, ['experienceYears', 'position']);
        });
    } finally {
        globalThis.fetch = realFetch;
        if (server) await new Promise<void>((r) => server!.close(() => r()));
        for (let i = 0; i < 50 && (await AuditLog.countDocuments({ action: 'campaign.created' })) < audits; i += 1) {
            await new Promise((r) => setTimeout(r, 100));
        }
        await new Promise((r) => setTimeout(r, 200));
        await mongoose.disconnect();
        await mongo.stop();
        await new Promise<void>((r) => fake.close(() => r()));
    }
    console.log(`\n[stage1-retired-company-criterion] ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
