/**
 * headhunter-candidate-durability-test
 *
 * THE DEFECT THIS EXISTS TO CLOSE (measured 2026-09-28 against production):
 *
 *   search          billed (credit_ledger)   durably kept   lost
 *   Store Manager           13                    4           9
 *   Sales Manager           20                   11           9
 *
 * Both times the durable copy froze at the phase-1 count and the loss was exactly
 * the expansion wave, which lands ~138 s later. Nothing server-side persisted the
 * candidate set: the only writer was `PUT /api/head-hunter/history`, called by the
 * page itself, so a tab closed before the late wave threw away candidates the
 * organization had already paid 6 credits each for.
 *
 * WHAT IS ACTUALLY PROVEN HERE, and what is not:
 *
 *  - Parts 1-4 drive the REAL exported inbound handler and the REAL model against
 *    the REAL database with its real indexes. No mock of the code under test.
 *  - Part 2 replays a real search's shape: candidates arriving ONE PER POST (which
 *    is what n8n does — `Send Candidate to Evaalo` has batchSize 1), phase 1, then
 *    a late phase-2 wave, and the browser NEVER calls PUT /history.
 *  - Part 5 proves the ordering claim ("stored before billed") STRUCTURALLY, by
 *    reading headHunter.ts. It is asserted, not simulated, and the mutation list at
 *    the bottom says which edits must turn it red. Billing itself is not exercised
 *    end-to-end because that would require minting credits for a fake org; the
 *    ledger-vs-persisted reconciliation belongs on real production data.
 *
 * Every row it writes is prefixed with the test org ids and deleted again, pass or
 * fail. It never touches production: it uses whatever MONGODB_URI the local .env
 * points at.
 *
 * Run: npm run test:headhunter-candidate-durability
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import HeadHunterCandidate from '../models/HeadHunterCandidate.js';
import HeadHunterSearchHistory from '../models/HeadHunterSearchHistory.js';
import {
    persistHeadHunterCandidates,
    readHeadHunterCandidates,
    countHeadHunterCandidates,
    deleteHeadHunterCandidates,
    HeadHunterPersistenceError,
} from '../services/headHunterCandidateStore.js';
import {
    postHeadHunterN8nInbound,
    __seedHeadHunterRecordForTest,
    __forgetHeadHunterRecordForTest,
} from '../routes/headHunter.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const ORG_A = 'org_test_hh_cand_A';
const ORG_B = 'org_test_hh_cand_B';
const USER_A = 'user_test_hh_cand_A';
const TOKEN = 'tok_test_hh_cand';

let mongo: MongoMemoryServer | null = null;
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

async function cleanup(): Promise<void> {
    await HeadHunterCandidate.deleteMany({ organizationId: { $in: [ORG_A, ORG_B] } });
    await HeadHunterSearchHistory.deleteMany({ organizationId: { $in: [ORG_A, ORG_B] } });
}

/** A candidate shaped exactly like n8n's per-candidate POST body. */
function candidate(n: number, extra: Record<string, unknown> = {}) {
    return {
        name: `Fixture Person ${n}`,
        location: 'Baghdad, Iraq',
        headline: `Sales Manager ${n}`,
        job_title: 'Sales Manager',
        bio: `bio ${n}`,
        linkedin_url: `https://www.linkedin.com/in/fixture-person-${n}`,
        experiences: [{ title: 'Sales Manager', company: `Co ${n}` }],
        skills: ['sales'],
        education: [],
        match_score: 70 + n,
        match_insights: [],
        ...extra,
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

/** Deliver one candidate to the REAL inbound handler, the way n8n does. */
async function deliver(
    searchId: string,
    body: Record<string, unknown>,
    idempotencyKey: string
): Promise<FakeRes> {
    const secret = (process.env.N8N_HEADHUNTER_INBOUND_SECRET || '').trim();
    const req = {
        headers: {
            'x-idempotency-key': idempotencyKey,
            // The handler enforces this only when the env var is set. Sending it
            // whenever it is set keeps the test honest on a configured machine
            // instead of quietly exercising the 401 branch.
            ...(secret ? { 'x-head-hunter-secret': secret } : {}),
        },
        query: { searchId, token: TOKEN },
        body,
    };
    const res = fakeRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await postHeadHunterN8nInbound(req as any, res as any);
    return res;
}

async function main(): Promise<void> {
    // A real mongod with the real indexes, started for this run only — the
    // convention the rest of this suite already follows. Nothing here can reach a
    // shared cluster, so "durable" is proven without putting production at risk.
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    if (mongoose.connection.db?.databaseName === 'evaalo') {
        throw new Error('refusing to run against the production database');
    }
    // Without this the unique index would be absent and the duplicate assertions
    // below would pass for the wrong reason.
    await HeadHunterCandidate.syncIndexes();
    console.log('in-memory mongo up — running tests');
    await cleanup();

    // ── PART 1 — the store contract, on the real model and real indexes ──────
    console.log('\nPART 1 — store contract');
    {
        const sid = 'hh_test_store_1';
        const first = await persistHeadHunterCandidates({
            organizationId: ORG_A,
            searchId: sid,
            receivedAt: '2026-09-28T10:00:00.000Z',
            createdByClerkUserId: USER_A,
            rows: [
                { candidateKey: 'li:a', billingKey: `hh-search:${sid}:li_a`, sequence: 0, profile: candidate(1) },
                { candidateKey: 'li:b', billingKey: `hh-search:${sid}:li_b`, sequence: 1, profile: candidate(2) },
            ],
        });
        check('two candidates insert', first.inserted === 2, JSON.stringify(first));

        const again = await persistHeadHunterCandidates({
            organizationId: ORG_A,
            searchId: sid,
            receivedAt: '2026-09-28T10:05:00.000Z',
            rows: [
                { candidateKey: 'li:a', billingKey: `hh-search:${sid}:li_a`, sequence: 0, profile: candidate(1) },
                { candidateKey: 'li:b', billingKey: `hh-search:${sid}:li_b`, sequence: 1, profile: candidate(2) },
            ],
        });
        check('re-delivering the same candidates inserts nothing', again.inserted === 0, JSON.stringify(again));
        check(
            'and does not duplicate rows',
            (await HeadHunterCandidate.countDocuments({ organizationId: ORG_A, searchId: sid })) === 2
        );

        const rowA = await HeadHunterCandidate.findOne({ organizationId: ORG_A, searchId: sid, candidateKey: 'li:a' }).lean();
        check(
            'receivedAt is the FIRST arrival, not moved by the re-write',
            rowA?.receivedAt?.toISOString() === '2026-09-28T10:00:00.000Z',
            String(rowA?.receivedAt?.toISOString())
        );

        // A profile can come back enriched under the same key (mergeCandidateRow is
        // a shallow overwrite), so the stored copy must follow.
        await persistHeadHunterCandidates({
            organizationId: ORG_A,
            searchId: sid,
            receivedAt: '2026-09-28T10:06:00.000Z',
            rows: [
                {
                    candidateKey: 'li:a',
                    billingKey: `hh-search:${sid}:li_a`,
                    sequence: 0,
                    profile: candidate(1, { email: 'enriched@example.com' }),
                },
            ],
        });
        const enriched = await HeadHunterCandidate.findOne({ organizationId: ORG_A, searchId: sid, candidateKey: 'li:a' }).lean();
        check(
            'a candidate that re-arrives ENRICHED updates the stored profile',
            (enriched?.profile as Record<string, unknown>)?.email === 'enriched@example.com'
        );

        // Two tenants may source the same person; neither may see the other.
        await persistHeadHunterCandidates({
            organizationId: ORG_B,
            searchId: sid,
            receivedAt: '2026-09-28T10:00:00.000Z',
            rows: [{ candidateKey: 'li:a', billingKey: `hh-search:${sid}:li_a`, sequence: 0, profile: candidate(99) }],
        });
        const readA = await readHeadHunterCandidates(ORG_A, sid);
        const readB = await readHeadHunterCandidates(ORG_B, sid);
        check('two orgs may hold the same candidateKey', readB.length === 1);
        check('an org-scoped read returns only that org', readA.length === 2 && readB.length === 1, `${readA.length}/${readB.length}`);
        check(
            'org B sees its OWN profile, not org A’s',
            (readB[0] as Record<string, unknown>).name === 'Fixture Person 99'
        );
        check('the read is ordered by arrival', (readA[0] as Record<string, unknown>).name === 'Fixture Person 1');

        const counts = await countHeadHunterCandidates(ORG_A, [sid, 'hh_test_absent']);
        check('counts are per searchId', counts.get(sid) === 2 && counts.get('hh_test_absent') === undefined);

        const removed = await deleteHeadHunterCandidates(ORG_B, [sid]);
        check('delete is org-scoped', removed === 1 && (await readHeadHunterCandidates(ORG_A, sid)).length === 2);

        /**
         * Assert the unique index EXISTS, not merely that duplicates fail to appear.
         *
         * Found by mutation: making the index non-unique left every assertion above
         * green, because the upsert's own filter already matches the existing row. The
         * index guards the one case the filter cannot — two inbound POSTs for the same
         * profile racing the upsert — so its absence has to be caught directly.
         */
        const indexes = await HeadHunterCandidate.collection.indexes();
        const identity = indexes.find(
            (i) =>
                JSON.stringify(i.key) ===
                JSON.stringify({ organizationId: 1, searchId: 1, candidateKey: 1 })
        );
        check(
            'the (org, search, candidate) index exists',
            Boolean(identity),
            JSON.stringify(indexes.map((i) => i.key))
        );
        check(
            'and it is UNIQUE — the only guard against a concurrent double-insert',
            identity?.unique === true,
            JSON.stringify(identity)
        );
    }

    // ── PART 2 — the real inbound handler: phase 1, a late phase 2, no browser ──
    console.log('\nPART 2 — real inbound handler, phase 1 + late phase 2, browser never PUTs');
    const sid2 = `hh_test_lifecycle_${Date.now()}`;
    {
        __seedHeadHunterRecordForTest({
            searchId: sid2,
            organizationId: ORG_A,
            userId: USER_A,
            callbackToken: TOKEN,
        });

        // Phase 1 — eleven candidates, one POST each, exactly as n8n sends them.
        for (let i = 1; i <= 11; i++) {
            const res = await deliver(sid2, { searchId: sid2, ...candidate(i) }, `exec-test-${sid2}-${i}`);
            if (i === 1) check('the inbound handler accepts a candidate', res.statusCode === 200 && res.body?.ok === true, JSON.stringify(res.body));
        }
        const afterPhase1 = await HeadHunterCandidate.countDocuments({ organizationId: ORG_A, searchId: sid2 });
        check('phase 1 is durable without the browser doing anything', afterPhase1 === 11, `got ${afterPhase1}`);

        // THE REGRESSION ITSELF: the browser stops here. It never calls PUT /history,
        // so `head_hunter_search_history` holds nothing for this search.
        const historyRows = await HeadHunterSearchHistory.countDocuments({ organizationId: ORG_A, searchId: sid2 });
        check('the browser wrote no history row at all (the regression condition)', historyRows === 0);

        // Phase 2 lands ~138 s later. Before this fix every one of these was lost.
        for (let i = 12; i <= 20; i++) {
            await deliver(sid2, { searchId: sid2, ...candidate(i) }, `exec-test-${sid2}-${i}`);
        }
        const afterPhase2 = await HeadHunterCandidate.countDocuments({ organizationId: ORG_A, searchId: sid2 });
        check('🔴 the late phase-2 wave is durable too — 20, not 11', afterPhase2 === 20, `got ${afterPhase2}`);

        // n8n re-delivers on a transient failure; that must not duplicate or re-bill.
        await deliver(sid2, { searchId: sid2, ...candidate(20) }, `exec-test-${sid2}-20`);
        check(
            'an n8n re-delivery of the same candidate adds no row',
            (await HeadHunterCandidate.countDocuments({ organizationId: ORG_A, searchId: sid2 })) === 20
        );

        // Only the keys THIS request carried may be written. Proven by watching which
        // rows' updatedAt moves: a re-delivery of candidate 5 must touch row 5 and
        // nothing else, which is what keeps one unwritable row from blocking the rest.
        const before = new Map(
            (
                await HeadHunterCandidate.find({ organizationId: ORG_A, searchId: sid2 })
                    .select('candidateKey updatedAt')
                    .lean()
            ).map((r) => [String(r.candidateKey), r.updatedAt?.getTime() ?? 0])
        );
        await new Promise((r) => setTimeout(r, 15));
        await deliver(sid2, { searchId: sid2, ...candidate(5) }, `exec-test-${sid2}-5-again`);
        const after = await HeadHunterCandidate.find({ organizationId: ORG_A, searchId: sid2 })
            .select('candidateKey updatedAt')
            .lean();
        const moved = after.filter(
            (r) => (r.updatedAt?.getTime() ?? 0) > (before.get(String(r.candidateKey)) ?? 0)
        );
        check(
            'a re-delivered candidate rewrites ONLY its own row, not the whole set',
            moved.length === 1 && String(moved[0].candidateKey).endsWith('fixture-person-5'),
            `${moved.length} row(s) moved: ${moved.map((m) => m.candidateKey).join(', ')}`
        );

        // The completion callback carries no candidates at all. It must not fail, or a
        // transient blip would strand the search at `submitted` and the page would poll
        // for the full ten minutes.
        const completion = await deliver(
            sid2,
            { searchId: sid2, searchComplete: true, phase1Count: 11, totalSent: 20 },
            `exec-test-${sid2}-complete`
        );
        check('a pure-completion callback succeeds', completion.statusCode === 200, JSON.stringify(completion.body));
        check('it reports completed', completion.body?.status === 'completed', String(completion.body?.status));
        check(
            'and adds no candidate rows',
            (await HeadHunterCandidate.countDocuments({ organizationId: ORG_A, searchId: sid2 })) === 20
        );

        const keys = await HeadHunterCandidate.find({ organizationId: ORG_A, searchId: sid2 }).select('candidateKey billingKey').lean();
        check(
            'candidateKey is the raw profileDedupeKey (li:<url>)',
            keys.every((k) => String(k.candidateKey).startsWith('li:https://www.linkedin.com/in/fixture-person-'))
        );
        // The literal shape verified against production credit_ledger rows on
        // 2026-09-28, e.g.
        //   hh-search:headhunter_4f2528e3-…:li:https:__www_linkedin_com_in_andy-salih
        // Note what survives `safeKey`: the `:` is in the allowed set, while `/` and
        // `.` both collapse to `_`. If this assertion ever changes, existing ledger
        // keys have changed meaning and every past candidate would re-bill.
        check(
            'billingKey matches the ledger key shape observed in production',
            keys.every((k) =>
                new RegExp(
                    '^hh-search:hh_test_lifecycle_\\d+:li:https:__www_linkedin_com_in_fixture-person-\\d+$'
                ).test(String(k.billingKey))
            ),
            String(keys[0]?.billingKey)
        );
    }

    // ── PART 3 — browser closed AND the process forgot: the read path ─────────
    console.log('\nPART 3 — the read path after the in-memory record is gone (restart / 24h TTL / eviction)');
    {
        __forgetHeadHunterRecordForTest(sid2);
        const durable = await readHeadHunterCandidates(ORG_A, sid2);
        check('all 20 candidates are still readable from the database', durable.length === 20, `got ${durable.length}`);
        check(
            'and they are the real profiles, not stubs',
            durable.length > 0 &&
                durable.every((c) => typeof (c as Record<string, unknown>).linkedin_url === 'string')
        );
        check('a foreign org reads nothing', (await readHeadHunterCandidates(ORG_B, sid2)).length === 0);

        // The handler's own gate still 404s a forgotten search — that hole is
        // deliberately OUT of scope here and is recorded as the next item.
        const res = await deliver(sid2, { searchId: sid2, ...candidate(21) }, `exec-test-${sid2}-21`);
        check(
            'KNOWN GAP (out of scope): a forgotten searchId still 404s new candidates',
            res.statusCode === 404,
            `got ${res.statusCode}`
        );
    }

    // ── PART 4 — failure semantics: it must THROW, so billing is skipped ──────
    console.log('\nPART 4 — failure semantics');
    {
        let threw = false;
        await mongoose.disconnect();
        try {
            await persistHeadHunterCandidates({
                organizationId: ORG_A,
                searchId: 'hh_test_down',
                receivedAt: new Date(),
                rows: [{ candidateKey: 'li:x', billingKey: 'hh-search:x:li_x', sequence: 0, profile: candidate(1) }],
            });
        } catch (err) {
            threw = err instanceof HeadHunterPersistenceError;
        }
        check(
            '🔴 an unavailable database THROWS rather than warning — this is what stops the charge',
            threw
        );
        await mongoose.connect(mongo!.getUri());
        check('a read during an outage returns empty rather than hanging', Array.isArray(await readHeadHunterCandidates(ORG_A, 'hh_test_down')));
    }

    // ── PART 4b — a failed write must NOT be swallowed, and must leave no trace ──
    console.log('\nPART 4b — end-to-end: an unwritable candidate is rejected, not silently kept');
    {
        const sid = `hh_test_reject_${Date.now()}`;
        __seedHeadHunterRecordForTest({
            searchId: sid,
            organizationId: ORG_A,
            userId: USER_A,
            callbackToken: TOKEN,
        });
        await deliver(sid, { searchId: sid, ...candidate(1) }, `exec-reject-${sid}-1`);
        check('a normal candidate lands first', (await HeadHunterCandidate.countDocuments({ organizationId: ORG_A, searchId: sid })) === 1);

        /**
         * A genuine, non-duplicate write failure with no test hook in production code:
         * one document past BSON's 16 MB ceiling. This is the only case that exercises
         * the whole promise of the design — that the handler refuses the request rather
         * than keeping a candidate it could not store.
         */
        const oversized = { ...candidate(2), bio: 'x'.repeat(17 * 1024 * 1024) };
        const res = await deliver(sid, { searchId: sid, ...oversized }, `exec-reject-${sid}-2`);
        check('🔴 the handler FAILS the request instead of swallowing the write', res.statusCode === 500, `got ${res.statusCode}`);
        check(
            'no partial row is left behind',
            (await HeadHunterCandidate.countDocuments({ organizationId: ORG_A, searchId: sid })) === 1
        );

        /**
         * And the ordering property itself: because the write precedes the in-memory
         * `.set`, the rejected candidate never became visible to a later request — so a
         * later request cannot inherit it and bill for it.
         */
        const follow = await deliver(sid, { searchId: sid, ...candidate(3) }, `exec-reject-${sid}-3`);
        check('a later candidate still succeeds', follow.statusCode === 200, `got ${follow.statusCode}`);
        const stored = await readHeadHunterCandidates(ORG_A, sid);
        check('and the set holds exactly the two writable candidates', stored.length === 2, `got ${stored.length}`);
        check(
            '🔴 the rejected candidate never entered the merged set, so nothing can bill it',
            !stored.some((c) => String((c as Record<string, unknown>).linkedin_url).endsWith('fixture-person-2')),
            stored.map((c) => String((c as Record<string, unknown>).linkedin_url).split('/').pop()).join(', ')
        );
        __forgetHeadHunterRecordForTest(sid);
    }

    // ── PART 5 — the ordering claim, asserted against the source ──────────────
    console.log('\nPART 5 — stored BEFORE billed (structural)');
    {
        const src = readFileSync(join(HERE, '..', 'routes', 'headHunter.ts'), 'utf8');
        const iPersist = src.indexOf('await persistHeadHunterCandidates({');
        const iMapSet = src.indexOf('headHunterResultsById.set(searchId, {\n        ...existing,');
        const iBillFn = src.indexOf('async function billNewHeadHunterCandidates(');
        const iBillCalls = [...src.matchAll(/await billNewHeadHunterCandidates\(/g)].map((m) => m.index ?? -1);
        const iMergeFn = src.indexOf('async function applyHeadHunterInboundMerge(');
        const iMergeEnd = src.indexOf('\n}', src.indexOf('return { merged, rowCount, complete, receivedAt };'));

        check('the durable write exists', iPersist > 0);
        check('it is inside applyHeadHunterInboundMerge', iPersist > iMergeFn && iPersist < iMergeEnd);
        check('it runs BEFORE the in-memory record is updated', iMapSet > iPersist, `${iPersist} vs ${iMapSet}`);
        check('billing is never called inside that function', iBillCalls.every((i) => i > iMergeEnd || i < iMergeFn));
        check(
            'every billing call site sits after a serialized merge, so persistence has already run',
            iBillCalls.length === 2 &&
                iBillCalls.every((i) => src.lastIndexOf('applyHeadHunterInboundMerge(searchId, payload)', i) > iBillFn),
            `call sites: ${iBillCalls.join(', ')}`
        );
        check(
            'billing and persistence derive the candidate identity from ONE function',
            src.includes('const { billingKey, safeKey } = candidateIdentity(searchId, row);') &&
                src.includes('const { candidateKey, billingKey } = candidateIdentity(searchId, row);')
        );
        check(
            'only the incoming keys are persisted (one upsert per delivered candidate)',
            src.includes('.filter((row) => incomingKeys.has(row.candidateKey));')
        );
        check(
            'the comment states the ordering rule that actually holds the invariant',
            src.includes('WHY "BEFORE THE `.set`" AND NOT MERELY "BEFORE BILLING"')
        );
        check(
            'the serialization chain cannot double-report a failure',
            src.includes('.catch(() => undefined)') && src.includes('inboundChains.set(')
        );
        check(
            'the ledger key is unchanged, so nothing re-bills',
            src.includes("return { candidateKey, safeKey, billingKey: `hh-search:${searchId}:${safeKey}` };") &&
                src.includes('metadata: { searchId, candidateKey: safeKey }')
        );
    }

    await cleanup();
    const leftOver = await HeadHunterCandidate.countDocuments({ organizationId: { $in: [ORG_A, ORG_B] } });
    check('the test leaves nothing behind', leftOver === 0);

    console.log(`\n${failures.length === 0 ? 'PASS' : 'FAIL'} — ${passed} assertions passed`);
    if (failures.length > 0) for (const f of failures) console.log(`  - ${f}`);
    console.log(
        '\nMUTATIONS that MUST turn this red (run them before trusting it):\n' +
        '  M1  move the persistHeadHunterCandidates call below headHunterResultsById.set  -> Part 5\n' +
        '  M2  wrap the persist call in try/catch that only console.warns                -> Part 4 stays green, Part 2 goes red under an outage\n' +
        '  M3  filter out keys already stored, skipping an enriched re-arrival         -> Part 1 enrichment check\n' +
        '  M4  drop `receivedAt` out of $setOnInsert into $set                            -> Part 1 first-arrival check\n' +
        '  M5  remove organizationId from the store read filter                           -> Part 1 + Part 3 isolation checks\n' +
        '  M6  make the unique index non-unique                                           -> Part 1 duplicate check\n' +
        '  M7  change safeKey construction inside candidateIdentity                       -> Part 2 billingKey + Part 5 ledger-key check\n' +
        '  M8  drop the incomingKeys filter (persist the whole merged set)                -> Part 2 only-its-own-row check\n' +
        '  M9  persist unconditionally on a candidate-less body                           -> Part 2 pure-completion check\n' +
        '  M10 strip .js from the store import                                            -> npm run test:import-extensions\n'
    );
    await mongoose.disconnect();
    await mongo?.stop();
    if (failures.length > 0) process.exit(1);
}

main().catch(async (err) => {
    console.error('\nERROR —', err instanceof Error ? err.message : err);
    try {
        if (mongoose.connection.readyState !== 1 && mongo) await mongoose.connect(mongo.getUri());
        await cleanup();
        await mongoose.disconnect();
        await mongo?.stop();
    } catch {
        /* already down */
    }
    process.exit(1);
});
