/**
 * Clean cutover to the unified-credit billing model (DEV ONLY).
 *
 * Drops the legacy billing collections (credit_balances, org_plan_states,
 * credit_ledger) so the new microCredit schema seeds from scratch — there is
 * no data migration by design (pre-launch). Optionally re-seeds one org.
 *
 * Run from apps/backend:
 *   npx tsx src/scripts/reseed-billing.ts
 *   BILLING_SEED_ORG_ID=org_123 BILLING_SEED_PLAN=team npx tsx src/scripts/reseed-billing.ts
 *
 * Refuses to run when NODE_ENV=production unless RESEED_BILLING_FORCE=true.
 */
import '../loadEnv.js';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import OrgPlanState from '../models/OrgPlanState.js';
import CreditBalance from '../models/CreditBalance.js';
import CreditLedger from '../models/CreditLedger.js';
import { seedOrgBilling } from '../services/billingRuntimeService.js';
import { getPlanById } from '../services/billingEngine.js';
import type { BillingPlanId } from '../types/billing.js';

const VALID_PLAN_IDS: BillingPlanId[] = ['starter', 'team', 'professional', 'business'];

async function main(): Promise<void> {
    if (process.env.NODE_ENV === 'production' && process.env.RESEED_BILLING_FORCE !== 'true') {
        console.error(
            '[reseed-billing] Refusing to run in production. Set RESEED_BILLING_FORCE=true to override.',
        );
        process.exit(1);
    }

    await connectDatabase();

    const [balances, states, ledger] = await Promise.all([
        CreditBalance.deleteMany({}),
        OrgPlanState.deleteMany({}),
        CreditLedger.deleteMany({}),
    ]);

    console.log('[reseed-billing] Cleared legacy billing collections:');
    console.log(`  credit_balances:   ${balances.deletedCount}`);
    console.log(`  org_plan_states:   ${states.deletedCount}`);
    console.log(`  credit_ledger:     ${ledger.deletedCount}`);

    const seedOrg = process.env.BILLING_SEED_ORG_ID?.trim();
    const seedPlanRaw = (process.env.BILLING_SEED_PLAN || 'starter').trim();

    if (seedOrg) {
        if (!VALID_PLAN_IDS.includes(seedPlanRaw as BillingPlanId) || !getPlanById(seedPlanRaw as BillingPlanId)) {
            console.error(`[reseed-billing] Invalid BILLING_SEED_PLAN="${seedPlanRaw}". Use one of: ${VALID_PLAN_IDS.join(', ')}`);
            await mongoose.disconnect();
            process.exit(1);
        }
        const planId = seedPlanRaw as BillingPlanId;
        const { creditBalance } = await seedOrgBilling(seedOrg, planId);
        console.log(
            `[reseed-billing] Seeded org="${seedOrg}" plan="${planId}" balanceMicro=${creditBalance.balanceMicro} (${creditBalance.monthlyCredits} credits).`,
        );
    } else {
        console.log('[reseed-billing] No BILLING_SEED_ORG_ID provided — collections left empty.');
    }

    await mongoose.disconnect();
    console.log('[reseed-billing] Done.');
}

main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
});
