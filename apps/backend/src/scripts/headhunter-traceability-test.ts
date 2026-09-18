/**
 * Which Head Hunter invitation produced an application — and on WHICH record.
 *
 * 🔴 It was nowhere. Measured on production 2026-09-18: **zero** documents in
 * the entire database carried `headHunterContextId`, on `candidates` or on
 * `candidate_applications`. Every head-hunted candidate was untraceable back to
 * the search that found them, and `source` was never marked 'HeadHunter'.
 *
 * The cause was one dead line: the application was built with
 * `headHunterContextId: candidate.headHunterContextId`, reading it from the
 * PERSON. The person never has one — the update whitelist does not carry it,
 * and a returning applicant is not re-created — so the field resolved to
 * undefined on every path, forever, in silence.
 *
 * ⚠️ WHERE IT BELONGS, and why not on the person. A Candidate is a human being
 * and may be sourced through several campaigns and several Head Hunter contexts
 * over time. One field on the person means the newest application erases where
 * the previous one came from. The relation is per-application:
 *
 *     CandidateApplication → RecruitmentCampaign + HeadHunterSourcingContext
 *
 * `Candidate.headHunterContextId` stays in the model (removing it is a wider
 * change than this needs) but this path no longer writes it.
 *
 * Runs on an in-memory mongo; no external database.
 *
 * Run: npm run test:headhunter-traceability
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import CandidateApplication from '../models/CandidateApplication.js';
import { upsertCandidateApplication } from '../services/candidateApplicationService.js';
import { assertSourcingContextMatchesCampaign } from '../services/headHunterShareBinding.js';

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

const ORG = 'org_3IsSoVuqhLik0yCzkhedGHq24ak';
const OTHER_ORG = 'org_3GmTSWnWuk2G02PcWG3fs4IVb5j';
const CAMPAIGN_A = 'aaa8e33668c6c52c43975448807c11c1';
const CAMPAIGN_B = '350b2b126342a274af0526a3e409271c';
const CTX_A = 'f31f56a81eb4fa49c85f5e1c';
const CTX_B = '330253cebb727ec15138a02d';

/** A person, exactly as the route hands one over: WITHOUT a context id. */
function person(overrides: Record<string, unknown> = {}) {
    return {
        _id: new mongoose.Types.ObjectId(),
        organizationId: ORG,
        full_name: 'Test Person',
        email: 'test.person@example.com',
        phone: '+9647000000000',
        position_applied_for: 'HR Generalist',
        years_of_experience: '5',
        agreeToTerms: true,
        entryStage: 'video',
        status: 'pending',
        // deliberately absent: headHunterContextId
        ...overrides,
    } as any;
}

async function main(): Promise<void> {
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    console.log('[headhunter-traceability] in-memory mongo up\n');

    await test('🔴 the invitation lands on the APPLICATION', async () => {
        const app = await upsertCandidateApplication({
            organizationId: ORG,
            candidate: person(),
            campaignId: CAMPAIGN_A,
            headHunterContextId: CTX_A,
        } as any);
        const saved = await CandidateApplication.findById((app as any)._id).lean();
        assert.equal(
            (saved as any).headHunterContextId,
            CTX_A,
            'the application cannot say which invitation produced it'
        );
    });

    await test('…and it records the campaign alongside it — both halves of the relation', async () => {
        const saved = await CandidateApplication.findOne({ campaignId: CAMPAIGN_A }).lean();
        assert.equal((saved as any).campaignId, CAMPAIGN_A);
        assert.equal((saved as any).organizationId, ORG);
        assert.equal((saved as any).headHunterContextId, CTX_A);
    });

    await test('🔴 the person is NOT where it is read from', async () => {
        /*
         * The exact shape of the original defect: a person carrying a context
         * must not be able to supply one for an application that came through
         * no invitation at all. The service's fallback to the person is legacy;
         * an explicit value must win, and no value must stay empty.
         */
        const app = await upsertCandidateApplication({
            organizationId: ORG,
            candidate: person({ headHunterContextId: CTX_B }),
            campaignId: CAMPAIGN_B,
            headHunterContextId: CTX_A,
        } as any);
        const saved = await CandidateApplication.findById((app as any)._id).lean();
        assert.equal(
            (saved as any).headHunterContextId,
            CTX_A,
            "the person's stale context overrode the invitation this application arrived through"
        );
    });

    await test('one person, two campaigns, two DIFFERENT invitations — both survive', async () => {
        // The reason this does not belong on the person: a single field there
        // would leave only the newest.
        const p = person({ email: 'multi@example.com' });
        await upsertCandidateApplication({
            organizationId: ORG,
            candidate: p,
            campaignId: 'camp-multi-1',
            headHunterContextId: CTX_A,
        } as any);
        await upsertCandidateApplication({
            organizationId: ORG,
            candidate: p,
            campaignId: 'camp-multi-2',
            headHunterContextId: CTX_B,
        } as any);
        const one = await CandidateApplication.findOne({ campaignId: 'camp-multi-1' }).lean();
        const two = await CandidateApplication.findOne({ campaignId: 'camp-multi-2' }).lean();
        assert.equal((one as any).headHunterContextId, CTX_A);
        assert.equal((two as any).headHunterContextId, CTX_B);
    });

    await test('an application with no invitation stores none — not an empty string', async () => {
        const app = await upsertCandidateApplication({
            organizationId: ORG,
            candidate: person({ email: 'direct@example.com' }),
            campaignId: 'camp-direct',
        } as any);
        const saved = await CandidateApplication.findById((app as any)._id).lean();
        assert.ok(
            !(saved as any).headHunterContextId,
            'a direct application was tagged with an invitation it never had'
        );
    });

    /* ─────────── the cross-check still refuses, unchanged by this ─────────── */

    await test('🔴 a mismatched organization is still refused', () => {
        const v = assertSourcingContextMatchesCampaign({
            contextOrgId: OTHER_ORG,
            contextCampaignId: CAMPAIGN_A,
            campaignOrgId: ORG,
            campaignId: CAMPAIGN_A,
        });
        assert.equal(v.ok, false);
        assert.equal(v.code, 'HEADHUNTER_CONTEXT_ORG_MISMATCH');
    });

    await test('🔴 a mismatched campaign is still refused', () => {
        const v = assertSourcingContextMatchesCampaign({
            contextOrgId: ORG,
            contextCampaignId: CAMPAIGN_B,
            campaignOrgId: ORG,
            campaignId: CAMPAIGN_A,
        });
        assert.equal(v.ok, false);
        assert.equal(v.code, 'HEADHUNTER_CONTEXT_CAMPAIGN_MISMATCH');
    });

    await test('a matching pair passes, so traceability is reachable at all', () => {
        const v = assertSourcingContextMatchesCampaign({
            contextOrgId: ORG,
            contextCampaignId: CAMPAIGN_A,
            campaignOrgId: ORG,
            campaignId: CAMPAIGN_A,
        });
        assert.equal(v.ok, true);
    });

    await mongoose.disconnect();
    await mongo.stop();

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
