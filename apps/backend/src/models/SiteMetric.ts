import mongoose, { Schema, Document } from 'mongoose';

/**
 * Hourly latency and outcome rollup.
 *
 * Deliberately NOT shaped like SiteError. That model answers "what broke", so it
 * keeps one row per distinct problem. This one answers "how long does X take, and
 * is that changing" — a question a single deduplicated row cannot answer, because
 * the whole value is in the history.
 *
 * It is also not one row per request. A row is (scope, name, hour), upserted with
 * `$inc` and `$max`, so a route serving a million requests a day costs 24 rows and
 * still yields a usable picture: average from sum/count, worst case from maxMs,
 * and a tail count from `slowMs`. Percentiles are the honest casualty of that
 * trade — buying them would mean storing every sample.
 *
 * Why it exists: the site had error capture and no timing at all, so when the
 * dashboard "felt slower than before" there was nothing to compare against. The
 * point of this collection is the baseline, not the alert.
 */
export interface ISiteMetric extends Document {
    key: string;
    scope: 'api' | 'backend' | 'interview' | 'evaluation';
    name: string;
    bucketStart: Date;
    count: number;
    sumMs: number;
    maxMs: number;
    slowCount: number;
    failCount: number;
    /** Free-form tallies per scope, e.g. { completed: 4, abandoned: 1 }. */
    outcomes?: Record<string, number>;
}

const SiteMetricSchema = new Schema<ISiteMetric>(
    {
        key: { type: String, required: true, unique: true, index: true },
        scope: {
            type: String,
            enum: ['api', 'backend', 'interview', 'evaluation'],
            required: true,
            index: true,
        },
        name: { type: String, required: true, index: true },
        // No `index: true` here — the TTL index below already covers this field, and
        // declaring both makes Mongoose warn about a duplicate on every boot.
        bucketStart: { type: Date, required: true },
        count: { type: Number, default: 0 },
        sumMs: { type: Number, default: 0 },
        maxMs: { type: Number, default: 0 },
        slowCount: { type: Number, default: 0 },
        failCount: { type: Number, default: 0 },
        outcomes: { type: Schema.Types.Mixed },
    },
    { collection: 'site_metrics', timestamps: false },
);

/** The trend query: one name over time. */
SiteMetricSchema.index({ scope: 1, name: 1, bucketStart: -1 });
/** Retention: rollups age out on their own, no cron to forget about. */
SiteMetricSchema.index({ bucketStart: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export const SiteMetric =
    (mongoose.models.SiteMetric as mongoose.Model<ISiteMetric>) ||
    mongoose.model<ISiteMetric>('SiteMetric', SiteMetricSchema);

export default SiteMetric;
