import mongoose, { Schema, Document } from 'mongoose';

/**
 * A deduplicated site error.
 *
 * One row per distinct problem, not per occurrence: writes upsert on `fingerprint`
 * and `$inc` the counter, so 10,000 repeats of the same bug stay one row with
 * `count: 10000` instead of flooding the collection (and the triage report).
 *
 * Shape follows the existing AuditLog (organizationId / ip / userAgent / Mixed
 * metadata) and DomainEventOutbox (status + lastError) models so it indexes and
 * reads the same way as the rest of the system.
 */
export interface ISiteError extends Document {
    fingerprint: string;
    source: 'frontend' | 'backend' | 'agent';
    severity: 'error' | 'warn' | 'info';
    message: string;
    stack?: string;
    route?: string;
    method?: string;
    httpStatus?: number;
    buildId?: string;
    sessionId?: string;
    organizationId?: string;
    userAgent?: string;
    ip?: string;
    language?: string;
    viewport?: string;
    breadcrumbs?: unknown[];
    count: number;
    firstSeen: Date;
    lastSeen: Date;
    status: 'new' | 'triaged' | 'proposed' | 'fixed' | 'ignored';
    notes?: string;
}

const SiteErrorSchema = new Schema<ISiteError>(
    {
        fingerprint: { type: String, required: true, unique: true, index: true },
        source: { type: String, enum: ['frontend', 'backend', 'agent'], required: true, index: true },
        severity: { type: String, enum: ['error', 'warn', 'info'], default: 'error', index: true },
        message: { type: String, required: true },
        stack: { type: String },
        route: { type: String, index: true },
        method: { type: String },
        httpStatus: { type: Number },
        buildId: { type: String },
        sessionId: { type: String },
        organizationId: { type: String, index: true },
        userAgent: { type: String },
        ip: { type: String },
        language: { type: String },
        viewport: { type: String },
        breadcrumbs: { type: Schema.Types.Mixed },
        count: { type: Number, default: 1 },
        firstSeen: { type: Date, default: Date.now },
        lastSeen: { type: Date, default: Date.now, index: true },
        status: {
            type: String,
            enum: ['new', 'triaged', 'proposed', 'fixed', 'ignored'],
            default: 'new',
            index: true,
        },
        notes: { type: String },
    },
    { collection: 'site_errors', timestamps: false },
);

/** Triage query: what is new, newest first. */
SiteErrorSchema.index({ status: 1, lastSeen: -1 });

export const SiteError =
    (mongoose.models.SiteError as mongoose.Model<ISiteError>) ||
    mongoose.model<ISiteError>('SiteError', SiteErrorSchema);

export default SiteError;
