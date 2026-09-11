/**
 * Finds any application that was accepted for Stage 1 evaluation and then fell
 * through the floor — without relying on `status`.
 *
 * ⚠️ `status` cannot be used for this. An application carrying a completed
 * evaluation still reads `pending_evaluation` (verified 2026-09-11 on
 * application 6a9cd9ff…86e8: eight populated evaluation fields, a Consider
 * recommendation, a finished timeline — and `status: pending_evaluation`). So
 * this joins what actually exists instead: an application stamped with an
 * evaluation context, against the outbox row that should have carried it.
 *
 * A victim is an application that has an evaluation context, has NO score, and
 * has NO outbox row. That is the shape of a silent drop. Today it is zero, and
 * it must stay zero.
 *
 * READ ONLY. It opens a connection, reads two collections and disconnects. It
 * writes nothing, and is safe to run against production at any time.
 *
 * Run: npm run verify:stage1-victims
 */
import '../loadEnv.js';
import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || '';

type Row = Record<string, unknown>;

function joinKey(candidateId: unknown, campaignId: unknown): string {
    return `${String(candidateId ?? '')}|${String(campaignId ?? '')}`;
}

async function main(): Promise<void> {
    if (!MONGODB_URI) {
        console.error('MONGODB_URI is not set — nothing to check.');
        process.exit(1);
    }
    await mongoose.connect(MONGODB_URI);
    const db = mongoose.connection.db;
    if (!db) throw new Error('no database handle');

    const apps = (await db
        .collection('candidate_applications')
        .find(
            { 'evaluationContext.formSchemaVersion': { $exists: true } },
            { projection: { candidateId: 1, campaignId: 1, writtenInterviewEvaluation: 1, status: 1, createdAt: 1 } }
        )
        .toArray()) as Row[];

    const outbox = (await db
        .collection('stage1_evaluation_outbox')
        .find({}, { projection: { candidateId: 1, campaignId: 1, status: 1, attempts: 1 } })
        .toArray()) as Row[];

    const delivered = new Set(outbox.map((o) => joinKey(o.candidateId, o.campaignId)));

    const victims = apps.filter((a) => {
        const evaluation = (a.writtenInterviewEvaluation || {}) as Row;
        const score = evaluation.overall_score;
        const hasScore = score !== undefined && score !== null && score !== '';
        return !hasScore && !delivered.has(joinKey(a.candidateId, a.campaignId));
    });

    /**
     * A pending row with zero attempts is the dormant collision hazard: if a
     * second application reuses it, the candidate is evaluated against the
     * OLDER campaign's criteria. It has never fired because every row has been
     * delivered — this reports the moment that stops being true.
     */
    const pendingUnattempted = outbox.filter((o) => o.status === 'pending' && Number(o.attempts ?? 0) === 0);

    const statusCounts: Record<string, number> = {};
    for (const o of outbox) statusCounts[String(o.status)] = (statusCounts[String(o.status)] || 0) + 1;

    console.log(`applications carrying an evaluation context : ${apps.length}`);
    console.log(`outbox rows                                 : ${outbox.length}  ${JSON.stringify(statusCounts)}`);
    console.log(`VICTIMS (no score AND no outbox row)        : ${victims.length}`);
    console.log(`pending rows with zero attempts (hazard)    : ${pendingUnattempted.length}`);

    for (const v of victims.slice(0, 25)) {
        console.log(`   application ${String(v._id)} | candidate ${String(v.candidateId)} | campaign ${String(v.campaignId)} | status ${String(v.status)}`);
    }
    for (const p of pendingUnattempted.slice(0, 25)) {
        console.log(`   hazard row ${String(p._id)} | candidate ${String(p.candidateId)} | campaign ${String(p.campaignId)}`);
    }

    await mongoose.disconnect();

    if (victims.length || pendingUnattempted.length) {
        console.error('\nNOT CLEAN — investigate the rows above before shipping anything that touches Stage 1 dispatch.');
        process.exit(1);
    }
    console.log('\nclean: no dropped application, no dormant collision row.');
}

main().catch(async (err) => {
    console.error('verify-stage1-victims failed:', (err as Error)?.message);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
});
