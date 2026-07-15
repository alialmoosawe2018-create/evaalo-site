// ============================================
// Dev: migrate org_default → dev_org_<userId>
//   CLERK_USER_ID=user_xxx npm run migrate:dev-org
//   DRY_RUN=true — report only
// ============================================

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { migrateOrgDefaultToDevOrg } from '../services/devOrgMigrationService.js';

dotenv.config();

const userId = (process.env.CLERK_USER_ID || '').trim();
const DRY_RUN = String(process.env.DRY_RUN || 'false').toLowerCase() === 'true';

async function main(): Promise<void> {
    if (!userId) {
        console.error('Set CLERK_USER_ID=user_xxx');
        process.exit(1);
    }

    await connectDatabase();

    if (DRY_RUN) {
        console.log(`DRY_RUN: would migrate org_default → dev_org for ${userId}`);
        console.log('Run without DRY_RUN=true to apply.');
        await mongoose.disconnect();
        process.exit(0);
    }

    const result = await migrateOrgDefaultToDevOrg(userId);
    console.log(JSON.stringify(result, null, 2));
    await mongoose.disconnect();
    process.exit(result.ok ? 0 : 1);
}

main().catch(async (err) => {
    console.error(err);
    try {
        await mongoose.disconnect();
    } catch {
        /* ignore */
    }
    process.exit(1);
});
