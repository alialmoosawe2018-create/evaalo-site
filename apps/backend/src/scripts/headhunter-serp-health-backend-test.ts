/**
 * headhunter-serp-health-backend-test
 *
 * WHAT THIS LOCKS IN (owner decisions, 2026-10-02 — the "honest note"):
 *
 * The n8n completion callback may carry ONE optional key,
 *
 *     serpHealth: { calls, failed, ignoredFilter }
 *
 * so the page can tell the recruiter, in their own language, that part of a short
 * search did not run normally. The backend's whole job is to read it defensively,
 * keep it on the in-memory search record, and hand it back from GET /last-result.
 * It must never change a search's status, never be stored as a candidate and never
 * be billed — billing is per search, 6 credits per candidate.
 *
 * WHAT IS ACTUALLY PROVEN HERE:
 *
 *  - Part 1 runs the REAL parser over valid and invalid shapes.
 *  - Parts 2-4 drive the REAL exported inbound handler and the REAL GET
 *    /last-result handler (taken off the real router) against a real mongod
 *    REPLICA SET with a real plan and a real credit balance, so `consumeCredits`
 *    runs its production transaction path. Billing is therefore MEASURED — the
 *    balance and `credit_ledger` — not inferred, and a positive control (two
 *    candidates, 12 credits) proves it is live in this run, so "the completion
 *    billed nothing" cannot pass for the wrong reason.
 *  - Not exercised: the frontend that renders the note (apps/frontend has its own
 *    test) and the n8n side that produces the counts.
 *
 * Synthetic data only. It never reads .env: the database is an in-memory replica
 * set started for this run, so nothing here can reach a shared cluster.
 *
 * Run: npm run test:headhunter-serp-health-backend
 */
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import CreditBalance from '../models/CreditBalance.js';
import CreditLedger from '../models/CreditLedger.js';
import OrgPlanState from '../models/OrgPlanState.js';
import HeadHunterCandidate from '../models/HeadHunterCandidate.js';
import DomainEventOutbox from '../models/DomainEventOutbox.js';
import { CREDIT_COST_MICRO, MICRO_PER_CREDIT } from '../types/billing.js';
import {
    parseHeadHunterSerpHealth,
    SERP_HEALTH_MAX_CALLS,
} from '../services/headHunterSerpHealth.js';

// `BILLING_ENFORCE` is read once when the route module loads, so it is pinned here,
// before the route is imported, rather than left to whatever the shell exports. A
// disabled billing would make every "billed nothing" assertion below vacuous.
delete process.env.BILLING_ENFORCE;
const route = await import('../routes/headHunter.js');

const ORG = 'org_test_hh_serp_health';
// With no Clerk middleware in front of the handler the caller resolves to the system
// actor, so the seeded record is owned by it and GET /last-result authorizes it.
const USER = 'system';
const TOKEN = 'tok_test_hh_serp_health';
const START_CREDITS = 100;
const CREDITS_PER_CANDIDATE = CREDIT_COST_MICRO.SEARCH_CANDIDATE / MICRO_PER_CREDIT;

let passed = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, detail = ''): void {
    if (cond) {
        passed++;
        console.log(`  ok    ${label}`);
    } else {
        failures.push(label);
        console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`);
    }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A candidate shaped like n8n's per-candidate POST body. */
function candidate(n: number) {
    return {
        name: `Fixture Person ${n}`,
        location: 'Fixture City',
        headline: `Fixture Title ${n}`,
        job_title: 'Fixture Title',
        bio: `bio ${n}`,
        linkedin_url: `https://www.linkedin.com/in/fixture-person-${n}`,
        experiences: [{ title: 'Fixture Title', company: `Fixture Co ${n}` }],
        skills: ['fixture'],
        education: [],
        match_score: 70 + n,
    };
}

type FakeRes = {
    statusCode: number;
    body: Record<string, unknown> | null;
    status: (c: number) => FakeRes;
    json: (b: Record<string, unknown>) => FakeRes;
};

function fakeRes(): FakeRes {
    const r: FakeRes = {
        statusCode: 200,
        body: null,
        status(c) {
            r.statusCode = c;
            return r;
        },
        json(b) {
            r.body = b;
            return r;
        },
    };
    return r;
}

/** POST one body to the REAL inbound handler, the way n8n does. */
async function deliver(searchId: string, body: Record<string, unknown>, idempotencyKey: string): Promise<FakeRes> {
    const secret = (process.env.N8N_HEADHUNTER_INBOUND_SECRET || '').trim();
    const req = {
        headers: {
            'x-idempotency-key': idempotencyKey,
            ...(secret ? { 'x-head-hunter-secret': secret } : {}),
        },
        query: { searchId, token: TOKEN },
        body: { searchId, ...body },
    };
    const res = fakeRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await route.postHeadHunterN8nInbound(req as any, res as any);
    return res;
}

/** The REAL GET /last-result handler, taken off the router (auth middleware skipped). */
const lastResultHandler = (() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layer = (route.default as any).stack.find((l: any) => l.route && l.route.path === '/last-result');
    if (!layer) throw new Error('GET /last-result is not on the head-hunter router');
    const handlers = layer.route.stack;
    return handlers[handlers.length - 1].handle as (req: unknown, res: unknown) => Promise<unknown>;
})();

async function lastResult(searchId: string): Promise<Record<string, unknown>> {
    const res = fakeRes();
    await lastResultHandler({ query: { searchId }, headers: {}, __resolvedOrg: { id: ORG } }, res);
    return res.body ?? {};
}

async function balanceCredits(): Promise<number> {
    const b = await CreditBalance.findOne({ organizationId: ORG }).lean();
    return (b?.balanceMicro ?? -1) / MICRO_PER_CREDIT;
}

const ledgerRows = (searchId: string) =>
    CreditLedger.countDocuments({ organizationId: ORG, usageType: 'SEARCH_CANDIDATE', sourceId: searchId });
const durableRows = (searchId: string) => HeadHunterCandidate.countDocuments({ organizationId: ORG, searchId });

/** Runs `fn` while recording the handler's billing log lines. */
async function withBillingLog<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
    const lines: string[] = [];
    const { log, warn } = console;
    const capture = (...a: unknown[]) => {
        const s = a.map(String).join(' ');
        if (/\bbilled\b|billing stopped/.test(s)) lines.push(s);
    };
    console.log = (...a: unknown[]) => { capture(...a); log(...a); };
    console.warn = (...a: unknown[]) => { capture(...a); warn(...a); };
    try {
        return { result: await fn(), lines };
    } finally {
        console.log = log;
        console.warn = warn;
    }
}

/** The completion event is emitted fire-and-forget; wait for its outbox row. */
async function completionEvent(searchId: string): Promise<Record<string, unknown> | null> {
    for (let i = 0; i < 40; i++) {
        const row = await DomainEventOutbox.findOne({
            organizationId: ORG,
            type: 'HeadHunterSearchCompleted',
            'payload.searchId': searchId,
        }).lean();
        if (row) return row.payload as Record<string, unknown>;
        await new Promise((r) => setTimeout(r, 50));
    }
    return null;
}

function seed(searchId: string): void {
    route.__seedHeadHunterRecordForTest({ searchId, organizationId: ORG, userId: USER, callbackToken: TOKEN });
}

// ── PART 1 — the parse rules ─────────────────────────────────────────────────
function partParse(): void {
    console.log('\nPART 1 — parse rules (the real parser)');
    const p = (serpHealth: unknown) => parseHeadHunterSerpHealth({ searchId: 'x', searchComplete: true, serpHealth });

    check('valid counts are returned as-is', same(p({ calls: 5, failed: 2, ignoredFilter: 1 }), { calls: 5, failed: 2, ignoredFilter: 1 }));
    check('all zero is valid (nothing went wrong)', same(p({ calls: 0, failed: 0, ignoredFilter: 0 }), { calls: 0, failed: 0, ignoredFilter: 0 }));
    check('failed + ignoredFilter === calls is valid', same(p({ calls: 4, failed: 3, ignoredFilter: 1 }), { calls: 4, failed: 3, ignoredFilter: 1 }));
    check(`calls === ${SERP_HEALTH_MAX_CALLS} is valid (the ceiling itself)`,
        same(p({ calls: SERP_HEALTH_MAX_CALLS, failed: 0, ignoredFilter: 0 }), { calls: SERP_HEALTH_MAX_CALLS, failed: 0, ignoredFilter: 0 }));

    const withExtras = p({ calls: 3, failed: 1, ignoredFilter: 0, q: 'synthetic query site:linkedin.com/in/', answeredQ: ['a'] });
    check('extra keys are stripped — only the three counts are kept (no query text)',
        same(withExtras, { calls: 3, failed: 1, ignoredFilter: 0 }), JSON.stringify(withExtras));
    const src = { calls: 2, failed: 0, ignoredFilter: 0 };
    check('the result is a fresh object, not the inbound reference',
        parseHeadHunterSerpHealth({ serpHealth: src }) !== src);

    const invalid: [string, unknown][] = [
        ['absent', undefined],
        ['null', null],
        ['an array', [5, 2, 1]],
        ['a string', '5/2/1'],
        ['a number', 5],
        ['missing ignoredFilter', { calls: 5, failed: 2 }],
        ['missing calls', { failed: 0, ignoredFilter: 0 }],
        ['negative failed', { calls: 5, failed: -1, ignoredFilter: 0 }],
        ['negative calls', { calls: -1, failed: 0, ignoredFilter: 0 }],
        ['non-integer calls', { calls: 2.5, failed: 0, ignoredFilter: 0 }],
        ['non-integer ignoredFilter', { calls: 3, failed: 0, ignoredFilter: 0.5 }],
        ['NaN', { calls: NaN, failed: 0, ignoredFilter: 0 }],
        ['Infinity', { calls: Infinity, failed: 0, ignoredFilter: 0 }],
        ['numeric strings', { calls: '5', failed: '2', ignoredFilter: '1' }],
        ['a boolean count', { calls: 1, failed: true, ignoredFilter: 0 }],
        ['a null count', { calls: 1, failed: null, ignoredFilter: 0 }],
        [`calls above ${SERP_HEALTH_MAX_CALLS}`, { calls: SERP_HEALTH_MAX_CALLS + 1, failed: 0, ignoredFilter: 0 }],
        ['a huge calls', { calls: 1e21, failed: 0, ignoredFilter: 0 }],
        ['failed > calls', { calls: 2, failed: 3, ignoredFilter: 0 }],
        ['ignoredFilter > calls', { calls: 2, failed: 0, ignoredFilter: 3 }],
        ['failed + ignoredFilter > calls', { calls: 4, failed: 3, ignoredFilter: 2 }],
    ];
    for (const [label, value] of invalid) {
        let out: unknown = 'threw';
        try {
            out = p(value);
        } catch {
            /* reported below */
        }
        check(`invalid → ignored: ${label}`, out === undefined, JSON.stringify(out));
    }

    const bodies: [string, unknown][] = [
        ['a null body', null],
        ['an array body', [{ serpHealth: { calls: 1, failed: 0, ignoredFilter: 0 } }]],
        ['a string body', '{"serpHealth":{"calls":1,"failed":0,"ignoredFilter":0}}'],
        ['a body without the key', { searchId: 'x', searchComplete: true }],
    ];
    for (const [label, body] of bodies) {
        let out: unknown = 'threw';
        try {
            out = parseHeadHunterSerpHealth(body);
        } catch {
            /* reported below */
        }
        check(`never throws, returns undefined: ${label}`, out === undefined, JSON.stringify(out));
    }
}

// ── PART 2 — a short search: candidates, then a completion with serpHealth ──
async function partShortSearch(): Promise<string> {
    console.log('\nPART 2 — real handlers: two candidates, then a completion carrying serpHealth');
    const sid = `hh_test_serp_short_${Date.now()}`;
    seed(sid);

    const before = await lastResult(sid);
    check('GET /last-result always carries the key — null before any completion',
        Object.prototype.hasOwnProperty.call(before, 'serpHealth') && before.serpHealth === null, JSON.stringify(before.serpHealth));

    // Positive control: billing is LIVE in this run.
    await deliver(sid, candidate(1), `exec-${sid}-1`);
    await deliver(sid, candidate(2), `exec-${sid}-2`);
    check('control: two candidates are billed 6 credits each (billing is live here)',
        (await balanceCredits()) === START_CREDITS - 2 * CREDITS_PER_CANDIDATE, String(await balanceCredits()));
    check('control: two ledger rows, two durable rows', (await ledgerRows(sid)) === 2 && (await durableRows(sid)) === 2);
    const balanceBefore = await balanceCredits();

    const health = { calls: 5, failed: 2, ignoredFilter: 1 };
    const { result: done, lines } = await withBillingLog(() =>
        deliver(
            sid,
            { searchComplete: true, phase1Count: 2, totalSent: 2, minTarget: 20, targetMet: false, expansionRan: true, serpHealth: health },
            `exec-${sid}-complete`
        )
    );
    check('the completion is accepted (200, completed)', done.statusCode === 200 && done.body?.status === 'completed', JSON.stringify(done.body));
    check('🔴 the completion billed NOTHING — balance unchanged', (await balanceCredits()) === balanceBefore, `${balanceBefore} -> ${await balanceCredits()}`);
    check('🔴 no ledger row was added', (await ledgerRows(sid)) === 2, String(await ledgerRows(sid)));
    check('🔴 no candidate row was stored', (await durableRows(sid)) === 2, String(await durableRows(sid)));
    check('no billing line was logged for the completion', lines.length === 0, lines.join(' | '));

    const after = await lastResult(sid);
    check('GET: status completed (the rule is unchanged)', after.status === 'completed', String(after.status));
    check('GET: still exactly the two candidates', after.candidateCount === 2, String(after.candidateCount));
    check('GET: serpHealth is returned exactly', same(after.serpHealth, health), JSON.stringify(after.serpHealth));
    check('GET: errorMessage stays null (the counts never become an error)', after.errorMessage === null, JSON.stringify(after.errorMessage));
    const payloadRows = ((after.payload as { candidates?: unknown[] } | null)?.candidates ?? []).length;
    check('GET: the counts are not inside the candidate payload', payloadRows === 2 && !JSON.stringify(after.payload).includes('ignoredFilter'));

    // Keep-existing: later bodies without a (valid) serpHealth must not erase it.
    await deliver(sid, candidate(3), `exec-${sid}-3`);
    check('keep-existing: a later candidate POST (no serpHealth) leaves it in place',
        same((await lastResult(sid)).serpHealth, health), JSON.stringify((await lastResult(sid)).serpHealth));
    await deliver(sid, { searchComplete: true, serpHealth: { calls: 2, failed: 5, ignoredFilter: 0 } }, `exec-${sid}-complete-bad`);
    check('keep-existing: an INVALID serpHealth leaves the stored one in place',
        same((await lastResult(sid)).serpHealth, health), JSON.stringify((await lastResult(sid)).serpHealth));
    await deliver(sid, { searchComplete: true }, `exec-${sid}-complete-none`);
    check('keep-existing: a completion WITHOUT serpHealth leaves it in place',
        same((await lastResult(sid)).serpHealth, health));
    const newer = { calls: 6, failed: 0, ignoredFilter: 0 };
    await deliver(sid, { searchComplete: true, serpHealth: newer }, `exec-${sid}-complete-newer`);
    check('a later VALID serpHealth replaces it', same((await lastResult(sid)).serpHealth, newer), JSON.stringify((await lastResult(sid)).serpHealth));
    return sid;
}

// ── PART 3 — zero candidates: the completion alone ───────────────────────────
async function partZeroCandidates(): Promise<void> {
    console.log('\nPART 3 — real handlers: zero candidates, a completion carrying only counts');
    const balanceBefore = await balanceCredits();

    const sid = `hh_test_serp_zero_${Date.now()}`;
    seed(sid);
    const health = { calls: 4, failed: 4, ignoredFilter: 0 };
    const body = { searchComplete: true, phase1Count: 0, totalSent: 0, minTarget: 20, targetMet: false, expansionRan: false, serpHealth: health };
    const { result: done, lines } = await withBillingLog(() => deliver(sid, body, `exec-${sid}-complete`));
    check('accepted (200)', done.statusCode === 200, JSON.stringify(done.body));
    check('🔴 nothing billed, no ledger row', (await balanceCredits()) === balanceBefore && (await ledgerRows(sid)) === 0);
    check('🔴 no candidate row', (await durableRows(sid)) === 0);
    check('no billing line was logged', lines.length === 0, lines.join(' | '));

    const got = await lastResult(sid);
    check('GET: status completed — every call failing does NOT make it "failed" (rule unchanged)', got.status === 'completed', String(got.status));
    check('GET: hasData false, 0 candidates, payload null', got.hasData === false && got.candidateCount === 0 && got.payload === null);
    check('GET: serpHealth returned', same(got.serpHealth, health), JSON.stringify(got.serpHealth));
    const event = await completionEvent(sid);
    check('the completion event says completed with 0 candidates',
        event?.status === 'completed' && event?.candidateCount === 0, JSON.stringify(event));

    // n8n re-delivers with the SAME idempotency key: the duplicate branch re-merges a
    // completion, so it is the second path that must not bill.
    const { result: again, lines: againLines } = await withBillingLog(() => deliver(sid, body, `exec-${sid}-complete`));
    check('a re-delivered completion (same key) is accepted', again.statusCode === 200, JSON.stringify(again.body));
    check('🔴 and still bills and stores nothing',
        (await balanceCredits()) === balanceBefore && (await ledgerRows(sid)) === 0 && (await durableRows(sid)) === 0 && againLines.length === 0);

    // The existing failed rules, unchanged and unaffected by the new key.
    const sidFailed = `hh_test_serp_failed_${Date.now()}`;
    seed(sidFailed);
    await deliver(sidFailed, { searchComplete: true, searchFailed: true, errorMessage: 'fixture failure', serpHealth: { calls: 2, failed: 2, ignoredFilter: 0 } }, `exec-${sidFailed}-complete`);
    const failed = await lastResult(sidFailed);
    check('searchFailed:true still makes it failed, and the counts ride along',
        failed.status === 'failed' && failed.errorMessage === 'fixture failure' && same(failed.serpHealth, { calls: 2, failed: 2, ignoredFilter: 0 }),
        JSON.stringify(failed));

    const sidMsg = `hh_test_serp_msg_${Date.now()}`;
    seed(sidMsg);
    await deliver(sidMsg, { searchComplete: true, errorMessage: 'fixture note', serpHealth: { calls: 2, failed: 0, ignoredFilter: 1 } }, `exec-${sidMsg}-complete`);
    const withMsg = await lastResult(sidMsg);
    // The shape n8n really sends when a search ends with nobody: a reason AND the counts. The page
    // shows its note on this failed search too, so the counts must come back with it.
    check('0 candidates + errorMessage is still failed (headHunter.ts rule unchanged), and serpHealth comes back with it',
        withMsg.status === 'failed' && same(withMsg.serpHealth, { calls: 2, failed: 0, ignoredFilter: 1 }), JSON.stringify(withMsg));

    // Invalid counts on a completion: ignored, never a 4xx, the search still completes.
    const sidBad = `hh_test_serp_bad_${Date.now()}`;
    seed(sidBad);
    const bad = await deliver(sidBad, { searchComplete: true, serpHealth: { calls: 2, failed: 3, ignoredFilter: 0 } }, `exec-${sidBad}-complete`);
    const badGet = await lastResult(sidBad);
    check('invalid serpHealth on a completion: 200, completed, serpHealth null',
        bad.statusCode === 200 && badGet.status === 'completed' && badGet.serpHealth === null, JSON.stringify({ code: bad.statusCode, s: badGet.status, h: badGet.serpHealth }));

    const sidExtra = `hh_test_serp_extra_${Date.now()}`;
    seed(sidExtra);
    await deliver(sidExtra, { searchComplete: true, serpHealth: { calls: 3, failed: 1, ignoredFilter: 1, q: 'synthetic query' } }, `exec-${sidExtra}-complete`);
    const extraGet = await lastResult(sidExtra);
    check('query text sent alongside the counts never reaches GET',
        same(extraGet.serpHealth, { calls: 3, failed: 1, ignoredFilter: 1 }) && !JSON.stringify(extraGet).includes('synthetic query'),
        JSON.stringify(extraGet.serpHealth));

    check('🔴 across all of Part 3: zero ledger rows and zero candidate rows',
        (await CreditLedger.countDocuments({ organizationId: ORG, sourceId: { $in: [sid, sidFailed, sidMsg, sidBad, sidExtra] } })) === 0 &&
            (await HeadHunterCandidate.countDocuments({ organizationId: ORG, searchId: { $in: [sid, sidFailed, sidMsg, sidBad, sidExtra] } })) === 0);
    for (const s of [sid, sidFailed, sidMsg, sidBad, sidExtra]) route.__forgetHeadHunterRecordForTest(s);
}

// ── PART 4 — the durable fallback returns null ───────────────────────────────
async function partDurable(sid: string): Promise<void> {
    console.log('\nPART 4 — the durable fallback (in-memory record gone)');
    route.__forgetHeadHunterRecordForTest(sid);
    const got = await lastResult(sid);
    check('served from the durable store', got.source === 'durable' && got.candidateCount === 3, JSON.stringify({ s: got.source, n: got.candidateCount }));
    check('serpHealth is present and null there (it lived only in memory)',
        Object.prototype.hasOwnProperty.call(got, 'serpHealth') && got.serpHealth === null, JSON.stringify(got.serpHealth));
}

async function main(): Promise<void> {
    console.log('='.repeat(90));
    console.log('Head Hunter — serpHealth on the completion: parsed, kept, returned, never billed');
    console.log('='.repeat(90));
    partParse();

    const rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(rs.getUri());
    try {
        if (mongoose.connection.db?.databaseName === 'evaalo') {
            throw new Error('refusing to run against the production database');
        }
        await HeadHunterCandidate.syncIndexes();
        const now = new Date();
        const end = new Date(now.getTime() + 30 * 86400_000);
        await OrgPlanState.create({
            organizationId: ORG, planId: 'starter', billingProvider: 'manual', subscriptionStatus: 'active',
            billingCycle: 'monthly', currentPeriodStart: now, currentPeriodEnd: end,
        });
        await CreditBalance.create({
            organizationId: ORG, balanceMicro: START_CREDITS * MICRO_PER_CREDIT,
            periodStart: now, periodEnd: end, refreshedFromPlanAt: now,
        });

        const shortSid = await partShortSearch();
        await partZeroCandidates();
        await partDurable(shortSid);
        // The completion events flush fire-and-forget; let them land before teardown.
        await new Promise((r) => setTimeout(r, 300));
    } finally {
        await mongoose.disconnect();
        await rs.stop();
    }

    console.log(`\n${failures.length === 0 ? 'PASS' : 'FAIL'} — ${passed} assertions passed`);
    if (failures.length > 0) for (const f of failures) console.log(`  - ${f}`);
    console.log(
        '\nMUTATIONS that MUST turn this red (run them before trusting it):\n' +
        '  M1  parseHeadHunterSerpHealth returns any plain object unchecked       -> Part 1 invalid shapes, Part 3 invalid/extra-key checks\n' +
        '  M2  drop the `failed + ignoredFilter <= calls` check                     -> Part 1 sums, Part 2 invalid keep-existing, Part 3 invalid\n' +
        '  M3  drop `?? existing.serpHealth` at the record .set (no keep-existing) -> Part 2 keep-existing checks\n' +
        '  M4  drop `serpHealth` from the in-memory GET /last-result response       -> Parts 2-3 GET checks\n' +
        '  M5  drop `serpHealth: null` from the durable GET response                -> Part 4\n' +
        '  M6  let failed > 0 flip a 0-candidate completion to "failed"             -> Part 3 status + event checks\n' +
        '  M7  fold the counts into the body as prose under a profile key (summary) -> Parts 2-3 no-billing / no-row checks\n'
    );
    if (failures.length > 0) process.exit(1);
}

main().catch(async (err) => {
    console.error('\nERROR —', err instanceof Error ? err.message : err);
    try {
        await mongoose.disconnect();
    } catch {
        /* already down */
    }
    process.exit(1);
});
