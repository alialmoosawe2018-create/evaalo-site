/**
 * headhunter-billed-vs-kept
 *
 * The acceptance check for the durable candidate store:
 *
 *     every billed candidate has a persisted row
 *
 * For every `credit_ledger` row with `usageType: 'SEARCH_CANDIDATE'` it looks for a
 * `head_hunter_candidates` row whose `billingKey` is that ledger row's
 * `idempotencyKey`. A miss means the organization paid 6 credits for a candidate we
 * cannot show them — the defect measured on 2026-09-28 at 9 lost of 13 and 9 lost
 * of 20.
 *
 * 🔴 WHY THERE IS A CUTOFF, and why the check would otherwise be red forever.
 *
 * The candidates lost before the fix are GONE. Nothing can create rows for them, so
 * a check over all history can never pass and would be worthless as a regression
 * detector. Ledger rows are therefore partitioned:
 *
 *   AFTER the cutoff   — a violation here is a live regression. This is the gate.
 *   BEFORE the cutoff  — a violation here is the historical loss. Reported for the
 *                        record, never a failure.
 *
 * Pass the cutoff as `--since=<ISO>` (the deploy timestamp). Without it every row is
 * historical and the script only reports.
 *
 * `--backfill` reconstructs rows for pre-cutoff candidates that still survive inside
 * `head_hunter_search_history.payload` — the 4 and the 11 that the browser did
 * manage to save. It cannot recover the 18 it never saved. It is OFF by default
 * because it writes.
 *
 * Read-only unless `--backfill` is passed.
 *
 * Run: npm run test:headhunter-billed-vs-kept -- --since=2026-09-28T00:00:00Z
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import HeadHunterCandidate from '../models/HeadHunterCandidate.js';
import HeadHunterSearchHistory from '../models/HeadHunterSearchHistory.js';
import { candidateIdentity } from '../routes/headHunter.js';

const args = process.argv.slice(2);
const sinceArg = args.find((a) => a.startsWith('--since='))?.slice('--since='.length) ?? '';
const SINCE = sinceArg ? new Date(sinceArg) : null;
const BACKFILL = args.includes('--backfill');

type Ledger = {
    organizationId: string;
    idempotencyKey: string;
    createdAt: Date;
    metadata?: { searchId?: string };
};

function fmt(n: number): string {
    return String(n).padStart(5);
}

async function main(): Promise<void> {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    await mongoose.connect(process.env.MONGODB_URI);
    const dbName = mongoose.connection.db?.databaseName;
    console.log(`db = ${dbName}`);
    if (SINCE && Number.isNaN(SINCE.getTime())) throw new Error(`bad --since: ${sinceArg}`);
    console.log(`cutoff = ${SINCE ? SINCE.toISOString() : '(none — everything counts as historical)'}`);
    console.log(`mode = ${BACKFILL ? 'BACKFILL (writes)' : 'read-only'}\n`);

    const ledger = (await mongoose.connection.db!
        .collection('credit_ledger')
        .find({ usageType: 'SEARCH_CANDIDATE' })
        .project({ organizationId: 1, idempotencyKey: 1, createdAt: 1, 'metadata.searchId': 1, _id: 0 })
        .toArray()) as unknown as Ledger[];

    if (!ledger.length) {
        console.log('no SEARCH_CANDIDATE ledger rows — nothing to reconcile.');
        await mongoose.disconnect();
        return;
    }

    const kept = new Set(
        (await HeadHunterCandidate.find({}).select('organizationId billingKey').lean()).map(
            (r) => `${r.organizationId}::${r.billingKey}`
        )
    );

    const bySearch = new Map<
        string,
        { org: string; searchId: string; billed: number; missing: Ledger[]; newest: Date }
    >();
    for (const row of ledger) {
        const searchId = row.metadata?.searchId ?? '(unknown)';
        const key = `${row.organizationId}::${searchId}`;
        const entry =
            bySearch.get(key) ??
            { org: row.organizationId, searchId, billed: 0, missing: [], newest: row.createdAt };
        entry.billed += 1;
        if (row.createdAt > entry.newest) entry.newest = row.createdAt;
        if (!kept.has(`${row.organizationId}::${row.idempotencyKey}`)) entry.missing.push(row);
        bySearch.set(key, entry);
    }

    const rows = [...bySearch.values()].sort((a, b) => a.newest.getTime() - b.newest.getTime());
    const isRegression = (r: (typeof rows)[number]) =>
        Boolean(SINCE) && r.missing.some((m) => m.createdAt >= SINCE!);

    console.log('billed  kept  lost  when                      searchId');
    console.log('─'.repeat(96));
    let historicalLost = 0;
    let regressionLost = 0;
    for (const r of rows) {
        const lost = r.missing.length;
        const reg = isRegression(r);
        if (lost) (reg ? (regressionLost += lost) : (historicalLost += lost));
        const flag = lost === 0 ? '  ' : reg ? '🔴' : '· ';
        console.log(
            `${flag}${fmt(r.billed)} ${fmt(r.billed - lost)} ${fmt(lost)}  ${r.newest.toISOString()}  ${r.searchId}`
        );
    }

    console.log('\n' + '='.repeat(96));
    console.log(`searches           ${rows.length}`);
    console.log(`billed candidates  ${ledger.length}`);
    console.log(`persisted          ${ledger.length - historicalLost - regressionLost}`);
    console.log(`lost — historical  ${historicalLost}   (before the cutoff; unrecoverable, reported only)`);
    console.log(`lost — REGRESSION  ${regressionLost}   (after the cutoff; this is the failure condition)`);

    if (BACKFILL) {
        console.log('\nBACKFILL — rebuilding rows from surviving history payloads');
        let written = 0;
        for (const r of rows) {
            if (!r.missing.length || r.searchId === '(unknown)') continue;
            const hist = await HeadHunterSearchHistory.findOne({
                organizationId: r.org,
                searchId: r.searchId,
            }).lean();
            const payload = (hist as { payload?: { candidates?: unknown[] } } | null)?.payload;
            const candidates = Array.isArray(payload?.candidates) ? payload!.candidates : [];
            if (!candidates.length) {
                console.log(`  ${r.searchId}  no surviving payload — ${r.missing.length} candidate(s) unrecoverable`);
                continue;
            }
            const wanted = new Set(r.missing.map((m) => m.idempotencyKey));
            const ops = [];
            let seq = 0;
            for (const c of candidates) {
                // The SAME identity function billing uses, imported rather than
                // re-derived, so a backfilled row cannot key differently from the
                // ledger row it is meant to satisfy.
                const { candidateKey, billingKey } = candidateIdentity(
                    r.searchId,
                    c as Record<string, unknown>
                );
                const sequence = seq++;
                if (!wanted.has(billingKey)) continue;
                ops.push({
                    updateOne: {
                        filter: { organizationId: r.org, searchId: r.searchId, candidateKey },
                        update: {
                            $set: { billingKey, sequence, profile: c },
                            $setOnInsert: {
                                organizationId: r.org,
                                searchId: r.searchId,
                                candidateKey,
                                receivedAt: (hist as { receivedAt?: Date }).receivedAt ?? r.newest,
                            },
                        },
                        upsert: true,
                    },
                });
            }
            if (!ops.length) {
                console.log(`  ${r.searchId}  payload holds none of the ${r.missing.length} missing candidate(s)`);
                continue;
            }
            const res = await HeadHunterCandidate.bulkWrite(ops, { ordered: false });
            written += res.upsertedCount ?? 0;
            console.log(
                `  ${r.searchId}  recovered ${res.upsertedCount ?? 0} of ${r.missing.length} missing candidate(s)`
            );
        }
        console.log(`\nbackfilled ${written} row(s). Re-run without --backfill to confirm.`);
    }

    await mongoose.disconnect();
    if (regressionLost > 0) {
        console.log('\nFAIL — a candidate billed after the cutoff has no persisted row.');
        process.exit(1);
    }
    console.log('\nPASS — every candidate billed after the cutoff is persisted.');
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
