/**
 * Persistent record of Head Hunter candidate contact reveals (field-level).
 *
 * Each contact field (phone / email / linkedin) is charged once per
 * (organizationId, candidateKey). Field-level idempotency keys live on ledger rows;
 * this document is the durable reveal state surfaced to the UI.
 */

import mongoose, { Schema, Document } from 'mongoose';

export const CONTACT_REVEAL_FIELDS = ['phone', 'email', 'linkedin'] as const;
export type ContactRevealField = (typeof CONTACT_REVEAL_FIELDS)[number];

export interface IContactRevealFieldState {
    revealedAt: Date;
    idempotencyKey: string;
}

export interface IHeadHunterContactReveal extends Document {
    organizationId: string;
    candidateKey: string;
    /** Per-field reveal timestamps + idempotency keys. */
    revealedFields: Partial<Record<ContactRevealField, IContactRevealFieldState>>;
    /** Total fields ever revealed (denormalized). */
    pieces: number;
    /** Total whole credits charged (denormalized). */
    creditsCharged: number;
    revealedByClerkUserId?: string;
    /** First reveal timestamp for the candidate. */
    revealedAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

const ContactRevealFieldStateSchema = new Schema<IContactRevealFieldState>(
    {
        revealedAt: { type: Date, required: true },
        idempotencyKey: { type: String, required: true, trim: true },
    },
    { _id: false },
);

const HeadHunterContactRevealSchema = new Schema<IHeadHunterContactReveal>(
    {
        organizationId: {
            type: String,
            required: true,
            index: true,
            trim: true,
        },
        candidateKey: {
            type: String,
            required: true,
            trim: true,
        },
        revealedFields: {
            phone: { type: ContactRevealFieldStateSchema, required: false },
            email: { type: ContactRevealFieldStateSchema, required: false },
            linkedin: { type: ContactRevealFieldStateSchema, required: false },
        },
        pieces: { type: Number, required: true, min: 0, default: 0 },
        creditsCharged: { type: Number, required: true, min: 0, default: 0 },
        revealedByClerkUserId: { type: String, trim: true },
        revealedAt: { type: Date, required: true, default: () => new Date() },
    },
    { timestamps: true, collection: 'headhunter_contact_reveals' },
);

HeadHunterContactRevealSchema.index(
    { organizationId: 1, candidateKey: 1 },
    { unique: true },
);

export default mongoose.model<IHeadHunterContactReveal>(
    'HeadHunterContactReveal',
    HeadHunterContactRevealSchema,
);
