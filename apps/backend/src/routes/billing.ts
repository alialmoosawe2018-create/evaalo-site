/**
 * Billing API routes — Phase 2a runtime + Phase 2b Stripe.
 *
 * Phase 2a:
 *   GET  /api/billing/status  — org plan + live balances (auth required)
 *   POST /api/billing/seed    — dev/admin: initialize org billing state
 *   POST /api/billing/adjust  — dev/admin: manual credit adjustment
 *
 * Phase 2b (Stripe custom portal):
 *   POST /api/billing/checkout                 — start Stripe Checkout, returns URL
 *   GET  /api/billing/portal/summary           — current subscription summary
 *   GET  /api/billing/portal/invoices          — list recent invoices
 *   POST /api/billing/portal/cancel            — cancel at period end
 *   POST /api/billing/portal/resume            — un-cancel
 *   POST /api/billing/portal/payment-method           — Stripe SetupIntent redirect URL
 *   POST /api/billing/portal/payment-method/complete  — finalize setup Checkout session
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import { getAuthContext, getOrgId, isMissingProductionOrg } from '../middleware/auth.js';
import { normalizeClerkRole } from '../config/rbacRoles.js';
import { conditionalRequireAuth } from '../middleware/conditionalAuth.js';
import { requirePermission, requireBillingWrite } from '../middleware/rbac.js';
import { buildPublicBillingCatalog } from '../config/billingCatalog.js';
import type { BillingCycle, BillingPlanId, SubscriptionStatus } from '../types/billing.js';
import { MICRO_PER_CREDIT } from '../types/billing.js';
import {
    adjustCredits,
    findOrgByStripeCustomerId,
    getBillingStatus,
    getOrgPlanState,
    markPendingCheckout,
    reconcileOrgPlanWithStripe,
    seedOrgBilling,
} from '../services/billingRuntimeService.js';
import { getPlanById, planAllowsVideo } from '../services/billingEngine.js';
import {
    cancelSubscription,
    createCheckoutSession,
    createBillingPortalSession,
    createEmbeddedSetupIntent,
    createVideoPackCheckout,
    createPlanChangePortalSession,
    changeSubscriptionPlan,
    BillingPlanChangeError,
    finalizeSetupCheckoutSessionById,
    finalizeSetupIntentById,
    listBillingReceipts,
    resumeSubscription,
    retrieveSubscription,
    getSubscriptionPeriodBounds,
} from '../services/stripeService.js';

const router = express.Router();

const VALID_PLAN_IDS: BillingPlanId[] = ['starter', 'team', 'professional', 'business'];
const VALID_CYCLES: BillingCycle[] = ['monthly'];

function requireBillingOrg(req: Request, res: Response, next: NextFunction): void {
    const orgId = getOrgId(req);
    if (isMissingProductionOrg(orgId)) {
        res.status(403).json({
            ok: false,
            code: 'ORG_REQUIRED',
            message: 'Organization context is required for billing in production.',
        });
        return;
    }
    next();
}

function requireBillingAdmin(req: Request, res: Response, next: NextFunction): void {
    if (process.env.NODE_ENV !== 'production') {
        if (process.env.BILLING_DEV_TOOLS === 'true') {
            next();
            return;
        }
        res.status(403).json({
            ok: false,
            error: 'forbidden',
            message: 'Set BILLING_DEV_TOOLS=true in dev to use seed/adjust routes',
        });
        return;
    }
    const adminKey = process.env.BILLING_ADMIN_KEY;
    const provided = req.headers['x-billing-admin-key'];
    if (adminKey && typeof provided === 'string' && provided === adminKey) {
        next();
        return;
    }
    res.status(403).json({ ok: false, error: 'forbidden', message: 'Billing admin access required' });
}

/** GET /api/billing/status — v2 shape with nested usage + permissions (flat fields kept for compat). */
router.get('/status', conditionalRequireAuth(), requirePermission('billing.read'), requireBillingOrg, async (req: Request, res: Response) => {
    try {
        const authCtx = getAuthContext(req);
        const organizationId = getOrgId(req);
        const status = await getBillingStatus(organizationId);
        const catalogPlan = status.planId ? getPlanById(status.planId) : undefined;
        const monthlyAllowance = status.monthlyCredits ?? 0;
        const remaining = status.creditsRemaining ?? 0;
        const canManageBilling =
            normalizeClerkRole(authCtx.role) === 'OWNER' &&
            authCtx.permissions.includes('billing.write');

        res.json({
            ok: true,
            apiVersion: 2,
            organization: {
                id: organizationId,
                permissions: {
                    billingRead: authCtx.permissions.includes('billing.read'),
                    billingWrite: authCtx.permissions.includes('billing.write'),
                    canManageBilling,
                },
            },
            ...status,
            plan: {
                officialPlanId: status.planId,
                displayNameKey: catalogPlan?.displayNameKey ?? null,
                legacyPlanCode: null,
                resolutionError: null,
            },
            usage: {
                credits: {
                    monthlyAllowance,
                    remaining,
                    usedThisPeriod: Math.max(0, monthlyAllowance - remaining),
                },
                video: {
                    includedMinutesRemaining: Math.floor(
                        (status.remainingIncludedVideoSeconds ?? 0) / 60,
                    ),
                    purchasedMinutesRemaining: Math.floor(
                        (status.remainingPurchasedVideoSeconds ?? 0) / 60,
                    ),
                },
            },
            subscription: {
                status: status.subscriptionStatus,
                interval: status.billingCycle,
                periodEnd: status.periodEnd,
                cancelAtPeriodEnd: status.cancelAtPeriodEnd,
                lifecycleState: status.lifecycleState,
                pendingCheckoutPlanId: status.pendingCheckoutPlanId,
            },
        });
    } catch (err) {
        console.error('[billing/status]', err);
        res.status(500).json({ ok: false, message: 'Failed to load billing status' });
    }
});

/** POST /api/billing/seed — body: { organizationId?, planId } */
router.post('/seed', requireBillingAdmin, async (req: Request, res: Response) => {
    try {
        const body = req.body ?? {};
        const organizationId =
            typeof body.organizationId === 'string' && body.organizationId.trim()
                ? body.organizationId.trim()
                : getOrgId(req);
        const planId = body.planId as BillingPlanId;

        if (!planId || !VALID_PLAN_IDS.includes(planId)) {
            return res.status(400).json({
                ok: false,
                message: 'planId must be starter, team, professional, or business',
            });
        }

        if (!getPlanById(planId)) {
            return res.status(400).json({ ok: false, message: 'Unknown planId' });
        }

        const { orgPlanState, creditBalance } = await seedOrgBilling(organizationId, planId);

        res.json({
            ok: true,
            organizationId,
            planId: orgPlanState.planId,
            subscriptionStatus: orgPlanState.subscriptionStatus,
            balanceMicro: creditBalance.balanceMicro,
            monthlyCredits: creditBalance.monthlyCredits,
            periodEnd: creditBalance.periodEnd,
        });
    } catch (err) {
        console.error('[billing/seed]', err);
        res.status(500).json({ ok: false, message: 'Failed to seed billing' });
    }
});

/**
 * POST /api/billing/adjust — body: { organizationId?, credits?, amountMicro?, idempotencyKey? }
 * Provide either whole `credits` (converted to microCredits) or raw `amountMicro`.
 */
router.post('/adjust', requireBillingAdmin, async (req: Request, res: Response) => {
    try {
        const body = req.body ?? {};
        const organizationId =
            typeof body.organizationId === 'string' && body.organizationId.trim()
                ? body.organizationId.trim()
                : getOrgId(req);

        const amountMicro = Number.isFinite(Number(body.amountMicro))
            ? Math.trunc(Number(body.amountMicro))
            : Math.trunc(Number(body.credits) * MICRO_PER_CREDIT);

        if (!Number.isFinite(amountMicro) || amountMicro === 0) {
            return res
                .status(400)
                .json({ ok: false, message: 'Provide a non-zero `credits` or `amountMicro`' });
        }

        const idempotencyKey =
            typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
                ? body.idempotencyKey.trim()
                : `adjust:${organizationId}:${Date.now()}`;

        const result = await adjustCredits({
            organizationId,
            amountMicro,
            idempotencyKey,
            metadata: body.metadata,
        });

        res.json({ ok: true, organizationId, ...result });
    } catch (err) {
        console.error('[billing/adjust]', err);
        const message = err instanceof Error ? err.message : 'Failed to adjust credits';
        res.status(400).json({ ok: false, message });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// Phase 2b — Stripe checkout + custom billing portal
// ────────────────────────────────────────────────────────────────────────────

function parseCheckoutBody(
    body: unknown,
): { planId: BillingPlanId; cycle: BillingCycle; requestId?: string } | null {
    if (!body || typeof body !== 'object') return null;
    const b = body as Record<string, unknown>;
    if (!isValidPlanId(b.planId)) return null;
    if (!isValidCycle(b.cycle)) return null;
    const requestId =
        typeof b.requestId === 'string' && b.requestId.trim() ? b.requestId.trim() : undefined;
    return { planId: b.planId, cycle: b.cycle, requestId };
}

function isValidPlanId(value: unknown): value is BillingPlanId {
    return typeof value === 'string' && (VALID_PLAN_IDS as string[]).includes(value);
}

function isValidCycle(value: unknown): value is BillingCycle {
    return typeof value === 'string' && (VALID_CYCLES as string[]).includes(value);
}

type CheckoutRouteKind = 'portal' | 'checkout' | 'recovery';

function resolveCheckoutRoute(state: {
    stripeSubscriptionId?: string | null;
    subscriptionStatus?: SubscriptionStatus | null;
} | null): CheckoutRouteKind {
    if (!state?.stripeSubscriptionId) return 'checkout';
    switch (state.subscriptionStatus) {
        case 'active':
        case 'trialing':
            return 'portal';
        case 'past_due':
        case 'incomplete':
            return 'recovery';
        default:
            return 'checkout';
    }
}

/** GET /api/billing/catalog/public — marketing-safe plan catalog (no Stripe IDs). */
router.get('/catalog/public', (_req: Request, res: Response) => {
    res.json({ ok: true, ...buildPublicBillingCatalog() });
});

/** POST /api/billing/checkout — body: { planId, cycle } → Stripe Checkout or Portal confirm URL */
router.post(
    '/checkout',
    conditionalRequireAuth(),
    requireBillingWrite,
    requireBillingOrg,
    async (req: Request, res: Response) => {
    try {
        const parsed = parseCheckoutBody(req.body);
        if (!parsed) {
            return res.status(400).json({
                ok: false,
                code: 'INVALID_REQUEST',
                message: 'planId must be starter|team|professional|business; cycle must be monthly',
            });
        }

        const authCtx = getAuthContext(req);
        const state = await getOrgPlanState(authCtx.orgId);
        const routeKind = resolveCheckoutRoute(state);

        if (routeKind === 'recovery') {
            const { url } = await createBillingPortalSession({
                organizationId: authCtx.orgId,
                customerEmail: authCtx.email,
                intent: 'manage',
            });
            return res.json({ ok: true, url, kind: 'recovery' });
        }

        if (routeKind === 'portal') {
            const result = await createPlanChangePortalSession({
                organizationId: authCtx.orgId,
                planId: parsed.planId,
                cycle: parsed.cycle,
                customerEmail: authCtx.email,
            });
            if (result.kind === 'already_on_plan') {
                return res.json({
                    ok: true,
                    kind: 'already_active',
                    planId: result.planId,
                    cycle: result.cycle,
                });
            }
            return res.json({ ok: true, url: result.url, kind: 'portal' });
        }

        const { url, sessionId } = await createCheckoutSession({
            organizationId: authCtx.orgId,
            planId: parsed.planId,
            cycle: parsed.cycle,
            customerEmail: authCtx.email,
            userId: authCtx.userId,
            requestId: parsed.requestId,
        });

        if (sessionId) {
            await markPendingCheckout(authCtx.orgId, {
                sessionId,
                planId: parsed.planId,
                cycle: parsed.cycle,
            });
        }

        res.json({ ok: true, url, sessionId, kind: 'checkout' });
    } catch (err) {
        console.error('[billing/checkout]', err);
        if (err instanceof BillingPlanChangeError) {
            return res.status(400).json({
                ok: false,
                code: err.code,
                message: err.message,
            });
        }
        const stripeErr = err as { type?: string; message?: string };
        if (stripeErr?.type === 'StripeInvalidRequestError' && stripeErr.message) {
            return res.status(400).json({
                ok: false,
                code: 'STRIPE_ERROR',
                message: stripeErr.message,
            });
        }
        const message = err instanceof Error ? err.message : 'Failed to start checkout';
        res.status(500).json({ ok: false, message });
    }
});

/** POST /api/billing/portal/session — body: { intent? } → Stripe Customer Portal URL */
router.post(
    '/portal/session',
    conditionalRequireAuth(),
    requireBillingWrite,
    requireBillingOrg,
    async (req: Request, res: Response) => {
    try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const intentRaw = typeof body.intent === 'string' ? body.intent.trim() : 'manage';
        const intent =
            intentRaw === 'add_payment_method' || intentRaw === 'cancel' ? intentRaw : 'manage';

        const authCtx = getAuthContext(req);
        const { url } = await createBillingPortalSession({
            organizationId: authCtx.orgId,
            customerEmail: authCtx.email,
            intent,
        });

        res.json({ ok: true, url });
    } catch (err) {
        console.error('[billing/portal/session]', err);
        if (err instanceof BillingPlanChangeError) {
            return res.status(400).json({
                ok: false,
                code: err.code,
                message: err.message,
            });
        }
        const message = err instanceof Error ? err.message : 'Failed to open billing portal';
        res.status(500).json({ ok: false, message });
    }
});

/** POST /api/billing/change-plan — DEPRECATED: use POST /api/billing/checkout instead. Dev-only unless BILLING_DEV_TOOLS=true. */
router.post(
    '/change-plan',
    conditionalRequireAuth(),
    requireBillingWrite,
    requireBillingOrg,
    (req: Request, res: Response, next: NextFunction) => {
        res.setHeader('Deprecation', 'true');
        res.setHeader('Link', '</api/billing/checkout>; rel="successor-version"');
        if (process.env.NODE_ENV === 'production' || process.env.BILLING_DEV_TOOLS !== 'true') {
            res.status(410).json({
                ok: false,
                code: 'DEPRECATED',
                message: 'Use POST /api/billing/checkout for plan changes.',
            });
            return;
        }
        next();
    },
    async (req: Request, res: Response) => {
    try {
        const parsed = parseCheckoutBody(req.body);
        if (!parsed) {
            return res.status(400).json({
                ok: false,
                code: 'INVALID_REQUEST',
                message: 'planId must be starter|team|professional|business; cycle must be monthly',
            });
        }

        const authCtx = getAuthContext(req);
        const result = await changeSubscriptionPlan({
            organizationId: authCtx.orgId,
            planId: parsed.planId,
            cycle: parsed.cycle,
        });

        if ('kind' in result && result.kind === 'downgrade_scheduled') {
            return res.json({
                ok: true,
                switched: false,
                kind: 'downgrade_scheduled',
                effectiveAt: result.effectiveAt,
            });
        }

        res.json({ ok: true, switched: true });
    } catch (err) {
        console.error('[billing/change-plan]', err);
        if (err instanceof BillingPlanChangeError) {
            const status =
                err.code === 'PAYMENT_FAILED'
                    ? 402
                    : err.code === 'NO_ACTIVE_SUBSCRIPTION'
                      ? 400
                      : 400;
            return res.status(status).json({
                ok: false,
                code: err.code,
                reason: err.reason,
                message: err.message,
            });
        }
        const message = err instanceof Error ? err.message : 'Failed to change plan';
        res.status(500).json({ ok: false, message });
    }
});

/**
 * POST /api/billing/video-pack/checkout — one-time purchase of an extra video pack.
 * Resolves the org's current plan, verifies it allows video, and returns a Stripe
 * Checkout URL (mode: payment). The webhook credits purchasedVideoSeconds.
 */
router.post(
    '/video-pack/checkout',
    conditionalRequireAuth(),
    requireBillingWrite,
    requireBillingOrg,
    async (req: Request, res: Response) => {
    try {
        const authCtx = getAuthContext(req);
        const state = await getOrgPlanState(authCtx.orgId);
        if (!state || !state.planId) {
            return res.status(400).json({
                ok: false,
                code: 'NO_PLAN',
                message: 'No active plan. Subscribe to a video-capable plan first.',
            });
        }

        if (!planAllowsVideo(state.planId)) {
            return res.status(400).json({
                ok: false,
                code: 'PLAN_NO_VIDEO',
                message: 'Your plan does not include video interviews. Upgrade to buy video packs.',
            });
        }

        const rawQty = Number((req.body ?? {}).quantity);
        const quantity = Number.isFinite(rawQty) && rawQty > 0 ? Math.floor(rawQty) : 1;
        const body = (req.body ?? {}) as Record<string, unknown>;
        const requestId =
            typeof body.requestId === 'string' && body.requestId.trim()
                ? body.requestId.trim()
                : undefined;

        const { url, sessionId } = await createVideoPackCheckout({
            organizationId: authCtx.orgId,
            planId: state.planId,
            quantity,
            customerEmail: authCtx.email,
            userId: authCtx.userId,
            requestId,
        });

        res.json({ ok: true, url, sessionId });
    } catch (err) {
        console.error('[billing/video-pack/checkout]', err);
        const message = err instanceof Error ? err.message : 'Failed to start video-pack checkout';
        res.status(500).json({ ok: false, message });
    }
});

async function loadActiveSubscription(orgId: string) {
    const state = await getOrgPlanState(orgId);
    if (!state || !state.stripeSubscriptionId) return { state, stripeSub: null };
    const stripeSub = await retrieveSubscription(state.stripeSubscriptionId);
    return { state, stripeSub };
}

/** GET /api/billing/portal/summary — current Stripe subscription summary */
router.get('/portal/summary', conditionalRequireAuth(), requireBillingOrg, async (req: Request, res: Response) => {
    try {
        const orgId = getOrgId(req);
        try {
            await reconcileOrgPlanWithStripe(orgId);
        } catch (reconcileErr) {
            console.warn(
                '[billing/portal/summary] reconcile skipped:',
                reconcileErr instanceof Error ? reconcileErr.message : reconcileErr,
            );
        }

        const state = await getOrgPlanState(orgId);
        const stripeSub =
            state?.stripeSubscriptionId != null
                ? await retrieveSubscription(state.stripeSubscriptionId)
                : null;

        if (!state) {
            return res.json({
                ok: true,
                configured: false,
                planId: null,
                subscriptionStatus: null,
            });
        }

        const defaultPmObj = stripeSub?.default_payment_method;
        const pmCard =
            defaultPmObj && typeof defaultPmObj === 'object' && 'card' in defaultPmObj
                ? (defaultPmObj as { card?: { brand?: string; last4?: string; exp_month?: number; exp_year?: number } }).card
                : null;

        const nextInvoiceAmount = (() => {
            const li = stripeSub?.latest_invoice;
            if (li && typeof li === 'object') {
                const totalRaw = (li as { amount_due?: number }).amount_due;
                if (typeof totalRaw === 'number') return totalRaw;
            }
            const item = stripeSub?.items?.data?.[0];
            const unit = item?.price?.unit_amount;
            const qty = item?.quantity ?? 1;
            if (typeof unit === 'number') return unit * qty;
            return null;
        })();

        const periodBounds = stripeSub ? getSubscriptionPeriodBounds(stripeSub) : null;

        res.json({
            ok: true,
            configured: true,
            planId: state.planId,
            billingCycle: state.billingCycle,
            subscriptionStatus: state.subscriptionStatus,
            cancelAtPeriodEnd: Boolean(state.cancelAtPeriodEnd),
            currentPeriodStart: periodBounds?.periodStart ?? state.currentPeriodStart,
            currentPeriodEnd: periodBounds?.periodEnd ?? state.currentPeriodEnd,
            stripeSubscriptionId: state.stripeSubscriptionId ?? null,
            stripeCustomerId: state.stripeCustomerId ?? null,
            nextInvoiceAmountCents: nextInvoiceAmount,
            paymentMethod: pmCard
                ? {
                      brand: pmCard.brand ?? null,
                      last4: pmCard.last4 ?? null,
                      expMonth: pmCard.exp_month ?? null,
                      expYear: pmCard.exp_year ?? null,
                  }
                : null,
        });
    } catch (err) {
        console.error('[billing/portal/summary]', err);
        const message = err instanceof Error ? err.message : 'Failed to load portal summary';
        res.status(500).json({ ok: false, message });
    }
});

/** GET /api/billing/portal/invoices?limit=10 */
router.get('/portal/invoices', conditionalRequireAuth(), requireBillingOrg, async (req: Request, res: Response) => {
    try {
        const orgId = getOrgId(req);
        const state = await getOrgPlanState(orgId);
        if (!state?.stripeCustomerId) {
            return res.json({ ok: true, invoices: [] });
        }
        const limitRaw = Number(req.query.limit);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(50, Math.floor(limitRaw)) : 10;
        const receipts = await listBillingReceipts(state.stripeCustomerId, limit);
        res.json({
            ok: true,
            invoices: receipts.map((row) => ({
                id: row.id,
                number: row.number,
                status: row.status,
                amountPaidCents: row.amountPaidCents,
                amountDueCents: row.amountDueCents,
                currency: row.currency,
                createdAt: row.createdAt,
                periodStart: row.periodStart,
                periodEnd: row.periodEnd,
                hostedInvoiceUrl: row.hostedInvoiceUrl,
                pdfUrl: row.pdfUrl,
                planId: row.planId,
                billingCycle: row.billingCycle,
                description: row.description,
                kind: row.kind,
            })),
        });
    } catch (err) {
        console.error('[billing/portal/invoices]', err);
        const message = err instanceof Error ? err.message : 'Failed to list invoices';
        res.status(500).json({ ok: false, message });
    }
});

/** POST /api/billing/portal/cancel — cancel at period end */
router.post(
    '/portal/cancel',
    conditionalRequireAuth(),
    requireBillingWrite,
    requireBillingOrg,
    async (req: Request, res: Response) => {
    try {
        const orgId = getOrgId(req);
        const state = await getOrgPlanState(orgId);
        if (!state?.stripeSubscriptionId) {
            return res
                .status(400)
                .json({ ok: false, code: 'NO_SUBSCRIPTION', message: 'No active Stripe subscription.' });
        }
        await cancelSubscription(state.stripeSubscriptionId, true);
        // The customer.subscription.updated webhook will sync the OrgPlanState mirror.
        res.json({ ok: true });
    } catch (err) {
        console.error('[billing/portal/cancel]', err);
        const message = err instanceof Error ? err.message : 'Failed to cancel subscription';
        res.status(500).json({ ok: false, message });
    }
});

/** POST /api/billing/portal/resume — un-cancel a sub that's set to cancel_at_period_end */
router.post(
    '/portal/resume',
    conditionalRequireAuth(),
    requireBillingWrite,
    requireBillingOrg,
    async (req: Request, res: Response) => {
    try {
        const orgId = getOrgId(req);
        const state = await getOrgPlanState(orgId);
        if (!state?.stripeSubscriptionId) {
            return res
                .status(400)
                .json({ ok: false, code: 'NO_SUBSCRIPTION', message: 'No Stripe subscription to resume.' });
        }
        await resumeSubscription(state.stripeSubscriptionId);
        res.json({ ok: true });
    } catch (err) {
        console.error('[billing/portal/resume]', err);
        const message = err instanceof Error ? err.message : 'Failed to resume subscription';
        res.status(500).json({ ok: false, message });
    }
});

/** POST /api/billing/portal/payment-method — embedded SetupIntent for in-page modal */
router.post('/portal/payment-method', conditionalRequireAuth(), requireBillingWrite, requireBillingOrg, async (req: Request, res: Response) => {
    try {
        const orgId = getOrgId(req);
        const payload = await createEmbeddedSetupIntent(orgId);
        res.json({ ok: true, ...payload });
    } catch (err) {
        console.error('[billing/portal/payment-method]', err);
        const message = err instanceof Error ? err.message : 'Failed to create payment method session';
        res.status(500).json({ ok: false, message });
    }
});

/** POST /api/billing/portal/payment-method/complete — body: { setupIntentId } | { sessionId } */
router.post(
    '/portal/payment-method/complete',
    conditionalRequireAuth(),
    requireBillingWrite,
    requireBillingOrg,
    async (req: Request, res: Response) => {
        try {
            const orgId = getOrgId(req);
            const setupIntentId =
                typeof req.body?.setupIntentId === 'string' && req.body.setupIntentId.trim()
                    ? req.body.setupIntentId.trim()
                    : '';
            const sessionId =
                typeof req.body?.sessionId === 'string' && req.body.sessionId.trim()
                    ? req.body.sessionId.trim()
                    : '';

            if (setupIntentId) {
                await finalizeSetupIntentById(orgId, setupIntentId);
            } else if (sessionId) {
                await finalizeSetupCheckoutSessionById(orgId, sessionId);
            } else {
                return res.status(400).json({
                    ok: false,
                    code: 'INVALID_REQUEST',
                    message: 'setupIntentId or sessionId is required',
                });
            }
            res.json({ ok: true });
        } catch (err) {
            console.error('[billing/portal/payment-method/complete]', err);
            const message =
                err instanceof Error ? err.message : 'Failed to finalize payment method';
            res.status(400).json({ ok: false, message });
        }
    },
);

export default router;

// Re-export for tests / scripts that want to assert reverse lookup works.
export { findOrgByStripeCustomerId };
