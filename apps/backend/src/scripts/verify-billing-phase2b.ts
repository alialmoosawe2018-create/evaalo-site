/**
 * Phase 2b Stripe authority verification (requires MongoDB).
 *
 * Run from apps/backend:
 *   npx tsx src/scripts/verify-billing-phase2b.ts
 *
 * Strategy: feed 5 synthetic Stripe events through `dispatchStripeEvent`
 * end-to-end and assert org_plan_state, credit_balance, credit_ledger
 * reflect the expected transitions. No live Stripe API is contacted —
 * we only exercise the translator → runtime path that controls our Mongo
 * authority.
 *
 * Architecture invariants asserted:
 *   1. consumeCredits keeps reading exclusively from Mongo (no Stripe calls).
 *   2. isBillingActive() gates all access — past_due / canceled block.
 *   3. Every ledger entry carries metadata.planSnapshot WITH credit caps.
 *   4. ProcessedWebhook blocks duplicate event.id replays.
 *   5. applyInvoicePaid is race-safe — duplicate retry events and
 *      out-of-order (late period N) deliveries are no-ops.
 */

import '../loadEnv.js';
import mongoose from 'mongoose';
import type Stripe from 'stripe';
import { connectDatabase } from '../config/database.js';
import OrgPlanState from '../models/OrgPlanState.js';
import CreditBalance from '../models/CreditBalance.js';
import CreditLedger from '../models/CreditLedger.js';
import ProcessedWebhook from '../models/ProcessedWebhook.js';
import { dispatchStripeEvent } from '../services/stripeWebhookHandlers.js';
import { consumeCredits, getBillingStatus, markPendingCheckout, seedOrgBilling, applyCheckoutSession } from '../services/billingRuntimeService.js';
import { claimWebhook } from '../services/webhookIdempotency.js';
import { getMonthlyCredits } from '../services/billingEngine.js';
import { resolveSubscriptionLifecycleState } from '../services/billingLifecycle.js';
import { devOrgIdForUser } from '../config/multiTenant.js';
import { MICRO_PER_CREDIT } from '../types/billing.js';

const ORG = 'org_phase2b_verify';
const CUSTOMER_ID = 'cus_phase2b_verify';
const SUB_ID = 'sub_phase2b_verify';
const PRO_CREDITS = getMonthlyCredits('professional');
const EXPECTED_AFTER_CONSUME = PRO_CREDITS - 15;
const FAKE_PROFESSIONAL_MONTHLY = process.env.STRIPE_PRICE_PROFESSIONAL_MONTHLY || 'price_pro_monthly_test_fixture';

const FAILS: string[] = [];

function check(label: string, ok: boolean, detail?: string) {
    const line = `${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` ${detail}` : ''}`;
    console.log(line);
    if (!ok) FAILS.push(label);
}

function unix(seconds: number): number {
    return Math.floor(seconds);
}

function makeEvent<T>(id: string, type: string, object: T): Stripe.Event {
    return {
        id,
        object: 'event',
        api_version: '2024-11-20.acacia',
        created: unix(Date.now() / 1000),
        type,
        data: { object: object as unknown as Stripe.Event.Data.Object },
        livemode: false,
        pending_webhooks: 0,
        request: { id: null, idempotency_key: null },
    } as Stripe.Event;
}

async function cleanFixtures() {
    await OrgPlanState.deleteOne({ organizationId: ORG });
    await CreditBalance.deleteOne({ organizationId: ORG });
    await CreditLedger.deleteMany({ organizationId: ORG });
    await ProcessedWebhook.deleteMany({ idempotencyKey: { $regex: /^evt_p2b_verify_/ } });
}

async function main() {
    await connectDatabase();
    await cleanFixtures();

    if (!process.env.STRIPE_PRICE_PROFESSIONAL_MONTHLY) {
        console.warn(
            '[verify-2b] STRIPE_PRICE_PROFESSIONAL_MONTHLY not set — using fixture price ID. subscription.updated translator will likely skip unknown price (this is expected without Stripe env).',
        );
    }

    // ────────────────────────────────────────────────────────────────────
    // 1. checkout.session.completed (paid)
    // ────────────────────────────────────────────────────────────────────
    const checkoutSession = {
        id: 'cs_test_phase2b',
        object: 'checkout.session',
        mode: 'subscription',
        payment_status: 'paid',
        customer: CUSTOMER_ID,
        subscription: SUB_ID,
        client_reference_id: ORG,
        metadata: { organizationId: ORG, planId: 'professional', cycle: 'monthly' },
    };
    await dispatchStripeEvent(
        makeEvent('evt_p2b_verify_checkout', 'checkout.session.completed', checkoutSession),
    );

    const afterCheckout = await getBillingStatus(ORG);
    check('checkout → planId professional', afterCheckout.planId === 'professional');
    check('checkout → status active', afterCheckout.subscriptionStatus === 'active');
    check(
        `checkout → balance seeded ${PRO_CREDITS} credits`,
        afterCheckout.creditsRemaining === PRO_CREDITS,
        `(got ${afterCheckout.creditsRemaining})`,
    );

    // Architecture contract: consumeCredits reads from Mongo only (no Stripe).
    const consumeRes = await consumeCredits({
        organizationId: ORG,
        usageType: 'VOICE_SECONDS',
        units: 60,
        idempotencyKey: 'vi_end:phase2b_consume_1',
        source: 'video_interview',
        sourceId: 'phase2b_session_1',
    });
    check('consume after checkout ok', consumeRes.ok === true);
    if (consumeRes.ok) {
        check(
            `balanceAfterMicro = ${EXPECTED_AFTER_CONSUME} credits`,
            consumeRes.balanceAfterMicro === EXPECTED_AFTER_CONSUME * MICRO_PER_CREDIT,
            `(got ${consumeRes.balanceAfterMicro})`,
        );
    }

    const ledgerEntry = await CreditLedger.findOne({
        organizationId: ORG,
        idempotencyKey: 'vi_end:phase2b_consume_1',
    }).lean();
    const snapshot = (ledgerEntry?.metadata as Record<string, unknown> | undefined)?.planSnapshot as
        | {
              planId?: string;
              cycle?: string;
              subscriptionStatus?: string;
              monthlyCredits?: number;
          }
        | undefined;
    check(
        'ledger has metadata.planSnapshot',
        Boolean(snapshot && snapshot.planId === 'professional' && snapshot.subscriptionStatus === 'active'),
        `(got ${JSON.stringify(snapshot)})`,
    );
    // Immutable catalog snapshot must include the monthly credit allowance,
    // so future catalog changes never alter historical audit records.
    check(
        'ledger planSnapshot includes monthlyCredits',
        snapshot?.monthlyCredits === PRO_CREDITS,
        `(monthlyCredits=${snapshot?.monthlyCredits})`,
    );

    // ────────────────────────────────────────────────────────────────────
    // 2. customer.subscription.updated (cancel_at_period_end toggle)
    // ────────────────────────────────────────────────────────────────────
    const subUpdated = {
        id: SUB_ID,
        object: 'subscription',
        status: 'active',
        cancel_at_period_end: true,
        customer: CUSTOMER_ID,
        current_period_start: unix(Date.now() / 1000),
        current_period_end: unix(Date.now() / 1000 + 30 * 24 * 3600),
        items: {
            data: [
                {
                    id: 'si_test',
                    price: { id: FAKE_PROFESSIONAL_MONTHLY },
                    current_period_start: unix(Date.now() / 1000),
                    current_period_end: unix(Date.now() / 1000 + 30 * 24 * 3600),
                },
            ],
        },
    };
    await dispatchStripeEvent(
        makeEvent('evt_p2b_verify_sub_update', 'customer.subscription.updated', subUpdated),
    );

    const orgAfterUpdate = await OrgPlanState.findOne({ organizationId: ORG }).lean();
    if (process.env.STRIPE_PRICE_PROFESSIONAL_MONTHLY) {
        check(
            'subscription.updated set cancelAtPeriodEnd=true',
            orgAfterUpdate?.cancelAtPeriodEnd === true,
        );
    } else {
        console.log(
            '   (skipped subscription.updated assertion — STRIPE_PRICE_PROFESSIONAL_MONTHLY not configured; translator ignores unknown price IDs by design)',
        );
    }

    // ────────────────────────────────────────────────────────────────────
    // 3. invoice.payment_failed → status past_due → consumeCredits blocked
    // ────────────────────────────────────────────────────────────────────
    const invoiceFailed = {
        id: 'in_phase2b_fail',
        object: 'invoice',
        customer: CUSTOMER_ID,
        billing_reason: 'subscription_cycle',
    };
    await dispatchStripeEvent(
        makeEvent('evt_p2b_verify_invoice_failed', 'invoice.payment_failed', invoiceFailed),
    );

    const afterFail = await getBillingStatus(ORG);
    check('payment_failed → status past_due', afterFail.subscriptionStatus === 'past_due');

    const blockedRes = await consumeCredits({
        organizationId: ORG,
        usageType: 'VOICE_SECONDS',
        units: 60,
        idempotencyKey: 'vi_end:phase2b_blocked',
        source: 'video_interview',
        sourceId: 'phase2b_session_blocked',
    });
    check(
        'consume blocked while past_due',
        !blockedRes.ok && blockedRes.code === 'INACTIVE_SUBSCRIPTION',
        !blockedRes.ok ? `(${blockedRes.code})` : '(ok=true unexpectedly)',
    );

    // ────────────────────────────────────────────────────────────────────
    // 4. invoice.paid → status active + balance refreshed + ledger w/ snapshot
    // ────────────────────────────────────────────────────────────────────
    const invoicePaid = {
        id: 'in_phase2b_paid',
        object: 'invoice',
        customer: CUSTOMER_ID,
        billing_reason: 'subscription_cycle',
        lines: {
            data: [
                {
                    period: {
                        start: unix(Date.now() / 1000),
                        end: unix(Date.now() / 1000 + 30 * 24 * 3600),
                    },
                },
            ],
        },
    };
    await dispatchStripeEvent(
        makeEvent('evt_p2b_verify_invoice_paid', 'invoice.paid', invoicePaid),
    );

    const afterPaid = await getBillingStatus(ORG);
    check('invoice.paid → status active', afterPaid.subscriptionStatus === 'active');
    check(
        `invoice.paid → balance refreshed ${PRO_CREDITS} credits`,
        afterPaid.creditsRemaining === PRO_CREDITS,
        `(got ${afterPaid.creditsRemaining})`,
    );

    const refreshLedger = await CreditLedger.findOne({
        organizationId: ORG,
        idempotencyKey: 'stripe:invoice:in_phase2b_paid',
    }).lean();
    const refreshSnap = (refreshLedger?.metadata as Record<string, unknown> | undefined)?.planSnapshot as
        | { planId?: string }
        | undefined;
    check(
        'invoice.paid ledger has planSnapshot',
        Boolean(refreshSnap && refreshSnap.planId === 'professional'),
    );

    const orgAfterPaid = await OrgPlanState.findOne({ organizationId: ORG }).lean();
    const baselinePeriodEndMs = orgAfterPaid?.currentPeriodEnd?.getTime() ?? 0;
    check('invoice.paid set a future periodEnd', baselinePeriodEndMs > Date.now());

    // ────────────────────────────────────────────────────────────────────
    // 4A. Refinement #7 Case A — Duplicate invoice.paid (Stripe event retry).
    //
    // Stripe occasionally redelivers the same invoice with a different
    // event.id (network retry, replay after dashboard "resend"). After the
    // first invoice.paid we consume 1 credit so balance=299. A duplicate
    // invoice.paid for the SAME period MUST NOT refresh balance back to 300
    // and MUST NOT add a duplicate ledger entry.
    // ────────────────────────────────────────────────────────────────────
    const consumeBeforeDup = await consumeCredits({
        organizationId: ORG,
        usageType: 'VOICE_SECONDS',
        units: 60,
        idempotencyKey: 'vi_end:phase2b_pre_dup',
        source: 'video_interview',
        sourceId: 'phase2b_session_pre_dup',
    });
    check(
        `pre-dup consume ok (drives balance to ${EXPECTED_AFTER_CONSUME})`,
        consumeBeforeDup.ok === true &&
            consumeBeforeDup.balanceAfterMicro === EXPECTED_AFTER_CONSUME * MICRO_PER_CREDIT,
        consumeBeforeDup.ok
            ? `(balanceMicro=${consumeBeforeDup.balanceAfterMicro})`
            : `(${consumeBeforeDup.code})`,
    );

    const duplicateInvoicePaid = {
        id: 'in_phase2b_paid', // SAME invoice.id, SAME period — Stripe retry
        object: 'invoice',
        customer: CUSTOMER_ID,
        billing_reason: 'subscription_cycle',
        lines: {
            data: [
                {
                    period: {
                        start: unix(Date.now() / 1000),
                        end: unix(baselinePeriodEndMs / 1000), // identical periodEnd
                    },
                },
            ],
        },
    };
    await dispatchStripeEvent(
        makeEvent('evt_p2b_verify_invoice_paid_retry', 'invoice.paid', duplicateInvoicePaid),
    );

    const afterDup = await getBillingStatus(ORG);
    check(
        `duplicate invoice.paid did NOT refresh balance`,
        afterDup.creditsRemaining === EXPECTED_AFTER_CONSUME,
        `(creditsRemaining=${afterDup.creditsRemaining}, expected ${EXPECTED_AFTER_CONSUME})`,
    );

    const ledgerCountForInvoice = await CreditLedger.countDocuments({
        organizationId: ORG,
        idempotencyKey: 'stripe:invoice:in_phase2b_paid',
    });
    check(
        'duplicate invoice.paid did NOT add a second ledger entry',
        ledgerCountForInvoice === 1,
        `(count=${ledgerCountForInvoice})`,
    );

    // ────────────────────────────────────────────────────────────────────
    // 4B. Refinement #7 Case B — Out-of-order invoice.paid (late delivery).
    //
    // Stripe may deliver period-N invoice.paid AFTER period-N+1 already
    // landed. The race guard in applyInvoicePaid compares periodEnd: any
    // event whose periodEnd ≤ stored currentPeriodEnd is skipped. We assert
    // both that state.periodEnd does NOT regress and that balance is not
    // re-refreshed (would otherwise undo legitimate consumption since).
    // ────────────────────────────────────────────────────────────────────
    const lateInvoicePaid = {
        id: 'in_phase2b_paid_late',
        object: 'invoice',
        customer: CUSTOMER_ID,
        billing_reason: 'subscription_cycle',
        lines: {
            data: [
                {
                    period: {
                        start: unix(Date.now() / 1000 - 60 * 24 * 3600),
                        end: unix(Date.now() / 1000 - 30 * 24 * 3600), // FAR in the past
                    },
                },
            ],
        },
    };
    await dispatchStripeEvent(
        makeEvent('evt_p2b_verify_invoice_paid_late', 'invoice.paid', lateInvoicePaid),
    );

    const afterLate = await getBillingStatus(ORG);
    const orgAfterLate = await OrgPlanState.findOne({ organizationId: ORG }).lean();
    check(
        'out-of-order invoice.paid did NOT regress periodEnd',
        (orgAfterLate?.currentPeriodEnd?.getTime() ?? 0) === baselinePeriodEndMs,
        `(stored=${orgAfterLate?.currentPeriodEnd?.toISOString()} baseline=${new Date(baselinePeriodEndMs).toISOString()})`,
    );
    check(
        'out-of-order invoice.paid did NOT refresh balance',
        afterLate.creditsRemaining === EXPECTED_AFTER_CONSUME,
        `(creditsRemaining=${afterLate.creditsRemaining}, expected ${EXPECTED_AFTER_CONSUME})`,
    );
    const lateLedger = await CreditLedger.findOne({
        organizationId: ORG,
        idempotencyKey: 'stripe:invoice:in_phase2b_paid_late',
    }).lean();
    check(
        'out-of-order invoice.paid did NOT write a ledger entry',
        lateLedger === null,
    );

    // ────────────────────────────────────────────────────────────────────
    // 5. customer.subscription.deleted → canceled → blocks future consume
    // ────────────────────────────────────────────────────────────────────
    const subDeleted = {
        id: SUB_ID,
        object: 'subscription',
        status: 'canceled',
        customer: CUSTOMER_ID,
    };
    await dispatchStripeEvent(
        makeEvent('evt_p2b_verify_sub_deleted', 'customer.subscription.deleted', subDeleted),
    );

    const afterDelete = await getBillingStatus(ORG);
    check('subscription.deleted → status canceled', afterDelete.subscriptionStatus === 'canceled');

    const blockedAfterCancel = await consumeCredits({
        organizationId: ORG,
        usageType: 'VOICE_SECONDS',
        units: 60,
        idempotencyKey: 'vi_end:phase2b_cancel_blocked',
        source: 'video_interview',
        sourceId: 'phase2b_session_canceled',
    });
    check(
        'consume blocked after cancel',
        !blockedAfterCancel.ok && blockedAfterCancel.code === 'INACTIVE_SUBSCRIPTION',
    );

    // ────────────────────────────────────────────────────────────────────
    // 6. Lifecycle — pending checkout → subscription_active
    // ────────────────────────────────────────────────────────────────────
    const LIFECYCLE_ORG = 'org_phase2b_lifecycle';
    await OrgPlanState.deleteOne({ organizationId: LIFECYCLE_ORG });
    await CreditBalance.deleteOne({ organizationId: LIFECYCLE_ORG });
    await seedOrgBilling(LIFECYCLE_ORG, 'team');
    await markPendingCheckout(LIFECYCLE_ORG, {
        sessionId: 'cs_test_pending_lifecycle',
        planId: 'professional',
        cycle: 'monthly',
    });
    const pendingState = await OrgPlanState.findOne({ organizationId: LIFECYCLE_ORG }).lean();
    check(
        'lifecycle checkout_created while pending',
        resolveSubscriptionLifecycleState(pendingState) === 'checkout_created',
    );
    await applyCheckoutSession({
        organizationId: LIFECYCLE_ORG,
        planId: 'professional',
        cycle: 'monthly',
        stripeCustomerId: 'cus_lifecycle',
        stripeSubscriptionId: 'sub_lifecycle',
        activate: true,
    });
    const afterLifecycle = await getBillingStatus(LIFECYCLE_ORG);
    check(
        'lifecycle subscription_active after checkout apply',
        afterLifecycle.lifecycleState === 'subscription_active',
    );
    check('lifecycle clears pendingCheckoutPlanId', afterLifecycle.pendingCheckoutPlanId === null);
    const lifecycleDoc = await OrgPlanState.findOne({ organizationId: LIFECYCLE_ORG }).lean();
    check(
        'lifecycle clears pending session fields',
        !lifecycleDoc?.pendingCheckoutSessionId && !lifecycleDoc?.pendingCheckoutAt,
    );
    await OrgPlanState.deleteOne({ organizationId: LIFECYCLE_ORG });
    await CreditBalance.deleteOne({ organizationId: LIFECYCLE_ORG });

    // ────────────────────────────────────────────────────────────────────
    // 7. Dev org isolation — distinct dev_org_<userId> per user
    // ────────────────────────────────────────────────────────────────────
    check(
        'dev org id is per-user',
        devOrgIdForUser('user_a') !== devOrgIdForUser('user_b') &&
            devOrgIdForUser('user_a').startsWith('dev_org_'),
    );

    // ────────────────────────────────────────────────────────────────────
    // 8. Duplicate event.id → ProcessedWebhook blocks
    // ────────────────────────────────────────────────────────────────────
    const first = await claimWebhook('stripe', 'evt_p2b_verify_dup_check', { eventType: 'test' });
    const second = await claimWebhook('stripe', 'evt_p2b_verify_dup_check', { eventType: 'test' });
    check(
        'duplicate stripe event blocked',
        first.duplicate === false && second.duplicate === true,
    );

    await cleanFixtures();
    await ProcessedWebhook.deleteOne({ idempotencyKey: 'evt_p2b_verify_dup_check' });

    console.log('\n' + (FAILS.length === 0 ? 'ALL CHECKS PASS' : `FAILED: ${FAILS.join(', ')}`));
    await mongoose.disconnect();
    process.exit(FAILS.length === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
