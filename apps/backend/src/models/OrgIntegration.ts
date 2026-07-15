/**
 * Per-organization third-party integration connection (LinkedIn, WhatsApp).
 *
 * Secrets (provider API keys, Meta access tokens) are stored ENCRYPTED in
 * `secretsEnc` (AES-256-GCM) with `keyVersion` so keys can be rotated. Raw
 * secrets are NEVER returned to the client — only the masked `meta` fields.
 *
 * One document per (organizationId, provider).
 */

import mongoose, { Schema, Document } from 'mongoose';

export type IntegrationProvider = 'linkedin' | 'whatsapp';
export type IntegrationStatus = 'connected' | 'disconnected' | 'error';

export interface IOrgIntegration extends Document {
    organizationId: string;
    provider: IntegrationProvider;
    connected: boolean;
    status: IntegrationStatus;
    /** AES-256-GCM payload: base64(iv).base64(authTag).base64(ciphertext) */
    secretsEnc?: string;
    /** Version of the encryption key used for secretsEnc (rotation). */
    keyVersion?: string;
    /** Non-sensitive display fields safe to return to the browser (masked). */
    meta?: Record<string, unknown>;
    updatedBy?: string;
    /** Operational health — answers "why isn't this working?" without log diving. */
    lastConnectedAt?: Date;
    lastMessageSentAt?: Date;
    lastErrorAt?: Date;
    lastError?: string;
    createdAt: Date;
    updatedAt: Date;
}

const OrgIntegrationSchema = new Schema<IOrgIntegration>(
    {
        organizationId: { type: String, required: true, index: true, trim: true },
        provider: {
            type: String,
            required: true,
            enum: ['linkedin', 'whatsapp'],
        },
        connected: { type: Boolean, required: true, default: false },
        status: {
            type: String,
            required: true,
            enum: ['connected', 'disconnected', 'error'],
            default: 'disconnected',
        },
        secretsEnc: { type: String },
        keyVersion: { type: String },
        meta: { type: Schema.Types.Mixed },
        updatedBy: { type: String, trim: true },
        lastConnectedAt: { type: Date },
        lastMessageSentAt: { type: Date },
        lastErrorAt: { type: Date },
        lastError: { type: String, trim: true },
    },
    { timestamps: true, collection: 'org_integrations' },
);

OrgIntegrationSchema.index({ organizationId: 1, provider: 1 }, { unique: true });

export default mongoose.model<IOrgIntegration>('OrgIntegration', OrgIntegrationSchema);
