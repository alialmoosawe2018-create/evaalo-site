// ============================================
// scripts/blueprint-style-lifecycle-test.ts
// Proves a campaign keeps ONE interview blueprint across applications.
//
// The bug this locks down (found 2026-10-01, in code and in production logs):
// the stale check reads `styleVersion` from the locked InterviewBlueprint, but
// the stamp was only ever written to the JobExpertiseProfile (a schema with no
// such field, so Mongoose dropped it). Every blueprint therefore read as stale,
// and every application retired the campaign's blueprint and generated a new
// one — candidates of one job were interviewed and scored on different
// instruments, and an applicant who started at once could meet a missing one.
// The old smoke test never touched a database, so it could not see this.
//
// Drives the real ensureBlueprintForCampaign twice, the way campaign creation and
// then an application do. No model is called: OPENAI_API_KEY is emptied before
// any import, so the generator takes its pack/taxonomy fallback.
//
// Run: npx tsx src/scripts/blueprint-style-lifecycle-test.ts
// Uses mongodb-memory-server — no external database.
// ============================================

import assert from 'node:assert';

// Before any app import: dotenv never overrides a key that already exists, so an
// empty key keeps every model call off, and a dead base URL is the second lock.
process.env.OPENAI_API_KEY = '';
process.env.OPENAI_BASE_URL = 'http://127.0.0.1:9/v1';
delete process.env.VIDEO_INTERVIEW_USE_BLUEPRINT;

const CAMPAIGN = 'camp-style-001';

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

async function main(): Promise<void> {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const mongoose = (await import('mongoose')).default;
    const RecruitmentCampaign = (await import('../models/RecruitmentCampaign.js')).default;
    const InterviewBlueprint = (await import('../models/InterviewBlueprint.js')).default;
    const { ensureBlueprintForCampaign } = await import('../services/expertise/ensureBlueprint.js');
    const { BLUEPRINT_STYLE_VERSION } = await import('../services/expertise/blueprintGenerator.js');

    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await InterviewBlueprint.syncIndexes();
    console.log('[blueprint-style] in-memory mongo up — running tests\n');

    await RecruitmentCampaign.create({
        campaignId: CAMPAIGN,
        criteria: { position: 'Recruiter' },
        interviewLanguage: 'ar',
    });

    // Campaign creation generates the first blueprint.
    const first = await ensureBlueprintForCampaign(CAMPAIGN);
    const firstId = first?.blueprint?.blueprintId;

    await test('campaign creation locks a blueprint with competencies', async () => {
        assert.ok(firstId, 'no blueprint was locked');
        assert.ok((first?.blueprint?.competencies?.length ?? 0) > 0, 'locked blueprint has no competencies');
    });

    await test('the locked blueprint is stamped with the current style version — read back from the database', async () => {
        const stored = await InterviewBlueprint.findOne({ blueprintId: firstId }).lean();
        assert.strictEqual(stored?.styleVersion, BLUEPRINT_STYLE_VERSION);
    });

    // An application asks again, exactly as routes/candidates.ts does.
    const second = await ensureBlueprintForCampaign(CAMPAIGN);

    await test('an application keeps the same blueprint — this is the reported bug', async () => {
        assert.strictEqual(second?.blueprint?.blueprintId, firstId);
    });

    await test('no blueprint was retired by the application', async () => {
        const retired = await InterviewBlueprint.countDocuments({ campaignId: CAMPAIGN, status: 'superseded' });
        assert.strictEqual(retired, 0);
    });

    // A third and fourth ask (more applicants) must change nothing either.
    await ensureBlueprintForCampaign(CAMPAIGN);
    await ensureBlueprintForCampaign(CAMPAIGN);

    await test('more applications still leave exactly one blueprint for the campaign', async () => {
        const all = await InterviewBlueprint.countDocuments({ campaignId: CAMPAIGN });
        assert.strictEqual(all, 1);
    });

    // The refresh the version exists for must still work: a blueprint written
    // under OLDER phrasing rules is retired once, and its replacement is stamped.
    await InterviewBlueprint.updateOne(
        { blueprintId: firstId },
        { $set: { styleVersion: 'older-phrasing-rules' } }
    );
    const refreshed = await ensureBlueprintForCampaign(CAMPAIGN);
    const refreshedId = refreshed?.blueprint?.blueprintId;

    await test('a blueprint from older phrasing rules is replaced once', async () => {
        assert.ok(refreshedId && refreshedId !== firstId, 'the old-style blueprint was not replaced');
        const old = await InterviewBlueprint.findOne({ blueprintId: firstId }).lean();
        assert.strictEqual(old?.status, 'superseded');
    });

    await test('the replacement is stamped and survives the next application', async () => {
        const stored = await InterviewBlueprint.findOne({ blueprintId: refreshedId }).lean();
        assert.strictEqual(stored?.styleVersion, BLUEPRINT_STYLE_VERSION);
        const again = await ensureBlueprintForCampaign(CAMPAIGN);
        assert.strictEqual(again?.blueprint?.blueprintId, refreshedId);
    });

    await mongoose.disconnect();
    await mongo.stop();

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
}

main().catch((err) => {
    console.error('[blueprint-style] crashed:', err);
    process.exit(1);
});
