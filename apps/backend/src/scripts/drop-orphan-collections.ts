// ============================================
// scripts/drop-orphan-collections.ts
// Drops collections orphaned by a model rename — ONLY when empty (0 docs).
// Currently: `campaigncomparerequests` (superseded by `campaign_compare_requests`).
//
// Safe by construction: it refuses to drop any collection that still holds docs,
// and skips ones that are already absent. Idempotent.
//
// Run:
//   DRY_RUN=true npx tsx src/scripts/drop-orphan-collections.ts   # report only
//   npx tsx src/scripts/drop-orphan-collections.ts                # actually drop
// ============================================

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';

dotenv.config();

const DRY_RUN = String(process.env.DRY_RUN || 'false').toLowerCase() === 'true';

/** Known orphan collections (empty leftovers from renames). */
const ORPHANS = ['campaigncomparerequests'];

async function main(): Promise<void> {
    await connectDatabase();
    const db = mongoose.connection.db;
    if (!db) throw new Error('No database connection');

    const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));

    let dropped = 0;
    for (const name of ORPHANS) {
        if (!existing.has(name)) {
            console.log(`[orphan] skip ${name} (already absent)`);
            continue;
        }
        const count = await db.collection(name).countDocuments();
        if (count > 0) {
            console.warn(`[orphan] REFUSING to drop ${name} — it has ${count} docs (not an orphan)`);
            continue;
        }
        if (DRY_RUN) {
            console.log(`[orphan] DRY_RUN — would drop empty ${name}`);
            continue;
        }
        await db.collection(name).drop();
        dropped += 1;
        console.log(`[orphan] dropped empty ${name}`);
    }

    console.log(`[orphan] done (${DRY_RUN ? 'dry run' : `${dropped} dropped`})`);
    await mongoose.disconnect();
}

main().catch((err) => {
    console.error('[orphan] failed:', err);
    process.exit(1);
});
