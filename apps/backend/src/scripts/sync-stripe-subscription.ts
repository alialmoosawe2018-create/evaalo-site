/**
 * Reconcile local org_plan_state with live Stripe subscriptions.
 *
 * Usage:
 *   npx tsx src/scripts/sync-stripe-subscription.ts --dry-run
 *   npx tsx src/scripts/sync-stripe-subscription.ts --mirror-only --apply
 *   npx tsx src/scripts/sync-stripe-subscription.ts --repair-approved --apply
 *
 * Flags:
 *   --dry-run          Report only (default when --apply is omitted)
 *   --mirror-only      Sync plan/status/periods only (uses applyCheckoutSession)
 *   --repair-approved  Same write path as mirror-only (explicit operator approval)
 *   --apply            Perform Mongo writes (required with mirror/repair modes)
 *   --org=<id>         Limit to one organizationId
 */
import path from 'path';
import { fileURLToPath } from 'url';

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Stripe from 'stripe';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

type SyncMode = 'dry-run' | 'mirror-only' | 'repair-approved';

interface SyncAction {
    organizationId: string;
    action: 'skip' | 'sync' | 'cancel' | 'unmapped';
    detail: string;
}

function parseArgs(argv: string[]): {
    mode: SyncMode;
    apply: boolean;
    orgFilter?: string;
} {
    const apply = argv.includes('--apply');
    let mode: SyncMode = 'dry-run';
    if (argv.includes('--repair-approved')) mode = 'repair-approved';
    else if (argv.includes('--mirror-only')) mode = 'mirror-only';

    if (!apply) mode = 'dry-run';

    const orgArg = argv.find((a) => a.startsWith('--org='));
    const orgFilter = orgArg ? orgArg.slice('--org='.length).trim() : undefined;
    return { mode, apply, orgFilter };
}

async function main(): Promise<void> {
    const { mode, apply, orgFilter } = parseArgs(process.argv.slice(2));
    const uri = process.env.MONGODB_URI?.trim();
    const secret = process.env.STRIPE_SECRET_KEY?.trim();
    if (!uri) throw new Error('MONGODB_URI missing');
    if (!secret) throw new Error('STRIPE_SECRET_KEY missing');

    await mongoose.connect(uri);
    const { resolvePlanForStripePrice } = await import('../config/stripePrices.js');
    const { applyCheckoutSession, applySubscriptionCanceled } = await import(
        '../services/billingRuntimeService.js'
    );
    const OrgPlanState = (await import('../models/OrgPlanState.js')).default;

    const stripe = new Stripe(secret);
    const query: Record<string, unknown> = {
        stripeCustomerId: { $exists: true, $ne: null },
    };
    if (orgFilter) query.organizationId = orgFilter;

    const orgs = await OrgPlanState.find(query).exec();
    console.log(
        `[sync-stripe] mode=${mode} apply=${apply} orgs=${orgs.length}${orgFilter ? ` filter=${orgFilter}` : ''}`,
    );

    const actions: SyncAction[] = [];

    for (const org of orgs) {
        const customerId = org.stripeCustomerId!;
        const subs = await stripe.subscriptions.list({
            customer: customerId,
            status: 'all',
            limit: 10,
        });

        const byNewest = (a: Stripe.Subscription, b: Stripe.Subscription) =>
            b.created - a.created;
        const isLive = (s: Stripe.Subscription) =>
            s.status === 'active' || s.status === 'trialing';
        const sub =
            subs.data
                .filter((s) => isLive(s) && !s.cancel_at_period_end)
                .sort(byNewest)[0] ||
            subs.data.filter(isLive).sort(byNewest)[0] ||
            subs.data.slice().sort(byNewest)[0];

        if (!sub) {
            actions.push({
                organizationId: org.organizationId,
                action: 'skip',
                detail: 'no subscription on Stripe',
            });
            continue;
        }

        const item = sub.items.data[0];
        const priceId = item?.price?.id;
        const mapping = priceId ? resolvePlanForStripePrice(priceId) : null;
        if (!mapping) {
            actions.push({
                organizationId: org.organizationId,
                action: 'unmapped',
                detail: `unknown price ${priceId ?? 'null'}`,
            });
            continue;
        }

        const periodEnd = (item as unknown as { current_period_end?: number })
            .current_period_end;
        const periodStart = (item as unknown as { current_period_start?: number })
            .current_period_start;

        const localSummary = `local plan=${org.planId} status=${org.subscriptionStatus}`;
        const stripeSummary = `stripe plan=${mapping.planId} cycle=${mapping.cycle} status=${sub.status} sub=${sub.id}`;

        if (sub.status === 'canceled' || sub.status === 'unpaid') {
            actions.push({
                organizationId: org.organizationId,
                action: 'cancel',
                detail: `${stripeSummary}; ${localSummary}`,
            });
            if (apply) {
                await applySubscriptionCanceled({ stripeSubscriptionId: sub.id });
            }
            continue;
        }

        actions.push({
            organizationId: org.organizationId,
            action: 'sync',
            detail: `${stripeSummary}; ${localSummary}`,
        });

        if (apply) {
            await applyCheckoutSession({
                organizationId: org.organizationId,
                planId: mapping.planId,
                cycle: mapping.cycle,
                stripeCustomerId: customerId,
                stripeSubscriptionId: sub.id,
                currentPeriodStart: periodStart ? new Date(periodStart * 1000) : undefined,
                currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : undefined,
                activate: sub.status === 'active' || sub.status === 'trialing',
            });
        }
    }

    for (const row of actions) {
        const prefix = apply ? 'APPLIED' : 'DRY-RUN';
        console.log(`[${prefix}] ${row.organizationId} ${row.action}: ${row.detail}`);
    }

    const summary = actions.reduce(
        (acc, row) => {
            acc[row.action] = (acc[row.action] ?? 0) + 1;
            return acc;
        },
        {} as Record<string, number>,
    );
    console.log('[sync-stripe] summary:', summary);

    await mongoose.disconnect();
    console.log('Done.');
}

main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
});
