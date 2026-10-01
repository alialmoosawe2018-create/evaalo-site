// ============================================
// scripts/campaign-job-description-route-test.ts
// «Job description & requirements» through the real routes.
//
//  - Creating a job stores the recruiter's description, never inside `criteria` and
//    never as a rubric item (it must not be scored), and the reads return it.
//  - POST /rewrite-description offers a rewrite only if it kept every number of the
//    original and added none; one retry; never more than two model calls; 20 per org
//    per hour; nothing reaches the model for an empty or oversized text.
//  - Ad generation and criteria suggestion are sent the description as its own block.
//
// LIFECYCLE: the real router on an in-memory database, request bodies from the
// frontend's own builder, and the OpenAI SDK pointed at a local fake server that
// records what the model is sent and answers what each test scripts.
// Run: npm run test:campaign-job-description — no external database, no network, no AI call.
// ============================================

process.env.BILLING_ENFORCE = 'false';
process.env.RBAC_ENFORCEMENT = 'off';
process.env.ENFORCE_AUTH = 'off';
// Campaign creation warms the interview blueprint — keep it off the fake model.
process.env.VIDEO_INTERVIEW_USE_BLUEPRINT = 'false';
// A fake key: even if a request escaped the fake server it could not reach a real model.
process.env.OPENAI_API_KEY = 'sk-test-campaign-job-description';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

const FRONTEND_SRC = new URL('../../../frontend/src/', import.meta.url).href;
const { buildScreeningCampaignCreateBody }: any = await import(`${FRONTEND_SRC}utils/screeningCampaignPayload.js`);
const ROUTE_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../routes/recruitmentCampaigns.ts');

type Json = Record<string, any>;
let pass = 0;
let fail = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
    // Each test scripts its own model replies; a failure must not leave any for the next.
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
type Reply = { content: string; finish_reason?: string };
const replies: Reply[] = [];
const sent: Json[] = [];
const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
        sent.push(JSON.parse(body || '{}'));
        const r = replies.shift() || { content: '{}' };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
            JSON.stringify({
                id: 'chatcmpl-fake',
                object: 'chat.completion',
                created: 0,
                model: 'fake',
                choices: [
                    { index: 0, message: { role: 'assistant', content: r.content }, finish_reason: r.finish_reason || 'stop' },
                ],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            })
        );
    });
});
await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1`;

const userMessage = (req: Json): string =>
    (req.messages || []).filter((m: Json) => m.role === 'user').map((m: Json) => String(m.content)).join('\n');

const DESCRIPTION =
    'We need an HR officer for our Baghdad office.\r\nDuties: run recruitment end to end, onboarding.\r\nRequirements: 3-5 years in HR, Arabic and English.  ';
const DESCRIPTION_STORED =
    'We need an HR officer for our Baghdad office.\nDuties: run recruitment end to end, onboarding.\nRequirements: 3-5 years in HR, Arabic and English.';

async function main(): Promise<void> {
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    const express = (await import('express')).default;
    const routes = (await import('../routes/recruitmentCampaigns.js')).default;
    const RecruitmentCampaign = (await import('../models/RecruitmentCampaign.js')).default;
    const AuditLog = (await import('../models/AuditLog.js')).default;

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
        const startProcess = (extra: Json = {}): Json => ({
            position: 'HR Officer',
            experienceYears: '3-5',
            skills: 'Recruitment; Onboarding',
            interviewLanguage: 'en',
            language: 'en',
            ...extra,
        });
        const screeningBody = (jobDescription: string): Json =>
            buildScreeningCampaignCreateBody({
                jobDetails: { position: 'HR Officer', experienceYears: '3-5' },
                selectedCriteria: { position: true, experienceYears: true },
                certificationRows: [''],
                skillRows: [''],
                languageRows: [''],
                aiCompareEmailRows: [''],
                customCriteria: [],
                essentialCriteria: {},
                formTemplateId: 'template-remote',
                jobDescription,
                language: 'en',
                interviewLanguage: 'en',
            });

        console.log('create & read');

        let createdId = '';
        await test('start process: the description is stored (trimmed, \\n line breaks) and is not a criterion', async () => {
            const saved = await create(startProcess({ jobDescription: DESCRIPTION }));
            createdId = saved.campaignId;
            assert.equal(saved.jobDescription, DESCRIPTION_STORED);
            assert.equal('jobDescription' in (saved.criteria || {}), false, 'the description leaked into criteria');
            assert.equal(saved.criteria.skills, 'Recruitment; Onboarding', 'the real criteria are kept');
        });

        await test('AI screening flow — body from the frontend builder — stores it, outside criteria AND the rubric', async () => {
            const body = screeningBody(DESCRIPTION);
            assert.equal(body.jobDescription, DESCRIPTION.trim(), 'the builder sends the description');
            const saved = await create(body);
            assert.equal(saved.jobDescription, DESCRIPTION_STORED);
            assert.equal('jobDescription' in (saved.criteria || {}), false);
            const rubric = JSON.stringify(saved.evaluationRubric || []);
            assert.ok((saved.evaluationRubric || []).length > 0, 'the rubric was built');
            assert.equal(rubric.includes('jobDescription') || rubric.includes('run recruitment end to end'), false, 'the description became a rubric item');
        });

        await test('no description, or a blank one, stores no field', async () => {
            for (const extra of [{}, { jobDescription: '' }, { jobDescription: ' \n ' }]) {
                const saved = await create(startProcess(extra));
                assert.equal(saved.jobDescription, undefined, JSON.stringify(extra));
            }
        });

        await test('a description over 5000 characters, or not text, is refused and nothing is created', async () => {
            const before = await RecruitmentCampaign.countDocuments({});
            const tooLong = await call('POST', '', startProcess({ jobDescription: 'a'.repeat(5001) }));
            assert.equal(tooLong.status, 400);
            assert.equal(tooLong.json.error, 'JOB_DESCRIPTION_TOO_LONG');
            const notText = await call('POST', '', startProcess({ jobDescription: { text: 'x' } }));
            assert.equal(notText.status, 400);
            assert.equal(notText.json.error, 'JOB_DESCRIPTION_NOT_TEXT');
            assert.equal(await RecruitmentCampaign.countDocuments({}), before);
        });

        await test('both campaign reads return the description', async () => {
            const one = await call('GET', `/${createdId}`);
            assert.equal(one.status, 200);
            assert.equal(one.json.data.jobDescription, DESCRIPTION_STORED);
            const batch = await call('GET', `/?ids=${createdId}`);
            assert.equal(batch.status, 200);
            assert.equal(batch.json.data[0].jobDescription, DESCRIPTION_STORED);
        });

        console.log('\nrewrite-description');
        // Every request that passes validation counts against the org's hourly cap.
        let counted = 0;
        const rewrite = async (text: unknown) => {
            const before = sent.length;
            const r = await call('POST', '/rewrite-description', { text });
            if (r.status !== 400) counted += 1;
            return { ...r, calls: sent.slice(before) };
        };

        await test('a pure rewording is offered — one model call, the text sent as data with the rules', async () => {
            const good = 'Role: HR Officer (Baghdad office)\nDuties:\n- Run recruitment end to end\n- Onboarding\nRequirements:\n- 3-5 years in HR\n- Arabic and English';
            replies.push({ content: good });
            const r = await rewrite(DESCRIPTION);
            assert.equal(r.status, 200, JSON.stringify(r.json));
            assert.equal(r.json.text, good);
            assert.equal(r.json.attempts, 1);
            assert.equal(r.calls.length, 1);
            const msg = userMessage(r.calls[0]);
            assert.ok(msg.includes(`<<<\n${DESCRIPTION_STORED}\n>>>`), 'the text is not sent between the data markers');
            assert.ok(msg.includes('Do not add anything it does not contain'), 'the no-additions rule is missing');
            assert.ok(msg.includes('Keep every number exactly as written'), 'the numbers rule is missing');
        });

        await test('Arabic: the same numbers in Arabic-Indic digits are accepted', async () => {
            replies.push({ content: 'المهام: التوظيف\nالمتطلبات: خبرة ٣-٥ سنوات' });
            const r = await rewrite('نحتاج موظف توظيف خبرة 3-5 سنوات');
            assert.equal(r.status, 200, JSON.stringify(r.json));
        });

        await test('a rewrite that adds a number is not offered; the second try is', async () => {
            replies.push({ content: 'Requirements: 3-5 years in HR. Salary: 900,000 IQD.' });
            replies.push({ content: 'Requirements: 3-5 years in HR.' });
            const r = await rewrite('need 3-5 years in HR');
            assert.equal(r.status, 200, JSON.stringify(r.json));
            assert.equal(r.json.text, 'Requirements: 3-5 years in HR.');
            assert.equal(r.json.attempts, 2);
            assert.equal(r.calls.length, 2);
        });

        await test('two rewrites that change the requirement → 422, the text is untouched, never a third call', async () => {
            replies.push({ content: 'Requirements: 5-7 years in HR.' });
            replies.push({ content: 'Requirements: 5 years in HR.' });
            replies.push({ content: 'Requirements: 3-5 years in HR.' }); // must never be asked for
            const r = await rewrite('need 3-5 years in HR');
            assert.equal(r.status, 422);
            assert.equal(r.json.error, 'REWRITE_REJECTED');
            assert.equal(r.json.reason, 'numbers');
            assert.equal('text' in r.json, false, 'a rejected rewrite must not be returned');
            assert.equal(r.calls.length, 2);
            replies.length = 0;
        });

        await test('a rewrite that drops a number is not offered', async () => {
            replies.push({ content: 'Requirements: experience in HR.' });
            replies.push({ content: 'Requirements: experience in HR, team work.' });
            const r = await rewrite('need 3 years in HR');
            assert.equal(r.status, 422);
            assert.equal(r.json.reason, 'numbers');
        });

        await test('a rewrite longer than the box holds is not offered', async () => {
            replies.push({ content: 'x'.repeat(5001) });
            replies.push({ content: 'y'.repeat(5001) });
            const r = await rewrite('HR officer wanted');
            assert.equal(r.status, 422);
            assert.equal(r.json.reason, 'too_long');
        });

        await test('an answer cut off at the token limit is never offered (503)', async () => {
            replies.push({ content: 'Requirements: 3-5 years', finish_reason: 'length' });
            const r = await rewrite('need 3-5 years in HR');
            assert.equal(r.status, 503);
            assert.equal(r.json.error, 'REWRITE_UNAVAILABLE');
            assert.equal(r.calls.length, 1);
        });

        await test('a code fence around the answer is removed', async () => {
            replies.push({ content: '```\nRequirements: 3-5 years in HR.\n```' });
            const r = await rewrite('need 3-5 years in HR');
            assert.equal(r.status, 200);
            assert.equal(r.json.text, 'Requirements: 3-5 years in HR.');
        });

        await test('empty, oversized or non-text input → 400 and the model is never called', async () => {
            for (const [text, code] of [
                ['', 'JOB_DESCRIPTION_EMPTY'],
                ['   ', 'JOB_DESCRIPTION_EMPTY'],
                ['a'.repeat(5001), 'JOB_DESCRIPTION_TOO_LONG'],
                [42, 'JOB_DESCRIPTION_NOT_TEXT'],
                [undefined, 'JOB_DESCRIPTION_EMPTY'],
            ] as Array<[unknown, string]>) {
                const r = await rewrite(text);
                assert.equal(r.status, 400, String(code));
                assert.equal(r.json.error, code);
                assert.equal(r.calls.length, 0, `${code}: the model was called`);
            }
        });

        await test('20 rewrites per organization per hour, then 429 without calling the model', async () => {
            assert.ok(counted < 20, `earlier tests already used ${counted}`);
            while (counted < 20) {
                replies.push({ content: 'HR officer wanted.' });
                const r = await rewrite('HR officer wanted');
                assert.equal(r.status, 200, `request ${counted} was refused early: ${r.status}`);
            }
            replies.length = 0;
            const r = await rewrite('HR officer wanted');
            assert.equal(r.status, 429);
            assert.equal(r.json.error, 'RATE_LIMITED');
            assert.equal(r.calls.length, 0);
        });

        await test('the rewrite route is signed-in only and needs campaign.write (it is free)', () => {
            const src = fs.readFileSync(ROUTE_FILE, 'utf8').replace(/\r\n/g, '\n');
            const decl = src.slice(src.indexOf("'/rewrite-description'"), src.indexOf("'/rewrite-description'") + 140);
            assert.ok(decl.includes('conditionalRequireAuth()'), `no auth on the route: ${decl}`);
            assert.ok(decl.includes("requirePermission('campaign.write')"), `no permission on the route: ${decl}`);
        });

        console.log('\nad generation & criteria suggestion');

        await test('generate-ad: the description is sent as its own block, not as a "- jobDescription:" criteria line', async () => {
            replies.push({ content: 'HR Officer — Baghdad' });
            const before = sent.length;
            const r = await call('POST', '/generate-ad', {
                position: 'HR Officer',
                experienceYears: '3-5',
                jobDescription: DESCRIPTION,
                language: 'English',
            });
            assert.equal(r.status, 200, JSON.stringify(r.json));
            const msg = userMessage(sent[before]);
            assert.ok(msg.includes('Job description & requirements written by the employer'), 'no description block');
            assert.ok(msg.includes(`<<<\n${DESCRIPTION.trim()}\n>>>`) || msg.includes('run recruitment end to end'), 'the description is not in the block');
            assert.equal(/-\s*jobDescription\s*:/.test(msg), false, 'the description leaked in as a criteria line');
            assert.ok(msg.includes('- position: HR Officer'), 'the criteria are still sent');
        });

        await test('generate-ad: a description alone (no criteria) is enough to write an ad', async () => {
            replies.push({ content: 'HR Officer — Baghdad' });
            const before = sent.length;
            const r = await call('POST', '/generate-ad', { jobDescription: DESCRIPTION, language: 'English' });
            assert.equal(r.status, 200, JSON.stringify(r.json));
            assert.equal(sent.length, before + 1);
        });

        await test('generate-ad without a description is unchanged (no description block)', async () => {
            replies.push({ content: 'HR Officer — Baghdad' });
            const before = sent.length;
            const r = await call('POST', '/generate-ad', { position: 'HR Officer', language: 'English' });
            assert.equal(r.status, 200);
            assert.equal(userMessage(sent[before]).includes('Job description & requirements'), false);
        });

        await test('suggest-criteria: the description is sent as the primary context', async () => {
            replies.push({ content: JSON.stringify({ criteria: [{ type: 'custom', label: 'HRIS', expectation: 'Daily use' }] }) });
            const before = sent.length;
            const r = await call('POST', '/suggest-criteria', { position: 'HR Officer', jobDescription: DESCRIPTION, language: 'en' });
            assert.equal(r.status, 200, JSON.stringify(r.json));
            const msg = userMessage(sent[before]);
            assert.ok(msg.includes('Job description & requirements written by the employer'), 'no description block');
            assert.ok(msg.includes('run recruitment end to end'), 'the description is not sent');
        });
    } finally {
        if (server) await new Promise<void>((r) => server!.close(() => r()));
        // Let the audit rows written after each response land before the database goes.
        for (let i = 0; i < 50 && (await AuditLog.countDocuments({ action: 'campaign.created' })) < audits; i += 1) {
            await new Promise((r) => setTimeout(r, 100));
        }
        await new Promise((r) => setTimeout(r, 200));
        await mongoose.disconnect();
        await mongo.stop();
        await new Promise<void>((r) => fake.close(() => r()));
    }
    console.log(`\n[campaign-job-description] ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
