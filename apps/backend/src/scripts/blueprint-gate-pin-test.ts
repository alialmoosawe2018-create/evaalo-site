/**
 * The blueprint pinned at /start is the HISTORICAL TRUTH of that interview.
 *
 * `/end` used to rebuild the snapshot from the campaign whenever the session
 * carried none — reasoning that generation had certainly finished by then, so it
 * beat losing the evaluation. It does not: generation finishing LATER is exactly
 * the case where the agent never had the competencies, so the candidate was asked
 * one set of questions and graded against another. Measured on four real
 * sessions: coverage 0.22, 0.11, 0 and 0.33, one of them scoring ZERO.
 *
 * What is asserted here is the RULE, at the boundary /end actually uses:
 *   * a session pinned WITH competencies scores against exactly those;
 *   * a session pinned WITHOUT them scores without them, no matter what the
 *     campaign has locked since.
 *
 * Runs on an in-memory mongo; no external database.
 *
 * Run: npm run test:blueprint-gate-pin
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import InterviewBlueprint from '../models/InterviewBlueprint.js';
import VideoInterviewSession from '../models/VideoInterviewSession.js';
import {
    blueprintReadiness,
    buildBlueprintSnapshot,
    getLockedBlueprintForCampaign,
} from '../services/expertise/ensureBlueprint.js';
import { pinnedBlueprintForScoring } from '../services/expertise/pinnedBlueprint.js';

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

/**
 * ⚠️ The FUNCTION /end calls, not a copy of it.
 *
 * The first version of this file reimplemented the rule locally — and every
 * mutation of the route stayed green, because nothing here touched the code that
 * runs. The mutation sweep is what caught it.
 */
const snapshotForScoring = pinnedBlueprintForScoring;

function competency(i: number) {
    return {
        competencyKey: `c${i}`,
        title: `كفاءة ${i}`,
        questionObjective: 'هدف',
        expectedEvidence: ['دليل'],
        redFlags: [],
        followUpRules: [],
        priority: 'high',
    };
}

async function lockBlueprint(campaignId: string, count: number): Promise<void> {
    await InterviewBlueprint.create({
        blueprintId: `bp-${campaignId}`,
        profileId: `prof-${campaignId}`,
        campaignId,
        status: 'locked',
        lockedAt: new Date(),
        language: 'ar',
        anchorQuestions: ['سؤال؟'],
        competencies: Array.from({ length: count }, (_, i) => competency(i)),
    });
}

async function main(): Promise<void> {
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    delete process.env.VIDEO_INTERVIEW_USE_BLUEPRINT;
    console.log('[blueprint-gate-pin] in-memory mongo up — running tests\n');

    const CAMPAIGN = 'camp-pin-001';

    await test('a session that began BLIND scores without competencies…', async () => {
        // The interview ran before anything locked: nothing was pinned.
        await VideoInterviewSession.create({
            sessionId: 'sess-blind',
            candidateId: new mongoose.Types.ObjectId(),
            campaignId: CAMPAIGN,
            blueprintReady: false,
            blueprintPinnedAt: new Date(),
        });
        const session = await VideoInterviewSession.findOne({ sessionId: 'sess-blind' }).lean();
        assert.equal(snapshotForScoring(session as any), undefined);
    });

    await test('…and STAYS that way after the blueprint locks later', async () => {
        // This is the whole point. Generation finished after the interview.
        await lockBlueprint(CAMPAIGN, 10);
        const readiness = await blueprintReadiness(CAMPAIGN);
        assert.equal(readiness.state, 'ready');
        assert.equal(readiness.competencyCount, 10);

        const session = await VideoInterviewSession.findOne({ sessionId: 'sess-blind' }).lean();
        assert.equal(
            snapshotForScoring(session as any),
            undefined,
            'a blueprint that locked later rewrote the past'
        );
    });

    await test('a session pinned WITH competencies scores against exactly those', async () => {
        const bundle = await getLockedBlueprintForCampaign(CAMPAIGN);
        const pinned = buildBlueprintSnapshot(bundle);
        assert.ok(pinned, 'the campaign must have a snapshot to pin');
        await VideoInterviewSession.create({
            sessionId: 'sess-pinned',
            candidateId: new mongoose.Types.ObjectId(),
            campaignId: CAMPAIGN,
            blueprintSnapshot: pinned,
            blueprintReady: true,
            blueprintPinnedAt: new Date(),
        });
        const session = await VideoInterviewSession.findOne({ sessionId: 'sess-pinned' }).lean();
        const used = snapshotForScoring(session as any);
        assert.ok(used, 'a pinned snapshot must be used');
        assert.equal((used as any).competencies.length, 10);
    });

    await test('⚠️ an EMPTY pinned snapshot is not a snapshot', async () => {
        // A partial pin is the same risk as none: the scorer would weigh nothing.
        await VideoInterviewSession.create({
            sessionId: 'sess-empty',
            candidateId: new mongoose.Types.ObjectId(),
            campaignId: CAMPAIGN,
            blueprintSnapshot: { competencies: [] },
            blueprintReady: false,
        });
        const session = await VideoInterviewSession.findOne({ sessionId: 'sess-empty' }).lean();
        assert.equal(snapshotForScoring(session as any), undefined);
    });

    await test('the pin records whether the interview had them', async () => {
        const blind = await VideoInterviewSession.findOne({ sessionId: 'sess-blind' }).lean();
        const ok = await VideoInterviewSession.findOne({ sessionId: 'sess-pinned' }).lean();
        assert.equal((blind as any).blueprintReady, false);
        assert.equal((ok as any).blueprintReady, true);
        assert.ok((ok as any).blueprintPinnedAt, 'the pin must be timestamped');
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
