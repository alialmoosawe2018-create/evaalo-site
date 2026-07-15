/**
 * Seed one local dev org with a catalog plan (no collection wipe).
 *
 * Run from apps/backend:
 *   npx tsx src/scripts/seed-local-billing.ts
 *
 * By user id (uses dev_org_<userId> when ENFORCE_AUTH=off):
 *   BILLING_SEED_USER_ID=user_local_test BILLING_SEED_PLAN=team npx tsx src/scripts/seed-local-billing.ts
 *
 * By explicit org id:
 *   BILLING_SEED_ORG_ID=dev_org_user_local_test BILLING_SEED_PLAN=professional npx tsx src/scripts/seed-local-billing.ts
 *
 * Refuses production unless SEED_LOCAL_BILLING_FORCE=true.
 */
import '../loadEnv.js';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { devOrgIdForUser } from '../config/multiTenant.js';
import { seedOrgBilling } from '../services/billingRuntimeService.js';
import { getPlanById } from '../services/billingEngine.js';
import type { BillingPlanId } from '../types/billing.js';

const VALID_PLAN_IDS: BillingPlanId[] = ['starter', 'team', 'professional', 'business'];

function resolveOrgId(): string {
    const explicit = process.env.BILLING_SEED_ORG_ID?.trim();
    if (explicit) return explicit;

    const userId = (process.env.BILLING_SEED_USER_ID || 'user_local_test').trim();
    return devOrgIdForUser(userId);
}

async function main(): Promise<void> {
    if (process.env.NODE_ENV === 'production' && process.env.SEED_LOCAL_BILLING_FORCE !== 'true') {
        console.error(
            '[seed-local-billing] Refusing to run in production. Set SEED_LOCAL_BILLING_FORCE=true to override.',
        );
        process.exit(1);
    }

    const planRaw = (process.env.BILLING_SEED_PLAN || 'team').trim();
    if (!VALID_PLAN_IDS.includes(planRaw as BillingPlanId) || !getPlanById(planRaw as BillingPlanId)) {
        console.error(
            `[seed-local-billing] Invalid BILLING_SEED_PLAN="${planRaw}". Use one of: ${VALID_PLAN_IDS.join(', ')}`,
        );
        process.exit(1);
    }
    const planId = planRaw as BillingPlanId;
    const orgId = resolveOrgId();

    await connectDatabase();

    const { orgPlanState, creditBalance } = await seedOrgBilling(orgId, planId);

    console.log('[seed-local-billing] Seeded local billing:');
    console.log(`  organizationId:  ${orgId}`);
    console.log(`  planId:          ${planId}`);
    console.log(`  status:          ${orgPlanState.subscriptionStatus}`);
    console.log(`  monthlyCredits:  ${creditBalance.monthlyCredits}`);
    console.log(`  balanceMicro:    ${creditBalance.balanceMicro}`);
    console.log('');
    console.log('Next steps:');
    console.log('  1. Ensure ENFORCE_AUTH=off and BILLING_DEV_TOOLS=true in .env');
    console.log('  2. GET /api/billing/status — org should match dev_org_* for your user');
    console.log('  3. For Stripe checkout, run: stripe listen --forward-to localhost:5000/webhook/stripe');

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
});
