/**
 * Stripe Webhook Handlers (Phase 2b).
 *
 * Architecture Contract 2 — Handlers are TRANSLATORS only:
 *   1. Parse the Stripe payload and extract identifiers
 *   2. Resolve the organization (via metadata or stripeCustomerId)
 *   3. Dispatch to billingRuntimeService.apply*(...) — no Mongo writes here
 *
 * This keeps every state mutation replayable from admin actions, scheduled
 * jobs, and future migrations. Adding logic here directly = guaranteed drift.
 *
 * 5 events handled:
 *   - checkout.session.completed       → applyCheckoutSession
 *   - customer.subscription.updated    → applySubscriptionUpdate
 *   - customer.subscription.deleted    → applySubscriptionCanceled
 *   - invoice.paid                     → applyInvoicePaid
 *   - invoice.payment_failed           → applyPaymentFailed
 *
 * Unknown event types → no-op (route returns 200, Stripe stops retrying).
 */

import type Stripe from 'stripe';
import { resolvePlanForStripePrice } from '../config/stripePrices.js';
import type { BillingCycle, BillingPlanId, SubscriptionStatus } from '../types/billing.js';
import {
    applyCheckoutSession,
    applyInvoicePaid,
    applyPaymentFailed,
    applySetupCheckoutCompleted,
    applySubscriptionCanceled,
    applySubscriptionUpdate,
    applyVideoPackPurchase,
    findOrgByStripeCustomerId,
    isBillingActive,
} from './billingRuntimeService.js';
import { listCheckoutSessionLineItems, retrieveSubscription, getSubscriptionPeriodBounds, invalidateBillingReceiptsCache } from './stripeService.js';

// Stripe TS types omit some optional fields available at runtime; cast surface area
// is intentionally tiny and lives only in this translator file.

function unixToDate(seconds: number | null | undefined): Date | undefined {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return undefined;
    return new Date(seconds * 1000);
}

function extractStringMeta(
    meta: Stripe.Metadata | null | undefined,
    key: string,
): string | undefined {
    if (!meta) return undefined;
    const v = meta[key];
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function isBillingPlanId(value: unknown): value is BillingPlanId {
    return (
        value === 'starter' ||
        value === 'team' ||
        value === 'professional' ||
        value === 'business'
    );
}

function isBillingCycle(value: unknown): value is BillingCycle {
    return value === 'monthly' || value === 'annual';
}

function mapStripeStatusToInternal(status: Stripe.Subscription.Status): SubscriptionStatus {
    switch (status) {
        case 'active':
            return 'active';
        case 'trialing':
            return 'trialing';
        case 'past_due':
            return 'past_due';
        case 'canceled':
        case 'unpaid':
            return 'canceled';
        case 'incomplete':
        case 'incomplete_expired':
        case 'paused':
        default:
            return 'incomplete';
    }
}

function pickFirstSubscriptionItem(
    sub: Stripe.Subscription,
): { priceId: string | null; periodStart?: Date; periodEnd?: Date } {
    const items = sub.items?.data ?? [];
    if (items.length === 0) {
        return { priceId: null };
    }
    const item = items[0];
    const itemRaw = item as unknown as {
        price?: { id?: string };
        current_period_start?: number;
        current_period_end?: number;
    };
    return {
        priceId: itemRaw.price?.id ?? null,
        periodStart: unixToDate(itemRaw.current_period_start),
        periodEnd: unixToDate(itemRaw.current_period_end),
    };
}

function readSubscriptionPeriod(sub: Stripe.Subscription): {
    periodStart?: Date;
    periodEnd?: Date;
} {
    // Stripe moved period dates onto subscription_items in 2024-11-20 API.
    const fromItem = pickFirstSubscriptionItem(sub);
    if (fromItem.periodStart || fromItem.periodEnd) {
        return { periodStart: fromItem.periodStart, periodEnd: fromItem.periodEnd };
    }
    const legacy = sub as unknown as {
        current_period_start?: number;
        current_period_end?: number;
    };
    return {
        periodStart: unixToDate(legacy.current_period_start),
        periodEnd: unixToDate(legacy.current_period_end),
    };
}

function readInvoicePeriod(invoice: Stripe.Invoice): {
    periodStart?: Date;
    periodEnd?: Date;
} {
    const line = invoice.lines?.data?.[0];
    if (line?.period) {
        return {
            periodStart: unixToDate(line.period.start),
            periodEnd: unixToDate(line.period.end),
        };
    }
    return {};
}

// ────────────────────────────────────────────────────────────────────────────
// 1. checkout.session.completed
// ────────────────────────────────────────────────────────────────────────────

export async function handleCheckoutCompleted(
    session: Stripe.Checkout.Session,
): Promise<void> {
    if (session.mode === 'setup') {
        await applySetupCheckoutCompleted(session);
        console.log(
            `[stripe] checkout.completed setup applied — session=${session.id} cust=${typeof session.customer === 'string' ? session.customer : session.customer?.id}`,
        );
        return;
    }

    // One-time video-pack purchase (mode: 'payment'). Credits purchasedVideoSeconds
    // idempotently; never touches the credit balance or the subscription.
    if (
        session.mode === 'payment' &&
        extractStringMeta(session.metadata, 'purchaseType') === 'video_pack'
    ) {
        await handleVideoPackCheckout(session);
        return;
    }

    if (session.mode !== 'subscription') {
        console.log(`[stripe] checkout.completed ignored — mode=${session.mode}`);
        return;
    }

    const organizationId =
        extractStringMeta(session.metadata, 'organizationId') ||
        (typeof session.client_reference_id === 'string'
            ? session.client_reference_id
            : undefined);
    const planIdMeta = extractStringMeta(session.metadata, 'planId');
    const cycleMeta = extractStringMeta(session.metadata, 'cycle');
    const stripeCustomerId =
        typeof session.customer === 'string'
            ? session.customer
            : session.customer?.id;
    const stripeSubscriptionId =
        typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id;

    if (!organizationId || !stripeCustomerId || !stripeSubscriptionId) {
        console.warn(
            `[stripe] checkout.completed missing required identifiers — ignoring. org=${organizationId} cust=${stripeCustomerId} sub=${stripeSubscriptionId}`,
        );
        return;
    }

    // Canonical plan identity comes from the priceId on the actual line item.
    // metadata is a dashboard-editable hint — useful as a fast-path / fallback,
    // but priceId is the only source we trust for authority decisions.
    let resolvedPlanId: BillingPlanId | undefined;
    let resolvedCycle: BillingCycle | undefined;
    try {
        const lineItems = await listCheckoutSessionLineItems(session.id, 1);
        const priceId = lineItems[0]?.price?.id;
        if (priceId) {
            const fromPrice = resolvePlanForStripePrice(priceId);
            if (fromPrice) {
                resolvedPlanId = fromPrice.planId;
                resolvedCycle = fromPrice.cycle;
                if (
                    isBillingPlanId(planIdMeta) &&
                    isBillingCycle(cycleMeta) &&
                    (fromPrice.planId !== planIdMeta || fromPrice.cycle !== cycleMeta)
                ) {
                    console.warn(
                        `[stripe] checkout.completed metadata/priceId mismatch — trusting priceId. meta=(${planIdMeta},${cycleMeta}) price=(${fromPrice.planId},${fromPrice.cycle}) priceId=${priceId}`,
                    );
                }
            } else {
                console.warn(
                    `[stripe] checkout.completed priceId=${priceId} not in STRIPE_PRICE_TO_PLAN — falling back to metadata.`,
                );
            }
        }
    } catch (err) {
        console.warn(
            `[stripe] checkout.completed failed to fetch line items — falling back to metadata. err=${(err as Error)?.message}`,
        );
    }

    if (!resolvedPlanId && isBillingPlanId(planIdMeta)) resolvedPlanId = planIdMeta;
    if (!resolvedCycle && isBillingCycle(cycleMeta)) resolvedCycle = cycleMeta;

    if (!resolvedPlanId || !resolvedCycle) {
        console.warn(
            `[stripe] checkout.completed could not resolve (planId, cycle) — meta=(${planIdMeta},${cycleMeta}). Ignoring.`,
        );
        return;
    }

    const activate = session.payment_status === 'paid';

    let currentPeriodStart: Date | undefined;
    let currentPeriodEnd: Date | undefined;
    try {
        const sub = await retrieveSubscription(stripeSubscriptionId);
        if (sub) {
            const bounds = getSubscriptionPeriodBounds(sub);
            currentPeriodStart = bounds.periodStart;
            currentPeriodEnd = bounds.periodEnd;
        }
    } catch (err) {
        console.warn(
            `[stripe] checkout.completed failed to read subscription period — sub=${stripeSubscriptionId} err=${(err as Error)?.message}`,
        );
    }

    await applyCheckoutSession({
        organizationId,
        planId: resolvedPlanId,
        cycle: resolvedCycle,
        stripeCustomerId,
        stripeSubscriptionId,
        currentPeriodStart,
        currentPeriodEnd,
        activate,
    });

    console.log(
        `[stripe] checkout.completed applied — org=${organizationId} plan=${resolvedPlanId} cycle=${resolvedCycle} activate=${activate}`,
    );
}

/**
 * Credit a paid one-time video-pack checkout.
 *
 * Idempotency key is derived from the PaymentIntent (falling back to the session
 * id) so Stripe retries / duplicate deliveries grant the minutes exactly once.
 */
async function handleVideoPackCheckout(session: Stripe.Checkout.Session): Promise<void> {
    if (session.payment_status !== 'paid') {
        console.log(
            `[stripe] video_pack checkout ignored — payment_status=${session.payment_status} session=${session.id}`,
        );
        return;
    }

    const organizationId =
        extractStringMeta(session.metadata, 'organizationId') ||
        (typeof session.client_reference_id === 'string'
            ? session.client_reference_id
            : undefined);
    const minutesMeta = extractStringMeta(session.metadata, 'minutes');
    const minutes = minutesMeta ? Number.parseInt(minutesMeta, 10) : NaN;

    if (!organizationId || !Number.isFinite(minutes) || minutes <= 0) {
        console.warn(
            `[stripe] video_pack checkout missing/invalid metadata — org=${organizationId} minutes=${minutesMeta}. Ignoring.`,
        );
        return;
    }

    const paymentIntentId =
        typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id;
    const idempotencyKey = `stripe:videopack:${paymentIntentId || session.id}`;

    const result = await applyVideoPackPurchase(organizationId, minutes, idempotencyKey, {
        stripeSessionId: session.id,
        stripePaymentIntentId: paymentIntentId,
        planId: extractStringMeta(session.metadata, 'planId'),
    });

    console.log(
        `[stripe] video_pack checkout ${result.applied ? 'applied' : 'duplicate-ignored'} — org=${organizationId} minutes=${minutes} key=${idempotencyKey}`,
    );
}

// ────────────────────────────────────────────────────────────────────────────
// 2. customer.subscription.updated
// ────────────────────────────────────────────────────────────────────────────

export async function handleSubscriptionUpdated(
    sub: Stripe.Subscription,
): Promise<void> {
    const { priceId } = pickFirstSubscriptionItem(sub);
    if (!priceId) {
        console.warn(`[stripe] subscription.updated has no price — sub=${sub.id}`);
        return;
    }

    const mapping = resolvePlanForStripePrice(priceId);
    if (!mapping) {
        console.warn(
            `[stripe] subscription.updated unknown price=${priceId} sub=${sub.id} — ignoring (likely test mode mismatch).`,
        );
        return;
    }

    const { periodStart, periodEnd } = readSubscriptionPeriod(sub);
    if (!periodStart || !periodEnd) {
        console.warn(
            `[stripe] subscription.updated missing period dates — sub=${sub.id}; falling back to existing state period.`,
        );
    }

    await applySubscriptionUpdate({
        stripeSubscriptionId: sub.id,
        planId: mapping.planId,
        cycle: mapping.cycle,
        currentPeriodStart: periodStart ?? new Date(),
        currentPeriodEnd:
            periodEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
        subscriptionStatus: mapStripeStatusToInternal(sub.status),
    });

    console.log(
        `[stripe] subscription.updated applied — sub=${sub.id} plan=${mapping.planId} status=${sub.status}`,
    );
}

// ────────────────────────────────────────────────────────────────────────────
// 3. customer.subscription.deleted
// ────────────────────────────────────────────────────────────────────────────

export async function handleSubscriptionDeleted(
    sub: Stripe.Subscription,
): Promise<void> {
    await applySubscriptionCanceled({ stripeSubscriptionId: sub.id });
    console.log(`[stripe] subscription.deleted applied — sub=${sub.id}`);
}

// ────────────────────────────────────────────────────────────────────────────
// 4. invoice.paid
// ────────────────────────────────────────────────────────────────────────────

export async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
    const stripeCustomerId =
        typeof invoice.customer === 'string'
            ? invoice.customer
            : invoice.customer?.id;
    if (!stripeCustomerId) {
        console.warn(`[stripe] invoice.paid missing customer — invoice=${invoice.id}`);
        return;
    }

    // Skip the very first invoice that arrives right after checkout — it's already
    // handled by applyCheckoutSession (which seeded the balance). Detect via
    // billing_reason='subscription_create'. Recurring invoices use 'subscription_cycle'.
    // Contract 5: route through isBillingActive() — never inline status === checks.
    if (invoice.billing_reason === 'subscription_create') {
        const existing = await findOrgByStripeCustomerId(stripeCustomerId);
        if (existing && isBillingActive(existing.subscriptionStatus)) {
            console.log(
                `[stripe] invoice.paid skipped — first invoice already handled by checkout.completed (org=${existing.organizationId}, invoice=${invoice.id}).`,
            );
            return;
        }
    }

    const { periodStart, periodEnd } = readInvoicePeriod(invoice);
    await applyInvoicePaid({
        stripeCustomerId,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        stripeInvoiceId: invoice.id ?? undefined,
    });

    // A new paid invoice just landed — drop the receipts cache so it shows at once.
    invalidateBillingReceiptsCache(stripeCustomerId);

    console.log(`[stripe] invoice.paid applied — invoice=${invoice.id} cust=${stripeCustomerId}`);
}

// ────────────────────────────────────────────────────────────────────────────
// 5. invoice.payment_failed
// ────────────────────────────────────────────────────────────────────────────

export async function handleInvoicePaymentFailed(
    invoice: Stripe.Invoice,
): Promise<void> {
    const stripeCustomerId =
        typeof invoice.customer === 'string'
            ? invoice.customer
            : invoice.customer?.id;
    if (!stripeCustomerId) {
        console.warn(
            `[stripe] invoice.payment_failed missing customer — invoice=${invoice.id}`,
        );
        return;
    }

    await applyPaymentFailed({
        stripeCustomerId,
        stripeInvoiceId: invoice.id ?? undefined,
    });

    console.log(
        `[stripe] invoice.payment_failed applied — invoice=${invoice.id} cust=${stripeCustomerId}`,
    );
}

// ────────────────────────────────────────────────────────────────────────────
// Dispatcher — single entry point for the webhook route
// ────────────────────────────────────────────────────────────────────────────

export const HANDLED_EVENT_TYPES = [
    'checkout.session.completed',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.paid',
    'invoice.payment_failed',
] as const;

export type HandledEventType = (typeof HANDLED_EVENT_TYPES)[number];

export async function dispatchStripeEvent(event: Stripe.Event): Promise<{ handled: boolean }> {
    switch (event.type) {
        case 'checkout.session.completed':
            await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
            return { handled: true };
        case 'customer.subscription.updated':
            await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
            return { handled: true };
        case 'customer.subscription.deleted':
            await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
            return { handled: true };
        case 'invoice.paid':
            await handleInvoicePaid(event.data.object as Stripe.Invoice);
            return { handled: true };
        case 'invoice.payment_failed':
            await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
            return { handled: true };
        default:
            return { handled: false };
    }
}
