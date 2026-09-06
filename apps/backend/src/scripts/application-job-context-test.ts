// ============================================
// scripts/application-job-context-test.ts
// Proves the guarantee behind Phase 1-A: an interview asks about the job the
// APPLICATION was filed for, never the one the person happens to carry.
//
// The bug this locks down is not hypothetical. A founder applied to a second
// campaign with the same email and the voice agent interviewed them about
// "Compensation and Benefits Specialist" — the role from three weeks earlier —
// because Candidate.position_applied_for is written once and never updated.
// Measured over every record: 0 of 85 single-application people affected,
// 5 of 8 returning applicants affected. It cannot be reproduced with a fresh
// email, which is why it survived testing for so long.
//
// Run: npx tsx src/scripts/application-job-context-test.ts
// Uses mongodb-memory-server — no external database.
// ============================================

import assert from 'node:assert';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import Candidate from '../models/Candidate.js';
import CandidateApplication from '../models/CandidateApplication.js';
import { resolveApplicationJobContext } from '../services/applicationJobContext.js';
import { upsertCandidateApplication } from '../services/candidateApplicationService.js';
import { isVoiceLinkConsumedById, markVoiceLinkConsumed } from '../services/interviewLinkAccess.js';
import { DEFAULT_ORG_ID } from '../config/multiTenant.js';

const OLD_JOB = 'Compensation and Benefits Specialist';
const NEW_JOB = 'HR Assistant';
const CAMPAIGN_OLD = 'camp-old-001';
const CAMPAIGN_NEW = 'camp-new-002';

let pass = 0;
let fail = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try {
        await fn();
        console.log('  ✓', name);
        pass += 1;
    } catch (err) {
        console.error('  ✗', name, '\n     ', (err as Error).message);
        fail += 1;
    }
}

function withFlag<T>(on: boolean, fn: () => Promise<T>): Promise<T> {
    const previous = process.env.APPLICATION_OWNS_CAMPAIGN_STATE;
    process.env.APPLICATION_OWNS_CAMPAIGN_STATE = on ? 'true' : 'false';
    return fn().finally(() => {
        if (previous === undefined) delete process.env.APPLICATION_OWNS_CAMPAIGN_STATE;
        else process.env.APPLICATION_OWNS_CAMPAIGN_STATE = previous;
    });
}

async function main(): Promise<void> {
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    console.log('[job-context] in-memory mongo up — running tests\n');

    // The returning applicant, exactly as production had them: the person still
    // carries the FIRST job, and each application carries its own.
    const person = await Candidate.create({
        full_name: 'Returning Applicant',
        email: 'returning@example.com',
        phone: '07800000000',
        position_applied_for: OLD_JOB, // stale by design — never updated after the first apply
        years_of_experience: '3-5 years',
    });

    const appOld = await CandidateApplication.create({
        candidateId: person._id,
        applicationId: 'APP-OLD-001',
        emailDenorm: person.email,
        campaignId: CAMPAIGN_OLD,
        position_applied_for: OLD_JOB,
    });
    const appNew = await CandidateApplication.create({
        candidateId: person._id,
        applicationId: 'APP-NEW-002',
        emailDenorm: person.email,
        campaignId: CAMPAIGN_NEW,
        position_applied_for: NEW_JOB,
        company_applied_to: 'Evaalo',
    });

    await test('flag off → null, so every caller keeps its existing behaviour', async () => {
        const ctx = await withFlag(false, () =>
            resolveApplicationJobContext({ candidateId: String(person._id), campaignId: CAMPAIGN_NEW })
        );
        assert.strictEqual(ctx, null);
    });

    await test('the interview asks about the campaign it was opened from', async () => {
        const ctx = await withFlag(true, () =>
            resolveApplicationJobContext({ candidateId: String(person._id), campaignId: CAMPAIGN_NEW })
        );
        assert.strictEqual(ctx?.position_applied_for, NEW_JOB);
        assert.strictEqual(ctx?.company_applied_to, 'Evaalo');
        assert.strictEqual(ctx?.campaignId, CAMPAIGN_NEW);
    });

    await test('the person\'s stale job never leaks through — this is the reported bug', async () => {
        const ctx = await withFlag(true, () =>
            resolveApplicationJobContext({ candidateId: String(person._id), campaignId: CAMPAIGN_NEW })
        );
        assert.notStrictEqual(ctx?.position_applied_for, OLD_JOB);
    });

    await test('the earlier campaign still reads as itself — no over-correction', async () => {
        const ctx = await withFlag(true, () =>
            resolveApplicationJobContext({ candidateId: String(person._id), campaignId: CAMPAIGN_OLD })
        );
        assert.strictEqual(ctx?.position_applied_for, OLD_JOB);
    });

    await test('applicationId alone is enough — the video link carries it', async () => {
        const byPublic = await withFlag(true, () =>
            resolveApplicationJobContext({ applicationId: appNew.applicationId })
        );
        assert.strictEqual(byPublic?.position_applied_for, NEW_JOB);
        const byMongoId = await withFlag(true, () =>
            resolveApplicationJobContext({ applicationId: String(appNew._id) })
        );
        assert.strictEqual(byMongoId?.position_applied_for, NEW_JOB);
    });

    await test('an application with no job of its own falls back to its own snapshot', async () => {
        const snapshotOnly = await CandidateApplication.create({
            candidateId: person._id,
            applicationId: 'APP-SNAP-003',
            emailDenorm: person.email,
            campaignId: 'camp-snapshot-003',
            applicationSnapshot: { position_applied_for: 'Recruiter' },
        });
        const ctx = await withFlag(true, () =>
            resolveApplicationJobContext({ applicationId: snapshotOnly.applicationId })
        );
        assert.strictEqual(ctx?.position_applied_for, 'Recruiter');
    });

    await test('unresolvable → empty, not the person: failure is visible, never silently wrong', async () => {
        // A returning applicant with no campaign to disambiguate is exactly the
        // case that used to answer with the wrong job.
        const ctx = await withFlag(true, () =>
            resolveApplicationJobContext({ candidateId: String(person._id) })
        );
        assert.ok(ctx, 'flag on must always return a context, never null');
        assert.strictEqual(ctx?.position_applied_for, undefined);
        const missing = await withFlag(true, () =>
            resolveApplicationJobContext({ applicationId: 'APP-DOES-NOT-EXIST' })
        );
        assert.strictEqual(missing?.position_applied_for, undefined);
    });

    await test('a single-application person is unaffected — the healthy case stays healthy', async () => {
        const solo = await Candidate.create({
            full_name: 'First Timer',
            email: 'first@example.com',
            phone: '07811111111',
            position_applied_for: 'Data Analyst',
            years_of_experience: '1-3 years',
        });
        await CandidateApplication.create({
            candidateId: solo._id,
            applicationId: 'APP-SOLO-004',
            emailDenorm: solo.email,
            campaignId: 'camp-solo-004',
            position_applied_for: 'Data Analyst',
        });
        const withCampaign = await withFlag(true, () =>
            resolveApplicationJobContext({ candidateId: String(solo._id), campaignId: 'camp-solo-004' })
        );
        assert.strictEqual(withCampaign?.position_applied_for, 'Data Analyst');
        // and even with nothing to disambiguate, one application is unambiguous
        const withoutCampaign = await withFlag(true, () =>
            resolveApplicationJobContext({ candidateId: String(solo._id) })
        );
        assert.strictEqual(withoutCampaign?.position_applied_for, 'Data Analyst');
    });

    await test('a deleted application is not a source of truth', async () => {
        await CandidateApplication.updateOne({ _id: appOld._id }, { $set: { deletedAt: new Date() } });
        const ctx = await withFlag(true, () =>
            resolveApplicationJobContext({ applicationId: appOld.applicationId })
        );
        assert.strictEqual(ctx?.position_applied_for, undefined);
        await CandidateApplication.updateOne({ _id: appOld._id }, { $set: { deletedAt: null } });
    });

    // ── The interview link ──────────────────────────────────────────────
    // Reported from production: a new campaign, the same details, and the page
    // answered "interview complete". The new application had been created
    // carrying a consumption stamp OLDER than itself — copied off the person.

    const linkPerson = await Candidate.create({
        full_name: 'Link Reuser',
        email: 'link@example.com',
        phone: '07822222222',
        position_applied_for: 'HR Assistant',
        years_of_experience: '3-5 years',
        voiceInterviewLinkConsumedAt: new Date('2026-09-01T10:00:00Z'),
        videoInterviewLinkConsumedAt: new Date('2026-09-01T10:00:00Z'),
    });

    async function newApplicationFor(campaignId: string) {
        return upsertCandidateApplication({
            organizationId: DEFAULT_ORG_ID,
            campaignId,
            candidate: linkPerson as never,
        } as never);
    }

    await test('a new campaign\'s application starts unused — the reported bug', async () => {
        const app = await withFlag(true, () => newApplicationFor('camp-link-new'));
        assert.strictEqual(
            app.voiceInterviewLinkConsumedAt ?? null,
            null,
            'the voice link was spent in another campaign, not this one'
        );
        assert.strictEqual(app.videoInterviewLinkConsumedAt ?? null, null);
        assert.ok(
            !app.voiceInterviewLinkConsumedAt || app.voiceInterviewLinkConsumedAt >= app.createdAt,
            'a stamp older than the application it sits on can only be inherited'
        );
    });

    await test('and the candidate is let in: not consumed for the new campaign', async () => {
        const blocked = await withFlag(true, () =>
            isVoiceLinkConsumedById(String(linkPerson._id), { campaignId: 'camp-link-new' })
        );
        assert.strictEqual(blocked, false);
    });

    await test('flag off → the old copy-from-person behaviour still works, so rollback is whole', async () => {
        const app = await withFlag(false, () => newApplicationFor('camp-link-legacy'));
        assert.ok(app.voiceInterviewLinkConsumedAt, 'legacy path still seeds from the person');
    });

    await test('spending one campaign\'s link does not stamp the person', async () => {
        const before = await Candidate.findById(linkPerson._id).lean();
        const personStampBefore = before?.voiceInterviewLinkConsumedAt ?? null;
        await withFlag(true, () =>
            markVoiceLinkConsumed(String(linkPerson._id), 'sess-1', { campaignId: 'camp-link-new' })
        );
        const spent = await CandidateApplication.findOne({ campaignId: 'camp-link-new' }).lean();
        assert.ok(spent?.voiceInterviewLinkConsumedAt, 'this campaign\'s link is now spent');
        const after = await Candidate.findById(linkPerson._id).lean();
        assert.deepStrictEqual(
            after?.voiceInterviewLinkConsumedAt ?? null,
            personStampBefore,
            'the person must not collect a stamp that would burn every later campaign'
        );
    });

    await test('a third campaign is still open after the second was spent', async () => {
        const third = await withFlag(true, () => newApplicationFor('camp-link-third'));
        assert.strictEqual(third.voiceInterviewLinkConsumedAt ?? null, null);
        const blocked = await withFlag(true, () =>
            isVoiceLinkConsumedById(String(linkPerson._id), { campaignId: 'camp-link-third' })
        );
        assert.strictEqual(blocked, false);
    });

    await test('the spent campaign stays spent — single use still holds where it should', async () => {
        const blocked = await withFlag(true, () =>
            isVoiceLinkConsumedById(String(linkPerson._id), { campaignId: 'camp-link-new' })
        );
        assert.strictEqual(blocked, true);
    });

    await test('an audio link files an audio application, whatever the person says', async () => {
        // Reported: public voice/video interviews by a returning applicant
        // turned up in the Stage 1 list with no evaluation. The person's
        // entryStage is written once and never updated, and the application
        // was taking it — so a voice interview filed itself as 'screening'.
        const screener = await Candidate.create({
            full_name: 'Stage Router',
            email: 'stage@example.com',
            phone: '07833333333',
            position_applied_for: 'HR Assistant',
            years_of_experience: '3-5 years',
            entryStage: 'screening',
        });
        const voice = await upsertCandidateApplication({
            organizationId: DEFAULT_ORG_ID,
            campaignId: 'camp-voice-entry',
            entryStage: 'audio',
            candidate: screener as never,
        } as never);
        assert.strictEqual(voice.entryStage, 'audio', 'the link decides the stage');
        assert.strictEqual(
            (await Candidate.findById(screener._id).lean())?.entryStage,
            'screening',
            'and the person keeps its own, untouched'
        );
        // Without an explicit stage the person is still the fallback, which is
        // what the screening form relies on.
        const inherited = await upsertCandidateApplication({
            organizationId: DEFAULT_ORG_ID,
            campaignId: 'camp-inherit-entry',
            candidate: screener as never,
        } as never);
        assert.strictEqual(inherited.entryStage, 'screening');
    });

    console.log(`\n[job-context] ${pass} passed, ${fail} failed`);
    await mongoose.disconnect();
    await mongo.stop();
    process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error('[job-context] fatal:', err);
    process.exit(1);
});
