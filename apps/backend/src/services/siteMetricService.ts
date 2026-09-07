import SiteMetric from '../models/SiteMetric.js';

/**
 * Fire-and-forget writer for latency rollups.
 *
 * Mirrors siteErrorService: every failure is swallowed and only logged. A
 * measurement that can break the thing it measures is worse than no measurement.
 */

export type MetricScope = 'api' | 'backend' | 'interview' | 'evaluation';

export interface RecordMetricInput {
    scope: MetricScope;
    /** Stable label. Must not carry ids — see `normalizeMetricName`. */
    name: string;
    durationMs: number;
    /** Counted in `failCount` — an error still contributes its duration. */
    failed?: boolean;
    /** Tally alongside the timing, e.g. 'completed' / 'abandoned' / 'insufficient'. */
    outcome?: string;
}

/** Over this, a sample is counted in `slowCount` as well as the average. */
const SLOW_MS = Number(process.env.SITE_METRIC_SLOW_MS) || 1500;
const MAX_NAME = 120;

function hourBucket(at: Date): Date {
    const d = new Date(at);
    d.setUTCMinutes(0, 0, 0);
    return d;
}

/**
 * Collapse ids out of a path so a route is one series, not thousands.
 *
 * `/api/candidates/64f.../evaluations` and the next candidate's must land on the
 * same name, or the collection grows one row per entity per hour and the trend
 * that justifies this whole model never appears.
 */
export function normalizeMetricName(raw: string): string {
    return String(raw || '')
        .split('?')[0]
        .replace(/\/[0-9a-f]{24}(?=\/|$)/gi, '/:id')
        .replace(/\/\d+(?=\/|$)/g, '/:id')
        .replace(/\/[0-9a-f-]{32,}(?=\/|$)/gi, '/:id')
        .slice(0, MAX_NAME);
}

export async function recordMetric(input: RecordMetricInput): Promise<void> {
    try {
        const ms = Number(input.durationMs);
        if (!Number.isFinite(ms) || ms < 0) return;
        const name = normalizeMetricName(input.name);
        if (!name) return;

        const bucketStart = hourBucket(new Date());
        const key = `${input.scope}|${name}|${bucketStart.toISOString()}`;

        const inc: Record<string, number> = {
            count: 1,
            sumMs: Math.round(ms),
            slowCount: ms >= SLOW_MS ? 1 : 0,
            failCount: input.failed ? 1 : 0,
        };
        if (input.outcome) {
            // Dotted path keeps outcomes additive without reading the row first.
            inc[`outcomes.${String(input.outcome).replace(/[^\w-]/g, '_').slice(0, 40)}`] = 1;
        }

        await SiteMetric.updateOne(
            { key },
            {
                $inc: inc,
                $max: { maxMs: Math.round(ms) },
                $setOnInsert: { scope: input.scope, name, bucketStart },
            },
            { upsert: true },
        ).exec();
    } catch (err) {
        console.warn('[site-metric] write failed:', (err as Error)?.message);
    }
}

/** Never awaited by a request path. */
export function recordMetricAsync(input: RecordMetricInput): void {
    void recordMetric(input);
}

export const SLOW_THRESHOLD_MS = SLOW_MS;
