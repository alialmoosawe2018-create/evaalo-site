import '../loadEnv.js';
import mongoose from 'mongoose';
import SiteMetric from '../models/SiteMetric.js';
import { recordMetric, normalizeMetricName } from '../services/siteMetricService.js';

/**
 * Regression for the latency rollup.
 *
 * The failure this guards against is not a crash — it is a collection that grows
 * one row per entity per hour because an id leaked into a metric name, which turns
 * the trend it exists for into noise. That is silent, so it needs a test.
 *
 * Run: npm run test:site-metric   (writes to evaalo_dev, cleans up after itself)
 */

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failures += 1;
    console.log(`${ok ? '✅' : '❌'} ${label}${ok ? '' : `\n   expected ${JSON.stringify(expected)}\n   actual   ${JSON.stringify(actual)}`}`);
}

function nameCases(): void {
    console.log('\n— name normalization —');
    check('mongo id → :id', normalizeMetricName('/api/candidates/64f1a2b3c4d5e6f708192a3b'), '/api/candidates/:id');
    check('id mid-path', normalizeMetricName('/api/candidates/64f1a2b3c4d5e6f708192a3b/evaluations'), '/api/candidates/:id/evaluations');
    check('numeric id', normalizeMetricName('/api/orgs/12345/members'), '/api/orgs/:id/members');
    check('long hex token', normalizeMetricName('/api/public/a3b24f684106c34f7af4d33ed0998589'), '/api/public/:id');
    check('query dropped', normalizeMetricName('/api/candidates?forView=candidates'), '/api/candidates');
    check('plain path untouched', normalizeMetricName('/api/users/me'), '/api/users/me');
    // A word that merely looks hex-ish must survive — over-collapsing hides real routes.
    check('short word kept', normalizeMetricName('/api/billing/activity'), '/api/billing/activity');
}

async function rollupCases(): Promise<void> {
    console.log('\n— hourly rollup —');
    // Letters only: a numeric suffix would itself be normalized to `/:id`, which is
    // correct behaviour but would make this run collide with the last one.
    const name = `/api/__test__/${Date.now().toString(36).replace(/\d/g, (d) => 'ghijklmnop'[Number(d)])}`;
    await recordMetric({ scope: 'api', name, durationMs: 100 });
    await recordMetric({ scope: 'api', name, durationMs: 900, outcome: 'ok' });
    await recordMetric({ scope: 'api', name, durationMs: 4000, failed: true, outcome: 'ok' });

    const rows = await SiteMetric.find({ scope: 'api', name }).lean();
    check('one row per hour, not per sample', rows.length, 1);
    const row = rows[0] as unknown as {
        count: number; sumMs: number; maxMs: number; slowCount: number; failCount: number;
        outcomes?: Record<string, number>;
    };
    check('count', row?.count, 3);
    check('sumMs', row?.sumMs, 5000);
    check('maxMs is the worst sample', row?.maxMs, 4000);
    check('slowCount counts the tail only', row?.slowCount, 1);
    check('failCount', row?.failCount, 1);
    check('outcomes tally', row?.outcomes?.ok, 2);

    // A bad sample must be dropped, never stored as garbage.
    await recordMetric({ scope: 'api', name, durationMs: Number.NaN });
    await recordMetric({ scope: 'api', name, durationMs: -5 });
    const after = await SiteMetric.findOne({ scope: 'api', name }).lean();
    check('NaN and negative ignored', (after as unknown as { count: number })?.count, 3);

    await SiteMetric.deleteMany({ name });
}

async function main(): Promise<void> {
    nameCases();
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) {
        console.log('\n⚠️  no MONGODB_URI — ran name cases only');
    } else {
        await mongoose.connect(uri);
        await rollupCases();
        await mongoose.disconnect();
    }
    console.log(`\n${failures === 0 ? '✅ all passed' : `❌ ${failures} failed`}`);
    process.exit(failures === 0 ? 0 : 1);
}

void main();
