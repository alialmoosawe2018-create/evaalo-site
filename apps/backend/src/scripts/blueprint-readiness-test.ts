/**
 * `blueprintReadiness` — what the interview gate is allowed to open on.
 *
 * `resolveBlueprintForStart` waits 8 s and then starts the interview without
 * competencies. Measured on the deployed generator on 2026-09-18 — 88 s, 92 s,
 * 126 s, 132 s — so that wait effectively never pays. Three consecutive
 * public-path interviews ran blind while `/end` later handed the scorer the full
 * rubric: coverage 0.22, 0.11, 0, 0.33, and one scored ZERO.
 *
 * ⚠️ A LOCK IS NOT READINESS. `/end` has always tested `competencies.length > 0`
 * separately before trusting a snapshot — an admission that locked-but-empty
 * happens. Readiness counts competencies rather than trusting the status field,
 * and the first test below is that distinction.
 *
 * Runs on an in-memory mongo; no external database.
 *
 * Run: npm run test:blueprint-readiness
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import InterviewBlueprint from '../models/InterviewBlueprint.js';
import { blueprintReadiness, isBlueprintGenerating } from '../services/expertise/ensureBlueprint.js';

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

async function lockBlueprint(campaignId: string, competencyCount: number): Promise<void> {
    await InterviewBlueprint.create({
        blueprintId: `bp-${campaignId}`,
        profileId: `prof-${campaignId}`,
        campaignId,
        status: 'locked',
        lockedAt: new Date(),
        language: 'ar',
        anchorQuestions: ['سؤال؟'],
        competencies: Array.from({ length: competencyCount }, (_, i) => competency(i)),
    });
}

async function main(): Promise<void> {
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    // The feature is on unless explicitly 'false' (see isBlueprintFeatureEnabled).
    delete process.env.VIDEO_INTERVIEW_USE_BLUEPRINT;
    console.log('[blueprint-readiness] in-memory mongo up — running tests\n');

    await test('a locked blueprint WITH competencies is ready', async () => {
        await lockBlueprint('camp-ready', 10);
        const r = await blueprintReadiness('camp-ready');
        assert.equal(r.state, 'ready');
        assert.equal(r.competencyCount, 10);
    });

    await test('⚠️ locked but EMPTY is NOT ready — a lock is not readiness', async () => {
        await lockBlueprint('camp-empty', 0);
        const r = await blueprintReadiness('camp-empty');
        assert.notEqual(r.state, 'ready');
        assert.equal(r.competencyCount, 0);
    });

    await test('nothing locked and nothing running is absent', async () => {
        const r = await blueprintReadiness('camp-nothing');
        assert.equal(r.state, 'absent');
        assert.equal(r.competencyCount, 0);
    });

    await test('no campaign id is ready with zero competencies — never gate it', async () => {
        // Such a session has no blueprint to wait for and claims no specialism.
        const r = await blueprintReadiness('');
        assert.equal(r.state, 'ready');
        assert.equal(r.competencyCount, 0);
    });

    await test('the feature switched off never gates either', async () => {
        const previous = process.env.VIDEO_INTERVIEW_USE_BLUEPRINT;
        process.env.VIDEO_INTERVIEW_USE_BLUEPRINT = 'false';
        try {
            const r = await blueprintReadiness('camp-nothing');
            assert.equal(r.state, 'ready');
            assert.equal(r.competencyCount, 0);
        } finally {
            if (previous === undefined) delete process.env.VIDEO_INTERVIEW_USE_BLUEPRINT;
            else process.env.VIDEO_INTERVIEW_USE_BLUEPRINT = previous;
        }
    });

    await test('a campaign not being generated reports false', () => {
        assert.equal(isBlueprintGenerating('camp-nothing'), false);
        assert.equal(isBlueprintGenerating(''), false);
    });

    await test('readiness never throws on a broken lookup', async () => {
        // A failed read must not read as ready — the gate would open on it.
        const original = (InterviewBlueprint as any).findOne;
        (InterviewBlueprint as any).findOne = () => {
            throw new Error('simulated database failure');
        };
        try {
            const r = await blueprintReadiness('camp-ready');
            assert.notEqual(r.state, 'ready');
        } finally {
            (InterviewBlueprint as any).findOne = original;
        }
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
