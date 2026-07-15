/**
 * Re-dispatch Stage 1 evaluation for a single candidate (manual recovery).
 * Usage: npx tsx src/scripts/stage1-redispatch-one.ts [candidateId] [campaignId]
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Candidate from '../models/Candidate.js';
import {
    enqueueStage1EvaluationOutbox,
    flushStage1EvaluationOutboxEntry,
    normalizeStage1RubricSnapshotHash,
    resolveRubricHashForCampaign,
} from '../services/stage1EvaluationOutboxService.js';

const candidateId = (process.argv[2] || '6a4fe8c9c79a739f7e94f63e').trim();
const campaignId = (process.argv[3] || '9eced689e1f63e833e974a8c16de4b42').trim();

async function main() {
    await mongoose.connect(process.env.MONGODB_URI!);
    const c = await Candidate.findById(candidateId).lean();
    if (!c) {
        console.error('Candidate not found:', candidateId);
        process.exit(1);
    }

    await Candidate.updateOne({ _id: candidateId }, { status: 'pending_evaluation' });

    const rubricSnapshotHash = normalizeStage1RubricSnapshotHash(
        (await resolveRubricHashForCampaign(campaignId || c.campaignId)) || ''
    );

    const { outboxId, shouldDispatch } = await enqueueStage1EvaluationOutbox({
        candidateId,
        campaignId: campaignId || c.campaignId || undefined,
        organizationId: typeof c.organizationId === 'string' ? c.organizationId : undefined,
        rubricSnapshotHash,
    });
    console.log('enqueue', { outboxId, shouldDispatch });

    const ok = await flushStage1EvaluationOutboxEntry(outboxId);
    const db = mongoose.connection.db;
    if (!db) throw new Error('mongoose connection has no db handle');
    const entry = await db
        .collection('stage1_evaluation_outbox')
        .findOne({ _id: new mongoose.Types.ObjectId(outboxId) });

    console.log('flush', ok);
    console.log(
        'outbox',
        JSON.stringify({
            status: entry?.status,
            attempts: entry?.attempts,
            lastError: entry?.lastError,
            deliveredAt: entry?.deliveredAt,
        })
    );

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
