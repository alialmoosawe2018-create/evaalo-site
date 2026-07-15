/**
 * Stripe SDK Wrapper (Phase 2b).
 *
 * Owns:
 *   - Singleton Stripe client (pinned apiVersion for safety on upgrades)
 *   - Customer creation + persistence on OrgPlanState
 *   - Checkout session creation with idempotency
 *   - Subscription cancel / resume
 *   - Invoice listing for the custom billing portal
 *   - Webhook signature verification
 *
 * Architecture contract: this file is a thin SDK adapter — no business logic.
 * Mongo writes other than `stripeCustomerId` persistence belong in
 * `billingRuntimeService.ts`.
 */

import Stripe from 'stripe';
import OrgPlanState from '../models/OrgPlanState.js';
import { getStripePriceId, getVideoPackStripePriceId, resolvePlanForStripePrice } from '../config/stripePrices.js';
import { VIDEO_PACK_MINUTES } from '../config/videoPacks.js';
import type { BillingCycle, BillingPlanId, SubscriptionStatus } from '../types/billing.js';
import {
    applySubscriptionUpdate,
    getOrgPlanState,
} from './billingRuntimeService.js';
import { ensureBillingPortalConfiguration } from './stripePortalConfig.js';

const STRIPE_API_VERSION = '2024-11-20.acacia' as const;

let stripeSingleton: Stripe | null = null;

export function getStripeClient(): Stripe {
    if (stripeSingleton) return stripeSingleton;
    const key = (process.env.STRIPE_SECRET_KEY || '').trim();
    if (!key) {
        throw new Error(
            '[stripeService] STRIPE_SECRET_KEY is missing — cannot create Stripe client. Set it in apps/backend/.env.',
        );
    }
    stripeSingleton = new Stripe(key, {
        apiVersion: STRIPE_API_VERSION as unknown as Stripe.LatestApiVersion,
        typescript: true,
        appInfo: { name: 'evaalo-billing', version: '2b' },
    });
    return stripeSingleton;
}

/**
 * true عندما يكون مفتاح Stripe في وضع live (sk_live_...). يُستخدم لحراسة العمليات
 * المدمّرة (مثل حذف الحساب) من ترك اشتراك فعّال يستمر بالدفع.
 */
export function isStripeLiveMode(): boolean {
    return (process.env.STRIPE_SECRET_KEY || '').trim().startsWith('sk_live_');
}

/**
 * Reset the singleton — primarily for tests. Production code should never call.
 */
export function __resetStripeClientForTests(): void {
    stripeSingleton = null;
}

function appPublicUrl(): string {
    return (
        (process.env.APP_PUBLIC_URL || process.env.FRONTEND_URL || 'http://localhost:3000').replace(
            /\/$/,
            '',
        )
    );
}

/** Public HTTPS logo for Stripe Checkout branding (localhost URLs are rejected by Stripe). */
function checkoutBrandingLogoUrl(): string | undefined {
    const explicit = (process.env.STRIPE_CHECKOUT_LOGO_URL || '').trim();
    if (explicit) return explicit;
    const base = appPublicUrl();
    if (/localhost|127\.0\.0\.1/i.test(base)) {
        return 'https://www.evaalo.com/images/last%20logo.png';
    }
    return `${base}/images/last%20logo.png`;
}

/** Stripe Checkout branding block — SDK types may lag behind the live API. */
type CheckoutBrandingSettings = {
    display_name: string;
    button_color: string;
    background_color: string;
    border_style: 'rounded';
    font_family: string;
    logo?: { type: 'url'; url: string };
    icon?: { type: 'url'; url: string };
};

type CheckoutSessionAppearancePayload = {
    branding_settings: CheckoutBrandingSettings;
    wallet_options: { link: { display: 'auto' | 'never' } };
};

/**
 * evaalo-themed Stripe Checkout appearance + skip Link OTP (card entry only).
 * Link UI is Stripe-hosted and cannot be CSS-customized from our app.
 */
function buildCheckoutSessionAppearance(): CheckoutSessionAppearancePayload {
    const displayName = (process.env.STRIPE_CHECKOUT_DISPLAY_NAME || 'evaalo').trim();
    const buttonColor = (process.env.STRIPE_CHECKOUT_BUTTON_COLOR || '#0ea5e9').trim();
    const backgroundColor = (process.env.STRIPE_CHECKOUT_BACKGROUND_COLOR || '#0f172a').trim();
    const linkDisplayRaw = (process.env.STRIPE_CHECKOUT_LINK_DISPLAY || 'never').trim().toLowerCase();
    const linkDisplay: 'auto' | 'never' = linkDisplayRaw === 'auto' ? 'auto' : 'never';
    const logoUrl = checkoutBrandingLogoUrl();

    const branding_settings: CheckoutBrandingSettings = {
        display_name: displayName,
        button_color: buttonColor,
        background_color: backgroundColor,
        border_style: 'rounded',
        font_family: 'inter',
    };
    if (logoUrl) {
        branding_settings.logo = { type: 'url', url: logoUrl };
        branding_settings.icon = { type: 'url', url: logoUrl };
    }

    return {
        branding_settings,
        wallet_options: { link: { display: linkDisplay } },
    };
}

/** Cast only the branding payload when merging into SessionCreateParams. */
function checkoutAppearanceForStripe(): Stripe.Checkout.SessionCreateParams {
    return buildCheckoutSessionAppearance() as Stripe.Checkout.SessionCreateParams;
}

/**
 * Ensure the organization has a Stripe customer ID. Persists on OrgPlanState
 * the first time a customer is created.
 */
export async function getOrCreateCustomer(
    organizationId: string,
    email?: string,
): Promise<string> {
    const existing = await OrgPlanState.findOne({ organizationId }).exec();
    if (existing?.stripeCustomerId) return existing.stripeCustomerId;

    const stripe = getStripeClient();
    const customer = await stripe.customers.create(
        {
            email: email || undefined,
            metadata: { organizationId },
        },
        {
            idempotencyKey: `org:${organizationId}:customer:create`,
        },
    );

    await OrgPlanState.updateOne(
        { organizationId },
        { $set: { stripeCustomerId: customer.id } },
        { upsert: false },
    ).exec();

    return customer.id;
}

export interface CreateCheckoutInput {
    organizationId: string;
    planId: BillingPlanId;
    cycle: BillingCycle;
    customerEmail?: string;
    userId?: string;
    /** Client-generated idempotency token (UUID) — dedupes double-clicks. */
    requestId?: string;
    successUrl?: string;
    cancelUrl?: string;
}

export interface CreateCheckoutResult {
    url: string;
    sessionId: string;
    reused?: boolean;
}

async function findReusableSubscriptionCheckout(
    stripe: Stripe,
    customerId: string,
    organizationId: string,
    planId: BillingPlanId,
    cycle: BillingCycle,
): Promise<Stripe.Checkout.Session | null> {
    const sessions = await stripe.checkout.sessions.list({
        customer: customerId,
        status: 'open',
        limit: 20,
    });
    const now = Math.floor(Date.now() / 1000);
    for (const session of sessions.data) {
        if (session.mode !== 'subscription') continue;
        if (session.metadata?.organizationId !== organizationId) continue;
        if (session.metadata?.planId !== planId) continue;
        if (session.metadata?.cycle !== cycle) continue;
        if (session.expires_at && session.expires_at < now) continue;
        if (session.url) return session;
    }
    return null;
}

function checkoutMetadata(input: {
    organizationId: string;
    userId?: string;
    planId: BillingPlanId;
    cycle: BillingCycle;
    requestId?: string;
}): Record<string, string> {
    return {
        organizationId: input.organizationId,
        userId: input.userId?.trim() || '',
        planId: input.planId,
        cycle: input.cycle,
        requestId: input.requestId?.trim() || '',
    };
}

/**
 * Create a Stripe Checkout session for a paid subscription.
 * All 4 plans are paid; throws if the plan/cycle price env var is missing.
 */
export async function createCheckoutSession(
    input: CreateCheckoutInput,
): Promise<CreateCheckoutResult> {
    const { organizationId, planId, cycle, customerEmail, userId, requestId } = input;

    const priceId = getStripePriceId(planId, cycle);
    if (!priceId) {
        throw new Error(
            `[stripeService] No Stripe price configured for plan=${planId} cycle=${cycle}. Check STRIPE_PRICE_* env vars.`,
        );
    }

    const customerId = await getOrCreateCustomer(organizationId, customerEmail);
    const base = appPublicUrl();
    // planId في الرابط يجعل فحص جاهزية صفحة النجاح مطابقة دقيقة للباقة
    // (لا الاكتفاء بحالة active) — أمتن عند تعدد جلسات الدفع.
    const successUrl =
        input.successUrl ||
        `${base}/account/billing/success?session_id={CHECKOUT_SESSION_ID}&planId=${encodeURIComponent(planId)}`;
    const cancelUrl = input.cancelUrl || `${base}/account/billing/cancel`;

    const stripe = getStripeClient();
    const meta = checkoutMetadata({ organizationId, userId, planId, cycle, requestId });

    const reusable = await findReusableSubscriptionCheckout(
        stripe,
        customerId,
        organizationId,
        planId,
        cycle,
    );
    if (reusable?.url) {
        return { url: reusable.url, sessionId: reusable.id, reused: true };
    }

    const idempotencyKey = requestId
        ? `org:${organizationId}:checkout:${planId}:${cycle}:${requestId}`
        : `org:${organizationId}:checkout:${planId}:${cycle}:${Math.floor(Date.now() / 60_000)}`;

    const session = await stripe.checkout.sessions.create(
        {
            mode: 'subscription',
            customer: customerId,
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: successUrl,
            cancel_url: cancelUrl,
            allow_promotion_codes: true,
            client_reference_id: organizationId,
            metadata: meta,
            subscription_data: {
                metadata: meta,
            },
            ...checkoutAppearanceForStripe(),
        },
        { idempotencyKey },
    );

    if (!session.url) {
        throw new Error('[stripeService] Stripe did not return a checkout URL.');
    }

    return { url: session.url, sessionId: session.id };
}

export interface CreateVideoPackCheckoutInput {
    organizationId: string;
    planId: BillingPlanId;
    /** Number of packs to buy (each = VIDEO_PACK_MINUTES minutes). Default 1. */
    quantity?: number;
    customerEmail?: string;
    userId?: string;
    requestId?: string;
    successUrl?: string;
    cancelUrl?: string;
}

/**
 * Create a ONE-TIME Stripe Checkout session (`mode: 'payment'`) for an extra
 * video-minutes pack. The webhook (`handleCheckoutCompleted`) credits
 * purchasedVideoSeconds idempotently using the payment metadata.
 *
 * Throws if the plan has no configured pack price (e.g. Starter, or env unset).
 */
export async function createVideoPackCheckout(
    input: CreateVideoPackCheckoutInput,
): Promise<CreateCheckoutResult> {
    const { organizationId, planId, customerEmail } = input;
    const quantity = Math.max(1, Math.floor(input.quantity ?? 1));

    const priceId = getVideoPackStripePriceId(planId);
    if (!priceId) {
        throw new Error(
            `[stripeService] No video-pack price configured for plan=${planId}. Check STRIPE_PRICE_VIDEOPACK_* env vars.`,
        );
    }

    const customerId = await getOrCreateCustomer(organizationId, customerEmail);
    const base = appPublicUrl();
    const minutes = VIDEO_PACK_MINUTES * quantity;
    const successUrl =
        input.successUrl ||
        `${base}/account/billing/success?purchase=video_pack&minutes=${minutes}`;
    const cancelUrl = input.cancelUrl || `${base}/account/billing/cancel`;
    const stripe = getStripeClient();
    const idempotencyKey = input.requestId
        ? `org:${organizationId}:videopack:${planId}:${quantity}:${input.requestId}`
        : `org:${organizationId}:videopack:${planId}:${quantity}:${Math.floor(Date.now() / 60_000)}`;

    const packMeta = {
        purchaseType: 'video_pack',
        organizationId,
        userId: input.userId?.trim() || '',
        planId,
        minutes: String(minutes),
        quantity: String(quantity),
        requestId: input.requestId?.trim() || '',
    };

    const session = await stripe.checkout.sessions.create(
        {
            mode: 'payment',
            customer: customerId,
            line_items: [{ price: priceId, quantity }],
            success_url: successUrl,
            cancel_url: cancelUrl,
            client_reference_id: organizationId,
            metadata: packMeta,
            payment_intent_data: {
                metadata: packMeta,
            },
            invoice_creation: {
                enabled: true,
                invoice_data: {
                    description: `Video pack — ${minutes} minutes`,
                    metadata: packMeta,
                },
            },
            ...checkoutAppearanceForStripe(),
        },
        { idempotencyKey },
    );

    if (!session.url) {
        throw new Error('[stripeService] Stripe did not return a checkout URL.');
    }

    return { url: session.url, sessionId: session.id };
}

export async function cancelSubscription(
    stripeSubscriptionId: string,
    atPeriodEnd = true,
): Promise<Stripe.Subscription> {
    const stripe = getStripeClient();
    return stripe.subscriptions.update(stripeSubscriptionId, {
        cancel_at_period_end: atPeriodEnd,
    });
}

export async function resumeSubscription(
    stripeSubscriptionId: string,
): Promise<Stripe.Subscription> {
    const stripe = getStripeClient();
    return stripe.subscriptions.update(stripeSubscriptionId, {
        cancel_at_period_end: false,
    });
}

export async function listInvoices(
    customerId: string,
    limit = 10,
): Promise<Stripe.Invoice[]> {
    const stripe = getStripeClient();
    const result = await stripe.invoices.list({
        customer: customerId,
        limit,
        expand: ['data.lines.data.price'],
    });
    return result.data;
}

/** Normalized row for billing UI (subscription invoices + one-time checkout receipts). */
export type BillingReceiptRow = {
    id: string;
    number: string | null;
    status: string;
    amountPaidCents: number;
    amountDueCents: number;
    currency: string;
    createdAt: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    hostedInvoiceUrl: string | null;
    pdfUrl: string | null;
    planId: BillingPlanId | null;
    billingCycle: BillingCycle | null;
    description: string | null;
    kind: 'invoice' | 'payment';
};

function mapStripeInvoiceToReceiptRow(inv: Stripe.Invoice): BillingReceiptRow {
    const line = inv.lines?.data?.[0];
    const rawPrice = line?.price;
    const priceId = typeof rawPrice === 'string' ? rawPrice : rawPrice?.id;
    const mapped = priceId ? resolvePlanForStripePrice(priceId) : null;
    return {
        id: inv.id,
        number: inv.number,
        status: inv.status ?? 'paid',
        amountPaidCents: inv.amount_paid ?? 0,
        amountDueCents: inv.amount_due ?? 0,
        currency: inv.currency ?? 'usd',
        createdAt: inv.created ? new Date(inv.created * 1000).toISOString() : null,
        periodStart: inv.period_start ? new Date(inv.period_start * 1000).toISOString() : null,
        periodEnd: inv.period_end ? new Date(inv.period_end * 1000).toISOString() : null,
        hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
        pdfUrl: inv.invoice_pdf ?? null,
        planId: mapped?.planId ?? null,
        billingCycle: mapped?.cycle ?? null,
        description: line?.description ?? inv.description ?? null,
        kind: 'invoice',
    };
}

function isBillingPlanId(value: unknown): value is BillingPlanId {
    return (
        value === 'starter' ||
        value === 'team' ||
        value === 'professional' ||
        value === 'business'
    );
}

/**
 * One-time Checkout (`mode: payment`) receipts — e.g. video packs.
 * Subscription renewals appear in `listInvoices` instead.
 */
export async function listPaymentCheckoutReceipts(
    customerId: string,
    limit = 24,
    skipInvoiceIds: Set<string> = new Set(),
): Promise<BillingReceiptRow[]> {
    const stripe = getStripeClient();
    const sessions = await stripe.checkout.sessions.list({
        customer: customerId,
        limit: Math.min(100, limit * 3),
        expand: ['data.payment_intent.latest_charge'],
    });

    const rows: BillingReceiptRow[] = [];
    for (const session of sessions.data) {
        if (session.mode !== 'payment' || session.payment_status !== 'paid') continue;

        const invoiceRef =
            typeof session.invoice === 'string' ? session.invoice : session.invoice?.id;
        if (invoiceRef && skipInvoiceIds.has(invoiceRef)) continue;

        const meta = session.metadata ?? {};
        const minutes = meta.minutes;
        const isVideoPack = meta.purchaseType === 'video_pack';

        let hostedInvoiceUrl: string | null = null;
        if (invoiceRef) {
            try {
                const inv = await stripe.invoices.retrieve(invoiceRef);
                hostedInvoiceUrl = inv.hosted_invoice_url ?? null;
            } catch {
                /* fall through to charge receipt */
            }
        }
        if (!hostedInvoiceUrl) {
            const pi = session.payment_intent;
            const charge =
                pi && typeof pi === 'object' && pi.latest_charge && typeof pi.latest_charge === 'object'
                    ? pi.latest_charge
                    : null;
            hostedInvoiceUrl = charge?.receipt_url ?? null;
        }

        const description = isVideoPack
            ? `Video pack — ${minutes || VIDEO_PACK_MINUTES} minutes`
            : 'One-time payment';

        rows.push({
            id: session.id,
            number: session.id.replace(/^cs_/, '').slice(0, 12),
            status: 'paid',
            amountPaidCents: session.amount_total ?? 0,
            amountDueCents: session.amount_total ?? 0,
            currency: session.currency ?? 'usd',
            createdAt: session.created ? new Date(session.created * 1000).toISOString() : null,
            periodStart: null,
            periodEnd: null,
            hostedInvoiceUrl,
            pdfUrl: null,
            planId: isBillingPlanId(meta.planId) ? meta.planId : null,
            billingCycle: null,
            description,
            kind: 'payment',
        });
        if (rows.length >= limit) break;
    }
    return rows;
}

/** Subscription invoices + one-time payment receipts, newest first, de-duplicated. */
export async function listBillingReceipts(
    customerId: string,
    limit = 24,
): Promise<BillingReceiptRow[]> {
    const fetchLimit = Math.min(50, Math.max(limit, 10));
    const [invoices] = await Promise.all([
        listInvoices(customerId, fetchLimit),
    ]);

    const invoiceRows = invoices.map(mapStripeInvoiceToReceiptRow);
    const invoiceIds = new Set(invoiceRows.map((r) => r.id));

    const paymentRows = await listPaymentCheckoutReceipts(customerId, fetchLimit, invoiceIds);

    return [...invoiceRows, ...paymentRows]
        .sort((a, b) => {
            const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
            const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
            return tb - ta;
        })
        .slice(0, limit);
}

function stripeKeyFingerprint(key: string): string | null {
    const match = key.trim().match(/^(?:pk|sk)_(?:test|live)_(.+)$/);
    if (!match) return null;
    return match[1].slice(0, 7);
}

/** Secret + publishable keys must belong to the same Stripe account or Elements will not render. */
export function assertStripeKeyPairMatch(): void {
    const secret = (process.env.STRIPE_SECRET_KEY || '').trim();
    const publishable = (process.env.STRIPE_PUBLISHABLE_KEY || '').trim();
    if (!secret || !publishable) return;

    const secretFp = stripeKeyFingerprint(secret);
    const publishableFp = stripeKeyFingerprint(publishable);
    if (secretFp && publishableFp && secretFp !== publishableFp) {
        throw new Error(
            '[stripeService] STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY are from different Stripe accounts. ' +
                'Copy both keys from the same Dashboard → API keys page.',
        );
    }
}

export function getStripePublishableKey(): string {
    const key = (process.env.STRIPE_PUBLISHABLE_KEY || '').trim();
    if (!key) {
        throw new Error(
            '[stripeService] STRIPE_PUBLISHABLE_KEY is missing — required for embedded payment method UI.',
        );
    }
    assertStripeKeyPairMatch();
    return key;
}

export interface EmbeddedSetupIntentResult {
    clientSecret: string;
    setupIntentId: string;
    publishableKey: string;
}

/**
 * Embedded SetupIntent for in-app Payment Element (no Stripe Checkout redirect).
 */
export async function createEmbeddedSetupIntent(
    organizationId: string,
): Promise<EmbeddedSetupIntentResult> {
    assertStripeKeyPairMatch();
    const customerId = await getOrCreateCustomer(organizationId);
    const stripe = getStripeClient();
    const setupIntent = await stripe.setupIntents.create({
        customer: customerId,
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
        usage: 'off_session',
        metadata: { organizationId },
    });
    if (!setupIntent.client_secret) {
        throw new Error('[stripeService] Stripe did not return a SetupIntent client_secret.');
    }
    return {
        clientSecret: setupIntent.client_secret,
        setupIntentId: setupIntent.id,
        publishableKey: getStripePublishableKey(),
    };
}

async function attachDefaultPaymentMethod(
    customerId: string,
    paymentMethodId: string,
): Promise<void> {
    const stripe = getStripeClient();
    await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
    });

    const orgState = await OrgPlanState.findOne({ stripeCustomerId: customerId }).exec();
    if (orgState?.stripeSubscriptionId) {
        await stripe.subscriptions.update(orgState.stripeSubscriptionId, {
            default_payment_method: paymentMethodId,
        });
    }
}

/**
 * Stripe-hosted SetupIntent flow (legacy redirect). Prefer createEmbeddedSetupIntent.
 */
export async function createSetupIntentUrl(
    organizationId: string,
    returnUrl?: string,
): Promise<string> {
    const customerId = await getOrCreateCustomer(organizationId);
    const stripe = getStripeClient();
    const base = appPublicUrl();
    const portalReturn = `${base}/account/billing/portal?stripe_return=1`;
    const session = await stripe.checkout.sessions.create({
        mode: 'setup',
        customer: customerId,
        success_url:
            returnUrl ||
            `${portalReturn}&setup=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: returnUrl || `${portalReturn}&setup=cancel`,
        payment_method_types: ['card'],
        ...checkoutAppearanceForStripe(),
    });
    if (!session.url) {
        throw new Error('[stripeService] Stripe did not return a setup URL.');
    }
    return session.url;
}

/**
 * After a setup-mode Checkout session, attach the saved payment method as the
 * customer's default and on the active subscription (if any).
 */
export async function finalizeSetupCheckoutSession(
    session: Stripe.Checkout.Session,
    expectedOrganizationId?: string,
): Promise<void> {
    if (session.mode !== 'setup') {
        throw new Error('[stripeService] finalizeSetupCheckoutSession expects setup mode.');
    }

    const customerId =
        typeof session.customer === 'string' ? session.customer : session.customer?.id;
    if (!customerId) {
        throw new Error('[stripeService] setup session missing customer.');
    }

    if (expectedOrganizationId) {
        const state = await OrgPlanState.findOne({ organizationId: expectedOrganizationId }).exec();
        if (!state?.stripeCustomerId || state.stripeCustomerId !== customerId) {
            throw new Error('[stripeService] setup session customer mismatch for organization.');
        }
    }

    const stripe = getStripeClient();
    let setupIntent: Stripe.SetupIntent;
    if (typeof session.setup_intent === 'string') {
        setupIntent = await stripe.setupIntents.retrieve(session.setup_intent);
    } else if (session.setup_intent && typeof session.setup_intent === 'object') {
        setupIntent = session.setup_intent as Stripe.SetupIntent;
    } else {
        throw new Error('[stripeService] setup session missing setup_intent.');
    }

    const paymentMethodId =
        typeof setupIntent.payment_method === 'string'
            ? setupIntent.payment_method
            : setupIntent.payment_method?.id;
    if (!paymentMethodId) {
        throw new Error('[stripeService] setup intent missing payment_method.');
    }

    await attachDefaultPaymentMethod(customerId, paymentMethodId);
}

export async function finalizeSetupIntentById(
    organizationId: string,
    setupIntentId: string,
): Promise<void> {
    const stripe = getStripeClient();
    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
    if (setupIntent.status !== 'succeeded') {
        throw new Error('[stripeService] setup intent is not succeeded.');
    }

    const customerId =
        typeof setupIntent.customer === 'string'
            ? setupIntent.customer
            : setupIntent.customer?.id;
    if (!customerId) {
        throw new Error('[stripeService] setup intent missing customer.');
    }

    const state = await OrgPlanState.findOne({ organizationId }).exec();
    if (!state?.stripeCustomerId || state.stripeCustomerId !== customerId) {
        throw new Error('[stripeService] setup intent customer mismatch for organization.');
    }

    const paymentMethodId =
        typeof setupIntent.payment_method === 'string'
            ? setupIntent.payment_method
            : setupIntent.payment_method?.id;
    if (!paymentMethodId) {
        throw new Error('[stripeService] setup intent missing payment_method.');
    }

    await attachDefaultPaymentMethod(customerId, paymentMethodId);
}

export async function finalizeSetupCheckoutSessionById(
    organizationId: string,
    sessionId: string,
): Promise<void> {
    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['setup_intent'],
    });
    if (session.status !== 'complete') {
        throw new Error('[stripeService] setup checkout session is not complete.');
    }
    await finalizeSetupCheckoutSession(session, organizationId);
}

/**
 * Fetch the line items for a completed checkout session. Used by webhook handlers
 * to verify priceId as the canonical source of truth (metadata is a dashboard-editable
 * hint and cannot be trusted as authority).
 */
export async function listCheckoutSessionLineItems(
    sessionId: string,
    limit = 1,
): Promise<Stripe.LineItem[]> {
    const stripe = getStripeClient();
    const result = await stripe.checkout.sessions.listLineItems(sessionId, { limit });
    return result.data;
}

/**
 * Retrieve a single subscription (used by /portal/summary).
 */
export async function retrieveSubscription(
    stripeSubscriptionId: string,
): Promise<Stripe.Subscription | null> {
    try {
        const stripe = getStripeClient();
        return await stripe.subscriptions.retrieve(stripeSubscriptionId, {
            expand: ['default_payment_method', 'latest_invoice', 'items.data.price', 'schedule'],
        });
    } catch (err) {
        if ((err as Stripe.errors.StripeError)?.code === 'resource_missing') return null;
        throw err;
    }
}

const PLAN_RANK: Record<BillingPlanId, number> = {
    starter: 0,
    team: 1,
    professional: 2,
    business: 3,
};

export class BillingPlanChangeError extends Error {
    code: string;
    reason?: string;

    constructor(message: string, code: string, reason?: string) {
        super(message);
        this.name = 'BillingPlanChangeError';
        this.code = code;
        this.reason = reason;
    }
}

function mapStripeSubscriptionStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
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
        default:
            return 'incomplete';
    }
}

/** Read Stripe subscription period bounds (item-level first, then legacy sub fields). */
export function getSubscriptionPeriodBounds(sub: Stripe.Subscription): {
    periodStart: Date;
    periodEnd: Date;
} {
    const item = sub.items?.data?.[0] as
        | { current_period_start?: number; current_period_end?: number }
        | undefined;
    const startSec = item?.current_period_start ?? (sub as { current_period_start?: number }).current_period_start;
    const endSec = item?.current_period_end ?? (sub as { current_period_end?: number }).current_period_end;
    const now = Math.floor(Date.now() / 1000);
    return {
        periodStart: new Date((startSec ?? now) * 1000),
        periodEnd: new Date((endSec ?? now + 30 * 24 * 3600) * 1000),
    };
}

function isSubscriptionPlanUpgrade(
    current: { planId: BillingPlanId; cycle: BillingCycle },
    next: { planId: BillingPlanId; cycle: BillingCycle },
): boolean {
    const currentRank = PLAN_RANK[current.planId];
    const nextRank = PLAN_RANK[next.planId];
    if (nextRank !== currentRank) return nextRank > currentRank;
    return current.cycle === 'monthly' && next.cycle === 'annual';
}

export type ChangeSubscriptionPlanResult =
    | { switched: true }
    | { kind: 'downgrade_scheduled'; effectiveAt: number };

/**
 * Upgrade immediately (prorated invoice) or schedule a downgrade at period end.
 */
export async function changeSubscriptionPlan(input: {
    organizationId: string;
    planId: BillingPlanId;
    cycle: BillingCycle;
}): Promise<ChangeSubscriptionPlanResult> {
    const { organizationId, planId, cycle } = input;
    const state = await getOrgPlanState(organizationId);

    if (!state?.stripeSubscriptionId) {
        throw new BillingPlanChangeError('No active subscription', 'NO_ACTIVE_SUBSCRIPTION');
    }

    if (state.planId === planId && state.billingCycle === cycle) {
        return { switched: true };
    }

    const newPriceId = getStripePriceId(planId, cycle);
    if (!newPriceId) {
        throw new BillingPlanChangeError(
            `No Stripe price configured for plan=${planId} cycle=${cycle}`,
            'PRICE_NOT_CONFIGURED',
        );
    }

    const sub = await retrieveSubscription(state.stripeSubscriptionId);
    if (!sub || (sub.status !== 'active' && sub.status !== 'trialing')) {
        throw new BillingPlanChangeError('No active subscription', 'NO_ACTIVE_SUBSCRIPTION');
    }

    const item = sub.items.data[0];
    if (!item?.id) {
        throw new BillingPlanChangeError('Subscription has no billable items', 'INVALID_SUBSCRIPTION');
    }

    const upgrading = isSubscriptionPlanUpgrade(
        { planId: state.planId, cycle: state.billingCycle },
        { planId, cycle },
    );

    const stripe = getStripeClient();

    if (upgrading) {
        try {
            const updated = await stripe.subscriptions.update(state.stripeSubscriptionId, {
                items: [{ id: item.id, price: newPriceId }],
                proration_behavior: 'always_invoice',
                payment_behavior: 'error_if_incomplete',
                metadata: { organizationId, planId, cycle },
            });

            const mapping = resolvePlanForStripePrice(newPriceId);
            const { periodStart, periodEnd } = getSubscriptionPeriodBounds(updated);
            if (mapping) {
                await applySubscriptionUpdate({
                    stripeSubscriptionId: updated.id,
                    planId: mapping.planId,
                    cycle: mapping.cycle,
                    currentPeriodStart: periodStart,
                    currentPeriodEnd: periodEnd,
                    cancelAtPeriodEnd: Boolean(updated.cancel_at_period_end),
                    subscriptionStatus: mapStripeSubscriptionStatus(updated.status),
                });
            }

            return { switched: true };
        } catch (err) {
            const stripeErr = err as Stripe.errors.StripeError;
            if (stripeErr?.type === 'StripeCardError') {
                throw new BillingPlanChangeError(
                    stripeErr.message || 'Payment failed',
                    'PAYMENT_FAILED',
                    'card_declined',
                );
            }
            if (
                stripeErr?.code === 'invoice_payment_intent_requires_action' ||
                stripeErr?.code === 'payment_intent_authentication_failure'
            ) {
                throw new BillingPlanChangeError(
                    'Payment requires authentication',
                    'PAYMENT_FAILED',
                    'authentication_required',
                );
            }
            throw err;
        }
    }

    const currentPriceId =
        typeof item.price === 'string' ? item.price : item.price?.id;
    if (!currentPriceId) {
        throw new BillingPlanChangeError('Could not resolve current subscription price', 'INVALID_SUBSCRIPTION');
    }

    const periodEnd =
        getSubscriptionPeriodBounds(sub).periodEnd.getTime() / 1000;

    if (sub.schedule) {
        const scheduleId = typeof sub.schedule === 'string' ? sub.schedule : sub.schedule.id;
        await stripe.subscriptionSchedules.release(scheduleId);
    }

    const schedule = await stripe.subscriptionSchedules.create({
        from_subscription: state.stripeSubscriptionId,
    });

    const phaseStart = schedule.phases[0]?.start_date ?? Math.floor(Date.now() / 1000);

    await stripe.subscriptionSchedules.update(schedule.id, {
        end_behavior: 'release',
        phases: [
            {
                items: [{ price: currentPriceId, quantity: 1 }],
                start_date: phaseStart,
                end_date: periodEnd,
            },
            {
                items: [{ price: newPriceId, quantity: 1 }],
                start_date: periodEnd,
            },
        ],
    });

    return { kind: 'downgrade_scheduled', effectiveAt: periodEnd };
}

export type BillingPortalIntent = 'manage' | 'add_payment_method' | 'cancel';

/** Drop a pending subscription schedule so portal plan changes can proceed. */
async function releaseSubscriptionScheduleIfPresent(
    sub: Stripe.Subscription,
    stripe: Stripe,
): Promise<void> {
    if (!sub.schedule) return;
    const scheduleId = typeof sub.schedule === 'string' ? sub.schedule : sub.schedule.id;
    await stripe.subscriptionSchedules.release(scheduleId);
}

function billingPortalReturnUrl(suffix = ''): string {
    const base = appPublicUrl();
    return suffix ? `${base}${suffix.startsWith('/') ? suffix : `/${suffix}`}` : `${base}/account/billing`;
}

type PortalSessionCreateParams = Stripe.BillingPortal.SessionCreateParams;

/**
 * Stripe-hosted Customer Portal — manage billing, update card, or cancel.
 */
export async function createBillingPortalSession(input: {
    organizationId: string;
    customerEmail?: string;
    intent?: BillingPortalIntent;
    returnUrl?: string;
}): Promise<{ url: string }> {
    const { organizationId, customerEmail, intent = 'manage' } = input;
    const customerId = await getOrCreateCustomer(organizationId, customerEmail);
    const returnUrl = input.returnUrl || billingPortalReturnUrl('/account/billing?stripe_return=1');
    const portalConfigId = await ensureBillingPortalConfiguration();
    const stripe = getStripeClient();

    const params: PortalSessionCreateParams = {
        customer: customerId,
        return_url: returnUrl,
        configuration: portalConfigId,
    };

    if (intent === 'add_payment_method') {
        params.flow_data = {
            type: 'payment_method_update',
            after_completion: {
                type: 'redirect',
                redirect: { return_url: returnUrl },
            },
        };
    } else if (intent === 'cancel') {
        const state = await getOrgPlanState(organizationId);
        if (!state?.stripeSubscriptionId) {
            throw new BillingPlanChangeError('No active subscription', 'NO_ACTIVE_SUBSCRIPTION');
        }
        params.flow_data = {
            type: 'subscription_cancel',
            subscription_cancel: { subscription: state.stripeSubscriptionId },
            after_completion: {
                type: 'redirect',
                redirect: { return_url: returnUrl },
            },
        };
    }

    const session = await stripe.billingPortal.sessions.create(params);
    if (!session.url) {
        throw new Error('[stripeService] Stripe did not return a billing portal URL.');
    }
    return { url: session.url };
}

export type PlanChangePortalResult =
    | { kind: 'portal'; url: string }
    | { kind: 'already_on_plan'; planId: BillingPlanId; cycle: BillingCycle };

/**
 * Stripe-hosted confirmation page for an existing subscription plan change
 * (upgrade or downgrade). Customer reviews proration/charges before confirming.
 *
 * When Stripe already bills the requested price, reconciles Mongo and returns
 * `already_on_plan` instead of opening a no-op portal session.
 */
export async function createPlanChangePortalSession(input: {
    organizationId: string;
    planId: BillingPlanId;
    cycle: BillingCycle;
    customerEmail?: string;
}): Promise<PlanChangePortalResult> {
    const { organizationId, planId, cycle, customerEmail } = input;
    const { reconcileOrgPlanWithStripe } = await import('./billingRuntimeService.js');

    try {
        await reconcileOrgPlanWithStripe(organizationId);
    } catch (err) {
        console.warn('[stripe] pre-portal reconcile skipped:', (err as Error).message);
    }

    const state = await getOrgPlanState(organizationId);

    if (!state?.stripeSubscriptionId) {
        throw new BillingPlanChangeError('No active subscription', 'NO_ACTIVE_SUBSCRIPTION');
    }

    const newPriceId = getStripePriceId(planId, cycle);
    if (!newPriceId) {
        throw new BillingPlanChangeError(
            `No Stripe price configured for plan=${planId} cycle=${cycle}`,
            'PRICE_NOT_CONFIGURED',
        );
    }

    const sub = await retrieveSubscription(state.stripeSubscriptionId);
    if (!sub || (sub.status !== 'active' && sub.status !== 'trialing')) {
        throw new BillingPlanChangeError('No active subscription', 'NO_ACTIVE_SUBSCRIPTION');
    }

    const item = sub.items.data[0];
    if (!item?.id) {
        throw new BillingPlanChangeError('Subscription has no billable items', 'INVALID_SUBSCRIPTION');
    }

    const currentPriceId =
        typeof item.price === 'string' ? item.price : item.price?.id;
    if (currentPriceId === newPriceId) {
        return { kind: 'already_on_plan', planId, cycle };
    }

    const stripe = getStripeClient();
    await releaseSubscriptionScheduleIfPresent(sub, stripe);

    const customerId = await getOrCreateCustomer(organizationId, customerEmail);
    const returnUrl = billingPortalReturnUrl(
        `/account/billing/success?source=plan_change&planId=${encodeURIComponent(planId)}`,
    );
    const portalConfigId = await ensureBillingPortalConfiguration();

    try {
        const session = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: returnUrl,
            configuration: portalConfigId,
            flow_data: {
                type: 'subscription_update_confirm',
                subscription_update_confirm: {
                    subscription: state.stripeSubscriptionId,
                    items: [{ id: item.id, price: newPriceId, quantity: 1 }],
                },
                after_completion: {
                    type: 'redirect',
                    redirect: { return_url: returnUrl },
                },
            },
        });

        if (!session.url) {
            throw new Error('[stripeService] Stripe did not return a plan-change portal URL.');
        }
        return { kind: 'portal', url: session.url };
    } catch (err) {
        const stripeErr = err as Stripe.errors.StripeError;
        if (
            stripeErr?.type === 'StripeInvalidRequestError' &&
            typeof stripeErr.message === 'string' &&
            stripeErr.message.includes('no changes to confirm')
        ) {
            await reconcileOrgPlanWithStripe(organizationId);
            return { kind: 'already_on_plan', planId, cycle };
        }
        throw err;
    }
}

/**
 * Verify a Stripe webhook signature and return the parsed event.
 * Throws if invalid — caller (route) maps to 400.
 */
export function verifyWebhookSignature(
    rawBody: Buffer | string,
    signatureHeader: string | undefined,
): Stripe.Event {
    if (!signatureHeader) {
        throw new Error('[stripeService] Missing Stripe-Signature header.');
    }
    const secret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
    if (!secret) {
        throw new Error(
            '[stripeService] STRIPE_WEBHOOK_SECRET is missing — refusing to accept webhooks.',
        );
    }
    const stripe = getStripeClient();
    return stripe.webhooks.constructEvent(rawBody, signatureHeader, secret);
}
