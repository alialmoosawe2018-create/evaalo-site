/**
 * headhunter-history-store-test
 *
 * Head-hunter searches were the only paid artefact with no database row: the
 * history lived in one browser's localStorage, keyed by user id, so clearing
 * site data, switching device, or signing in with a second account erased it.
 * Three of the owner's searches vanished that way on 2026-09-16.
 *
 * This drives the storage contract the new collection has to keep, on the real
 * database, with the real model and its real indexes — not a mock:
 *
 *   1. two organizations may hold the SAME entry id (ids come from browsers)
 *   2. one organization may NOT hold it twice (a retry updates, never duplicates)
 *   3. an org-scoped read returns that org's rows and nothing else
 *   4. rows come back newest-first, which is the order the page renders
 *
 * (3) is the one that matters most: this collection was added the same night a
 * cross-tenant leak was found in the application intake, and a history row
 * carries a full candidate list.
 *
 * Every row it writes is prefixed and deleted again, whether it passes or fails.
 *
 * Run: npm run test:headhunter-history
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import HeadHunterSearchHistory from '../models/HeadHunterSearchHistory.js';

const ORG_A = 'org_test_hh_history_A';
const ORG_B = 'org_test_hh_history_B';
const SHARED_ENTRY_ID = 'entry-shared-9f2a';

let passed = 0;
const failures: string[] = [];

function check(label: string, cond: boolean): void {
    if (cond) {
        passed++;
        console.log(`  ok    ${label}`);
    } else {
        failures.push(label);
        console.log(`  FAIL  ${label}`);
    }
}

function row(org: string, entryId: string, receivedAt: string, position: string) {
    return {
        organizationId: org,
        entryId,
        position,
        location: 'Baghdad, Iraq',
        receivedAt: new Date(receivedAt),
        payload: { candidates: [{ name: 'fixture' }] },
    };
}

async function cleanup(): Promise<void> {
    await HeadHunterSearchHistory.deleteMany({ organizationId: { $in: [ORG_A, ORG_B] } });
}

async function main(): Promise<void> {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is required');
    await mongoose.connect(uri);
    console.log(`\nconnected to ${mongoose.connection.db?.databaseName}`);
    // The unique index is the thing under test in (2); on a fresh collection it
    // may not exist yet, and a missing index would make that assertion pass for
    // the wrong reason.
    await HeadHunterSearchHistory.syncIndexes();
    await cleanup();

    console.log('\n=== 1. the same browser id in two organizations ===');
    await HeadHunterSearchHistory.create(row(ORG_A, SHARED_ENTRY_ID, '2026-09-16T13:48:00Z', 'HR Assistant'));
    let bOk = true;
    try {
        await HeadHunterSearchHistory.create(
            row(ORG_B, SHARED_ENTRY_ID, '2026-09-16T17:52:00Z', 'Sales Representative')
        );
    } catch {
        bOk = false;
    }
    check('two tenants may each hold the same entry id', bOk);

    console.log('\n=== 2. one organization may not hold it twice ===');
    let duplicateRejected = false;
    try {
        await HeadHunterSearchHistory.create(
            row(ORG_A, SHARED_ENTRY_ID, '2026-09-16T14:00:00Z', 'Duplicate')
        );
    } catch {
        duplicateRejected = true;
    }
    check('a duplicate within one tenant is rejected by the index', duplicateRejected);

    console.log('\n=== 3. TENANCY: an org-scoped read sees only its own ===');
    const aRows = await HeadHunterSearchHistory.find({ organizationId: ORG_A }).lean();
    const bRows = await HeadHunterSearchHistory.find({ organizationId: ORG_B }).lean();
    check('org A sees exactly one row', aRows.length === 1);
    check('org B sees exactly one row', bRows.length === 1);
    check('org A does not see org B\'s position', aRows[0]?.position === 'HR Assistant');
    check('org B does not see org A\'s position', bRows[0]?.position === 'Sales Representative');
    check(
        'no payload crosses the tenant boundary',
        aRows.every((r) => r.organizationId === ORG_A) && bRows.every((r) => r.organizationId === ORG_B)
    );

    console.log('\n=== 4. newest first, the order the page renders ===');
    await HeadHunterSearchHistory.create(row(ORG_A, 'entry-older', '2026-09-15T08:00:00Z', 'Older'));
    await HeadHunterSearchHistory.create(row(ORG_A, 'entry-newest', '2026-09-16T18:30:00Z', 'Newest'));
    const ordered = await HeadHunterSearchHistory.find({ organizationId: ORG_A })
        .sort({ receivedAt: -1 })
        .lean();
    check(
        'sorted newest to oldest',
        ordered.map((r) => r.position).join(',') === 'Newest,HR Assistant,Older'
    );

    console.log('\n=== 5. an update keeps one row, never a second ===');
    await HeadHunterSearchHistory.findOneAndUpdate(
        { organizationId: ORG_A, entryId: 'entry-newest' },
        { $set: { position: 'Newest (updated)', payload: { candidates: [] } } },
        { upsert: true }
    );
    const afterUpdate = await HeadHunterSearchHistory.countDocuments({ organizationId: ORG_A });
    check('org A still holds three rows, not four', afterUpdate === 3);

    await cleanup();
    const leftOver = await HeadHunterSearchHistory.countDocuments({
        organizationId: { $in: [ORG_A, ORG_B] },
    });
    check('the test leaves nothing behind', leftOver === 0);

    console.log(`\n${failures.length === 0 ? 'PASS' : 'FAIL'} — ${passed} assertions passed`);
    if (failures.length > 0) for (const f of failures) console.log(`  - ${f}`);
    await mongoose.disconnect();
    if (failures.length > 0) process.exit(1);
}

main().catch(async (err) => {
    console.error('\nERROR —', err instanceof Error ? err.message : err);
    try {
        await cleanup();
        await mongoose.disconnect();
    } catch {
        /* already down */
    }
    process.exit(1);
});
