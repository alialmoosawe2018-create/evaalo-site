/**
 * Per-organization monotonic sequence counter for domain events.
 * A single atomic $inc yields the next `seq`, giving each org a strictly
 * increasing event stream (the replay cursor for realtime reconnects).
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IOrgEventSequence extends Document {
    organizationId: string;
    seq: number;
    updatedAt: Date;
}

const OrgEventSequenceSchema = new Schema<IOrgEventSequence>(
    {
        organizationId: { type: String, required: true, unique: true, index: true, trim: true },
        seq: { type: Number, required: true, default: 0 },
    },
    { timestamps: true, collection: 'org_event_sequences' },
);

export default mongoose.model<IOrgEventSequence>('OrgEventSequence', OrgEventSequenceSchema);
