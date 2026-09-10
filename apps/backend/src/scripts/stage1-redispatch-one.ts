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

/**
 * ⚠️ لا قيم افتراضية. كانت تُشغَّل بلا وسيطين فتعيد إرسال مرشّح آخر تماماً —
 * وهي أداة استعادة يدوية تُستخدم تحت الضغط.
 */
const candidateId = (process.argv[2] || '').trim();
const campaignId = (process.argv[3] || '').trim();

async function main() {
    if (!candidateId || !campaignId) {
        console.error('Usage: stage1-redispatch-one <candidateId> <campaignId>');
        console.error('Both are required — this script sends a real evaluation for a real person.');
        process.exit(1);
    }
    await mongoose.connect(process.env.MONGODB_URI!);
    const c = await Candidate.findById(candidateId).lean();
    if (!c) {
        console.error('Candidate not found:', candidateId);
        process.exit(1);
    }

    // لا نلمس حالة الشخص: مع APPLICATION_OWNS_CAMPAIGN_STATE الحالةُ تخصّ الطلب،
    // فكتابتها على الشخص تذهب حيث لا يقرأها أحد وتُلوّث حملاته الأخرى.

    const rubricSnapshotHash = normalizeStage1RubricSnapshotHash(
        (await resolveRubricHashForCampaign(campaignId || c.campaignId)) || ''
    );

    const { outboxId, shouldDispatch, reason } = await enqueueStage1EvaluationOutbox({
        candidateId,
        campaignId: campaignId || c.campaignId || undefined,
        organizationId: typeof c.organizationId === 'string' ? c.organizationId : undefined,
        rubricSnapshotHash,
    });
    console.log('enqueue', { outboxId, shouldDispatch, reason });

    const attemptsBefore =
        (
            await mongoose.connection
                .collection('stage1_evaluation_outbox')
                .findOne({ _id: new mongoose.Types.ObjectId(outboxId) })
        )?.attempts ?? 0;

    const ok = await flushStage1EvaluationOutboxEntry(outboxId);
    const db = mongoose.connection.db;
    if (!db) throw new Error('mongoose connection has no db handle');
    const entry = await db
        .collection('stage1_evaluation_outbox')
        .findOne({ _id: new mongoose.Types.ObjectId(outboxId) });

    /**
     * ⚠️ `flush true` وحدها كذبة مريحة: تعود `true` أيضاً لصفٍّ سُلّم سابقاً، بلا
     * إرسال. المشغّل يقرأها نجاحاً فيمضي، والمرشّح يبقى بلا تحليل. المحاولة
     * تزيد فقط حين يُطالَب بالصفّ فعلاً — وهذا هو الفارق الذي يُطبع.
     */
    const actuallySent = (entry?.attempts ?? 0) > attemptsBefore;
    console.log('flush', ok, actuallySent ? '(SENT)' : '(NOTHING SENT — pre-existing row)');
    if (!actuallySent) {
        console.warn(
            '⚠️ No evaluation was dispatched by this run. The row was not claimable ' +
                '(already delivered, or out of attempt budget). This candidate is NOT recovered.'
        );
    }
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
