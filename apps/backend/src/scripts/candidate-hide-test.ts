// ============================================
// scripts/candidate-hide-test.ts
// Locks down "hide this campaign card" — a feature that could not work at all.
//
// The stage list serves APPLICATION rows: `applicationToStageListRow` sets
// `_id = application._id` and moves the person to `candidateId`, and the list
// filters on the application's own `hiddenFromViews`. But /bulk-hide only ever
// ran `Candidate.updateMany({ _id: { $in: ids } })` — ids from a different
// collection — so nothing ever matched. The route still answered success and
// the frontend removed the card optimistically, so the user saw it vanish and
// then reappear on the next reload. Measured in production: 6 hide attempts,
// and 0 documents in either collection carrying hiddenFromStages/hiddenFromViews.
//
// Run: npx tsx src/scripts/candidate-hide-test.ts
// Uses mongodb-memory-server — no external database.
// ============================================

import assert from 'node:assert';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import Candidate from '../models/Candidate.js';
import CandidateApplication from '../models/CandidateApplication.js';
import { applyCandidateHide } from '../services/candidateHideService.js';

const ORG = 'org_hide_test';
const OTHER_ORG = 'org_someone_else';

let pass = 0;
let fail = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try {
        await fn();
        pass += 1;
        console.log('  ✔ ' + name);
    } catch (err) {
        fail += 1;
        console.log('  ✘ ' + name + ' — ' + (err as Error).message);
    }
}

const hideStage = (stage: string) => ({ $addToSet: { hiddenFromStages: stage } });
const unhideStage = (stage: string) => ({ $pull: { hiddenFromStages: stage } });

async function makePerson(organizationId = ORG) {
    return Candidate.create({
        organizationId,
        full_name: 'Test Person',
        email: `p${Date.now()}${Math.random()}@example.com`,
        phone: '+9647000000000',
        position_applied_for: 'HR Assistant',
        years_of_experience: '2-3',
    });
}

async function makeApplication(personId: mongoose.Types.ObjectId, organizationId = ORG) {
    return CandidateApplication.create({
        organizationId,
        candidateId: personId,
        applicationId: 'app-' + Math.random().toString(36).slice(2, 10),
        campaignId: 'camp-1',
        emailDenorm: `a${Date.now()}${Math.random()}@example.com`,
    });
}

async function main(): Promise<void> {
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());

    console.log('hiding a stage card');

    await test('THE BUG: an application id hides the APPLICATION row', async () => {
        const person = await makePerson();
        const app = await makeApplication(person._id as mongoose.Types.ObjectId);

        // The stage row hands the frontend the APPLICATION id, so this is
        // exactly what /bulk-hide receives.
        const res = await applyCandidateHide({
            organizationId: ORG,
            ids: [String(app._id)],
            update: hideStage('screening'),
        });

        assert.equal(res.matchedCount, 1, 'nothing matched — the old failure');
        assert.equal(res.modifiedCount, 1);

        const saved = await CandidateApplication.findById(app._id).lean();
        assert.deepEqual(saved?.hiddenFromStages, ['screening']);
    });

    await test('the old Candidate-only write would have matched nothing', async () => {
        const person = await makePerson();
        const app = await makeApplication(person._id as mongoose.Types.ObjectId);

        // Reproduces the previous implementation verbatim.
        const old = await Candidate.updateMany(
            { organizationId: ORG, _id: { $in: [String(app._id)] } },
            hideStage('screening')
        );
        assert.equal(old.matchedCount, 0, 'the bug is not reproduced — check the premise');

        const untouched = await CandidateApplication.findById(app._id).lean();
        assert.equal(untouched?.hiddenFromStages, undefined);
    });

    await test('a legacy person id still hides the CANDIDATE row', async () => {
        const person = await makePerson();
        const res = await applyCandidateHide({
            organizationId: ORG,
            ids: [String(person._id)],
            update: hideStage('voice'),
        });
        assert.equal(res.matchedCount, 1);
        const saved = await Candidate.findById(person._id).lean();
        assert.deepEqual(saved?.hiddenFromStages, ['voice']);
    });

    await test('unhide removes it again', async () => {
        const person = await makePerson();
        const app = await makeApplication(person._id as mongoose.Types.ObjectId);
        await applyCandidateHide({
            organizationId: ORG,
            ids: [String(app._id)],
            update: hideStage('video'),
        });
        const res = await applyCandidateHide({
            organizationId: ORG,
            ids: [String(app._id)],
            update: unhideStage('video'),
        });
        assert.equal(res.matchedCount, 1);
        const saved = await CandidateApplication.findById(app._id).lean();
        assert.deepEqual(saved?.hiddenFromStages, []);
    });

    await test('hiding twice is idempotent and still reports the card as found', async () => {
        const person = await makePerson();
        const app = await makeApplication(person._id as mongoose.Types.ObjectId);
        const first = await applyCandidateHide({
            organizationId: ORG,
            ids: [String(app._id)],
            update: hideStage('screening'),
        });
        const second = await applyCandidateHide({
            organizationId: ORG,
            ids: [String(app._id)],
            update: hideStage('screening'),
        });
        assert.equal(first.matchedCount, 1);
        assert.equal(second.matchedCount, 1);

        // $addToSet does not duplicate the entry...
        const saved = await CandidateApplication.findById(app._id).lean();
        assert.deepEqual(saved?.hiddenFromStages, ['screening']);

        // ...yet `modified` still counts it, because both schemas set
        // `timestamps: true` and Mongoose bumps `updatedAt` on every matched
        // document. So modified tracks matched for this update, which is what
        // makes the production audit trail conclusive: six hide attempts logged
        // `modified: 0`, and with timestamps in play that can only mean zero
        // documents matched — never "it was already hidden".
        assert.equal(second.modifiedCount, second.matchedCount);
    });

    await test('another org cannot hide your card', async () => {
        const person = await makePerson();
        const app = await makeApplication(person._id as mongoose.Types.ObjectId);
        const res = await applyCandidateHide({
            organizationId: OTHER_ORG,
            ids: [String(app._id)],
            update: hideStage('screening'),
        });
        assert.equal(res.matchedCount, 0);
        const saved = await CandidateApplication.findById(app._id).lean();
        assert.equal(saved?.hiddenFromStages, undefined);
    });

    await test('an empty id list touches nothing', async () => {
        const res = await applyCandidateHide({
            organizationId: ORG,
            ids: [],
            update: hideStage('screening'),
        });
        assert.deepEqual(res, { matchedCount: 0, modifiedCount: 0 });
    });

    await test('a mixed batch hides both kinds of row', async () => {
        const legacy = await makePerson();
        const person = await makePerson();
        const app = await makeApplication(person._id as mongoose.Types.ObjectId);
        const res = await applyCandidateHide({
            organizationId: ORG,
            ids: [String(legacy._id), String(app._id)],
            update: hideStage('screening'),
        });
        assert.equal(res.matchedCount, 2);
    });

    await mongoose.disconnect();
    await mongo.stop();

    console.log(`\n${fail === 0 ? '✅' : '❌'} candidate-hide: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
