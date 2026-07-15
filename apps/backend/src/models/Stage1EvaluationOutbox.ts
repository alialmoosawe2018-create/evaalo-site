import mongoose, { Schema, Document } from 'mongoose';

export type Stage1EvaluationOutboxStatus = 'pending' | 'delivered' | 'failed';

export interface IStage1EvaluationOutbox extends Document {
    candidateId: string;
    campaignId?: string;
    organizationId?: string;
    rubricSnapshotHash: string;
    formSchemaHash?: string;
    idempotencyKey: string;
    status: Stage1EvaluationOutboxStatus;
    attempts: number;
    lastError?: string;
    deliveredAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const Stage1EvaluationOutboxSchema = new Schema<IStage1EvaluationOutbox>(
    {
        candidateId: { type: String, required: true, index: true, trim: true },
        campaignId: { type: String, trim: true, index: true },
        organizationId: { type: String, trim: true, index: true },
        rubricSnapshotHash: { type: String, required: true, trim: true, default: '' },
        formSchemaHash: { type: String, trim: true },
        idempotencyKey: { type: String, required: true, unique: true, trim: true },
        status: {
            type: String,
            enum: ['pending', 'delivered', 'failed'],
            required: true,
            default: 'pending',
            index: true,
        },
        attempts: { type: Number, required: true, default: 0, min: 0 },
        lastError: { type: String, trim: true },
        deliveredAt: { type: Date },
    },
    { timestamps: true, collection: 'stage1_evaluation_outbox' }
);

Stage1EvaluationOutboxSchema.index({ status: 1, createdAt: 1 });

export default mongoose.model<IStage1EvaluationOutbox>(
    'Stage1EvaluationOutbox',
    Stage1EvaluationOutboxSchema
);
