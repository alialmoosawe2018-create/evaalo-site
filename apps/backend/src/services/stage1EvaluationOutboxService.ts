import Candidate from '../models/Candidate.js';
import RecruitmentCampaign from '../models/RecruitmentCampaign.js';
import Stage1EvaluationOutbox from '../models/Stage1EvaluationOutbox.js';
import { sendToN8N } from './n8nService.js';
import { StageCallbackConfigurationError } from './stageCallbackAuth.js';

const MAX_ATTEMPTS = 5;

/** Mongoose rejects empty rubricSnapshotHash — use a stable legacy token instead. */
export function normalizeStage1RubricSnapshotHash(raw?: string): string {
    const hash = (raw || '').trim();
    return hash || 'legacy';
}

export function buildStage1EvaluationIdempotencyKey(
    candidateId: string,
    rubricSnapshotHash: string
): string {
    const hash = (rubricSnapshotHash || 'legacy').trim();
    return `stage1-evaluation:${candidateId}:${hash}`;
}

export interface EnqueueStage1EvaluationInput {
    candidateId: string;
    campaignId?: string;
    organizationId?: string;
    rubricSnapshotHash?: string;
    formSchemaHash?: string;
}

export async function enqueueStage1EvaluationOutbox(
    input: EnqueueStage1EvaluationInput
): Promise<{ outboxId: string; shouldDispatch: boolean }> {
    const candidateId = input.candidateId.trim();
    const rubricSnapshotHash = normalizeStage1RubricSnapshotHash(input.rubricSnapshotHash);
    const idempotencyKey = buildStage1EvaluationIdempotencyKey(candidateId, rubricSnapshotHash);

    const existing = await Stage1EvaluationOutbox.findOne({ idempotencyKey }).exec();
    if (existing) {
        return {
            outboxId: String(existing._id),
            shouldDispatch: existing.status === 'pending' && existing.attempts === 0,
        };
    }

    const [doc] = await Stage1EvaluationOutbox.create([
        {
            candidateId,
            campaignId: input.campaignId?.trim() || undefined,
            organizationId: input.organizationId?.trim() || undefined,
            rubricSnapshotHash,
            formSchemaHash: input.formSchemaHash?.trim() || undefined,
            idempotencyKey,
            status: 'pending',
            attempts: 0,
        },
    ]);
    return { outboxId: String(doc._id), shouldDispatch: true };
}

export async function flushStage1EvaluationOutboxEntry(outboxId: string): Promise<boolean> {
    const entry = await Stage1EvaluationOutbox.findOneAndUpdate(
        {
            _id: outboxId,
            status: { $in: ['pending', 'failed'] },
            attempts: { $lt: MAX_ATTEMPTS },
        },
        { $inc: { attempts: 1 }, $set: { status: 'pending', lastError: undefined } },
        { new: true }
    ).exec();

    if (!entry) {
        const delivered = await Stage1EvaluationOutbox.findOne({
            _id: outboxId,
            status: 'delivered',
        }).exec();
        return Boolean(delivered);
    }

    try {
        const candidate = await Candidate.findById(entry.candidateId).lean();
        if (!candidate) {
            throw new Error(`Candidate not found: ${entry.candidateId}`);
        }

        let campaignId = entry.campaignId || candidate.campaignId;
        if (!campaignId && entry.campaignId) {
            campaignId = entry.campaignId;
        }

        const candidateObj = {
            ...candidate,
            _id: candidate._id?.toString?.() || String(candidate._id),
        };

        const ok = await sendToN8N(candidateObj as any, campaignId || undefined);
        if (!ok) {
            throw new Error('n8n webhook returned non-success');
        }

        entry.status = 'delivered';
        entry.deliveredAt = new Date();
        entry.lastError = undefined;
        await entry.save();
        return true;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        entry.lastError = message;
        if (entry.attempts >= MAX_ATTEMPTS) {
            entry.status = 'failed';
        }
        await entry.save();
        if (err instanceof StageCallbackConfigurationError) {
            throw err;
        }
        return false;
    }
}

/** Fire-and-forget delivery after candidate save commits. */
export function dispatchStage1EvaluationOutbox(outboxId: string): void {
    void flushStage1EvaluationOutboxEntry(outboxId).catch((err) => {
        console.error('[stage1Outbox] flush failed:', outboxId, err);
    });
}

/** Retry pending/failed entries (cron / startup). */
export async function processPendingStage1EvaluationOutbox(limit = 10): Promise<number> {
    const entries = await Stage1EvaluationOutbox.find({
        status: { $in: ['pending', 'failed'] },
        attempts: { $lt: MAX_ATTEMPTS },
    })
        .sort({ createdAt: 1 })
        .limit(limit)
        .exec();

    let delivered = 0;
    for (const entry of entries) {
        if (entry.status === 'failed') {
            entry.status = 'pending';
            await entry.save();
        }
        const ok = await flushStage1EvaluationOutboxEntry(String(entry._id));
        if (ok) delivered += 1;
    }
    return delivered;
}

/** Resolve campaign rubric hash when not passed at enqueue time. */
export async function resolveRubricHashForCampaign(campaignId?: string): Promise<string> {
    if (!campaignId?.trim()) return '';
    const campaign = await RecruitmentCampaign.findOne({ campaignId: campaignId.trim() })
        .select('rubricSnapshotHash')
        .lean();
    return typeof campaign?.rubricSnapshotHash === 'string' ? campaign.rubricSnapshotHash : '';
}
