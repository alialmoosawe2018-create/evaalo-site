/**
 * Billing health reconciliation — read-only report (default) or expire stale reservations.
 *
 * Usage:
 *   npx tsx src/scripts/reconcile-billing-health.ts
 *   npx tsx src/scripts/reconcile-billing-health.ts --expire-reservations
 *   npx tsx src/scripts/reconcile-billing-health.ts --org=dev_org_abc
 */
import '../loadEnv.js';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import OrgPlanState from '../models/OrgPlanState.js';
import CreditBalance from '../models/CreditBalance.js';
import UsageReservation from '../models/UsageReservation.js';
import ProcessedWebhook from '../models/ProcessedWebhook.js';
import { expireStaleReservations } from '../services/usageReservationService.js';

function parseOrg(argv: string[]): string | undefined {
    const arg = argv.find((a) => a.startsWith('--org='));
    return arg ? arg.slice('--org='.length).trim() : undefined;
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    const orgFilter = parseOrg(argv);
    const expireReservations = argv.includes('--expire-reservations');

    await connectDatabase();

    const now = new Date();
    const staleProcessingMs = 15 * 60 * 1000;

    const orgQuery = orgFilter ? { organizationId: orgFilter } : {};
    const orgCount = await OrgPlanState.countDocuments(orgQuery);
    const balanceCount = await CreditBalance.countDocuments(orgQuery);

    const activeResFilter = {
        ...orgQuery,
        status: 'active',
        expiresAt: { $gt: now },
    };
    const activeReservations = await UsageReservation.find(activeResFilter)
        .select('organizationId source sourceId reservedMicro expiresAt')
        .lean()
        .exec();

    const expiredActive = await UsageReservation.countDocuments({
        ...orgQuery,
        status: 'active',
        expiresAt: { $lte: now },
    });

    const stuckWebhooks = await ProcessedWebhook.countDocuments({
        status: 'processing',
        updatedAt: { $lte: new Date(now.getTime() - staleProcessingMs) },
    });

    const failedWebhooks = await ProcessedWebhook.countDocuments({ status: 'failed' });

    console.log('=== Billing health report ===');
    console.log(`orgs (plan state): ${orgCount}`);
    console.log(`credit balances:   ${balanceCount}`);
    console.log(`active reservations: ${activeReservations.length}`);
    console.log(`expired-but-active reservations: ${expiredActive}`);
    console.log(`stuck webhook processing (>15m): ${stuckWebhooks}`);
    console.log(`failed webhooks: ${failedWebhooks}`);

    if (activeReservations.length > 0) {
        console.log('\nActive reservations:');
        for (const r of activeReservations.slice(0, 20)) {
            console.log(
                `  ${r.organizationId} ${r.source}/${r.sourceId} reservedMicro=${r.reservedMicro} expires=${r.expiresAt?.toISOString()}`,
            );
        }
        if (activeReservations.length > 20) {
            console.log(`  ... and ${activeReservations.length - 20} more`);
        }
    }

    if (expiredActive > 0 || argv.includes('--expire-reservations')) {
        const expired = await expireStaleReservations(orgFilter);
        console.log(`\nExpired stale reservations: ${expired}`);
    }

    const issues =
        expiredActive +
        stuckWebhooks +
        failedWebhooks +
        (activeReservations.length > 50 ? 1 : 0);

    if (issues === 0) {
        console.log('\nOK — no actionable billing health issues detected.');
    } else {
        console.log(`\nWARN — ${issues} issue class(es) need review (see above).`);
        process.exitCode = 1;
    }

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
