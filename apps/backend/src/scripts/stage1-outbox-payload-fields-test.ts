// ============================================
// scripts/stage1-outbox-payload-fields-test.ts
// S0: what the applicant typed must reach the Stage 1 evaluator.
//
// From 2026-09-06 (37cbe34) until this test, every Stage 1 dispatch sent the
// evaluator EMPTY skills, languages, experience, education, company,
// certifications, salary, availability and cover letter — and `USD` as the
// currency whatever the applicant chose. The application was stored correctly
// and the recruiter's board showed it correctly; only the evaluator was starved.
// Cause: the outbox handed a HYDRATED Mongoose document to a row builder that
// spreads it, and `{ ...hydratedDoc }` copies no fields. Re-confirmed live on
// 2026-09-26 (n8n execution 1982): the form sent years 3, five skills, two
// languages, a cover letter and IQD; n8n received "", [], and USD.
//
// This is a LIFECYCLE test: a real application document in a real (in-memory)
// database, the real outbox flush, the real payload builder, and the request
// the backend would send captured at `fetch`. Testing the row builder alone
// with a plain object would pass against the bug — every other caller already
// passes `.lean()` objects, which is exactly why this survived.
//
// Run: npm run test:stage1-outbox-payload-fields
// Uses mongodb-memory-server — no external database, nothing leaves the machine.
// ============================================

// The payload module loads the real .env on import. dotenv never overrides a
// variable that is already set, so everything that matters is pinned FIRST.
process.env.N8N_WEBHOOK_URL = 'https://n8n.test.local/webhook/s0-payload';
process.env.BILLING_ENFORCE = 'false';
process.env.STAGE_CALLBACK_SECURITY_MODE = 'optional';
process.env.N8N_STAGE_INBOUND_SECRET = '';
process.env.STAGE_CALLBACK_SIGNING_SECRET = '';
process.env.APPLICATION_OWNS_CAMPAIGN_STATE = 'true';

import assert from 'node:assert/strict';
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

const CAMPAIGN_ID = 'camp-s0-payload-001';
const ORG = 'org_s0_payload_test';
// What the applicant typed on the form — synthetic.
const TYPED = {
    years_of_experience: '3',
    highest_education_level: "Bachelor's",
    current_company: 'Rafidain Trading Co.',
    company_applied_to: 'Synthetic Employer',
    certifications: 'SHRM-CP',
    expectedSalary: '1500000',
    // USD on purpose: the default became IQD (2026-09-26), so a chosen IQD would
    // arrive even with the bug back. Only a non-default choice proves the field
    // travelled.
    salaryCurrency: 'USD',
    availability: 'immediate',
    coverLetter: 'I have three years of recruitment and onboarding work in Baghdad.',
    hearAboutUs: 'LinkedIn',
    skills: ['Recruitment', 'Payroll', 'SAP SuccessFactors'],
    languages: ['Arabic', 'English'],
};

async function main(): Promise<void> {
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    console.log('[s0-payload] in-memory mongo up\n');

    const Candidate = (await import('../models/Candidate.js')).default;
    const CandidateApplication = (await import('../models/CandidateApplication.js')).default;
    const RecruitmentCampaign = (await import('../models/RecruitmentCampaign.js')).default;
    const Stage1EvaluationOutbox = (await import('../models/Stage1EvaluationOutbox.js')).default;
    const { flushStage1EvaluationOutboxEntry } = await import('../services/stage1EvaluationOutboxService.js');

    // Raw insert: the payload reads the campaign with `.lean()`, and the
    // campaign schema's own requirements are not what this test is about.
    await RecruitmentCampaign.collection.insertOne({
        campaignId: CAMPAIGN_ID,
        organizationId: ORG,
        status: 'active',
        criteria: { position: 'HR Specialist', skills: 'Recruitment', experienceYears: '2-3', evaluationLanguage: 'ar' },
        createdAt: new Date(),
        updatedAt: new Date(),
    });

    // The person carries a STALE value on purpose: under application-owned state
    // only identity may come from the person, never an application field.
    const person = await Candidate.create({
        organizationId: ORG,
        full_name: 'Synthetic Applicant',
        email: 's0-applicant@example.com',
        phone: '07800000001',
        location: 'Baghdad',
        position_applied_for: 'Some Older Job',
        years_of_experience: '10',
    });
    await CandidateApplication.create({
        organizationId: ORG,
        candidateId: person._id,
        campaignId: CAMPAIGN_ID,
        applicationId: 'APP-S0-PAYLOAD-001',
        emailDenorm: person.email,
        position_applied_for: 'HR Specialist',
        ...TYPED,
    });
    const row = await Stage1EvaluationOutbox.create({
        candidateId: String(person._id),
        campaignId: CAMPAIGN_ID,
        organizationId: ORG,
        rubricSnapshotHash: 'test',
        idempotencyKey: 'stage1-evaluation:s0-payload-test',
        status: 'pending',
        attempts: 0,
    });

    // Capture what the backend would send to n8n. No CV file, so it is JSON.
    const sent: Array<{ url: string; body: Json }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith('https://n8n.test.local/')) {
            sent.push({ url, body: JSON.parse(String(init?.body || '{}')) });
            return new Response('{"ok":true}', { status: 200 });
        }
        throw new Error(`unexpected network call in test: ${url}`);
    }) as typeof fetch;

    let delivered = false;
    try {
        delivered = await flushStage1EvaluationOutboxEntry(String(row._id));
    } finally {
        globalThis.fetch = realFetch;
    }
    const p = sent[0]?.body || {};

    await test('the outbox dispatched exactly one Stage 1 request', () => {
        assert.equal(sent.length, 1);
        assert.equal(delivered, true);
    });
    await test('it describes the right application (campaign, job applied for)', () => {
        assert.equal(p.campaignId, CAMPAIGN_ID);
        assert.equal(p.applicationId, 'APP-S0-PAYLOAD-001');
        assert.equal(p.position_applied_for, 'HR Specialist');
    });
    // THE S0 CHECKS — each of these was empty in production for three weeks.
    for (const key of ['years_of_experience', 'highest_education_level', 'current_company', 'company_applied_to',
        'certifications', 'expectedSalary', 'availability', 'coverLetter', 'hearAboutUs'] as const) {
        await test(`typed ${key} reaches the evaluator`, () => assert.equal(p[key], TYPED[key]));
    }
    await test('typed skills reach the evaluator', () => assert.deepEqual(p.skills, TYPED.skills));
    await test('typed languages reach the evaluator', () => assert.deepEqual(p.languages, TYPED.languages));
    await test('the chosen currency is sent, not the IQD default', () => assert.equal(p.salaryCurrency, 'USD'));
    await test('the submitted-fields manifest lists what was typed', () => {
        const ids: string[] = p.submittedApplication?.submittedFieldIds || [];
        for (const k of ['skills', 'years_of_experience', 'coverLetter', 'expectedSalary', 'availability']) {
            assert.ok(ids.includes(k), `submittedFieldIds lacks ${k}: ${JSON.stringify(ids)}`);
        }
    });
    await test('identity still comes from the person', () => {
        assert.equal(p.full_name, 'Synthetic Applicant');
        assert.equal(p.email, 's0-applicant@example.com');
        assert.equal(p.phone, '07800000001');
    });
    await test("the person's stale application field never leaks (application value wins)", () => {
        assert.notEqual(p.years_of_experience, '10');
    });
    await test('the outbox row is marked delivered', async () => {
        const after = await Stage1EvaluationOutbox.findById(row._id).lean();
        assert.equal(after?.status, 'delivered');
    });

    await mongoose.disconnect();
    await mongo.stop();
    console.log(`\n[stage1-outbox-payload-fields] ${pass} passed, ${fail} failed`);
    if (fail) process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
