// ============================================
// scripts/prune-candidate-indexes.ts
// Drops low-value indexes on `candidates` that the schema no longer declares:
//   - entryStage_1 / sourceType_1  → low-cardinality single-field indexes
//   - email_1                      → redundant with the unique organizationId_1_email_1 compound
//
// This is an OPS step (run at deploy), not part of app boot. It is idempotent and
// safe: it never touches _id_ or the unique tenant compound, and skips any index
// that is already absent.
//
// Run:
//   DRY_RUN=true npx tsx src/scripts/prune-candidate-indexes.ts   # report only
//   npx tsx src/scripts/prune-candidate-indexes.ts                # actually drop
// ============================================

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';

dotenv.config();

const DRY_RUN = String(process.env.DRY_RUN || 'false').toLowerCase() === 'true';

/** Indexes to drop, by name. */
const DROP_INDEXES = ['entryStage_1', 'sourceType_1', 'email_1'];
/** Never drop these regardless of the list above. */
const PROTECTED = new Set(['_id_', 'organizationId_1_email_1']);

async function main(): Promise<void> {
    await connectDatabase();
    const db = mongoose.connection.db;
    if (!db) throw new Error('No database connection');
    const col = db.collection('candidates');

    const existing = await col.indexes();
    const existingNames = new Set(existing.map((i) => i.name));
    console.log(
        `[prune] candidates has ${existing.length} indexes: ${[...existingNames].join(', ')}`,
    );

    let dropped = 0;
    for (const name of DROP_INDEXES) {
        if (PROTECTED.has(name)) {
            console.log(`[prune] SKIP protected index ${name}`);
            continue;
        }
        if (!existingNames.has(name)) {
            console.log(`[prune] skip ${name} (not present)`);
            continue;
        }
        if (DRY_RUN) {
            console.log(`[prune] DRY_RUN — would drop ${name}`);
            continue;
        }
        await col.dropIndex(name);
        dropped += 1;
        console.log(`[prune] dropped ${name}`);
    }

    console.log(`[prune] done (${DRY_RUN ? 'dry run' : `${dropped} dropped`})`);
    await mongoose.disconnect();
}

main().catch((err) => {
    console.error('[prune] failed:', err);
    process.exit(1);
});
