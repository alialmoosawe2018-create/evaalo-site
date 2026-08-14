/**
 * Billing Runtime Service — operational layer (Phase 2a + 2b).
 *
 * Owns all Mongo IO for org_plan_state, credit_balance, and credit_ledger.
 * Catalog decisions delegate to billingEngine.ts (read-only).
 *
 * Phase 2a scope:
 *   - seedOrgBilling / refreshBalanceFromPlan (manual provider)
 *   - checkCredits (read-only gate)
 *   - consumeCredits (atomic deduct + ledger, idempotent)
 *   - adjustCredits (manual_adjustment escape hatch)
 *
 * Phase 2b additions (Stripe authority):
 *   - isBillingActive(status) — single source for "can user consume?" policy
 *   - findOrgByStripeCustomerId — webhook handler helper
 *   - apply* functions — every Stripe state transition lives here, not in handlers
 *   - Every ledger entry carries metadata.planSnapshot (audit trail safety)
 *
 * Architecture contracts (locked):
 *   - Handlers in stripeWebhookHandlers.ts MUST NOT touch Mongo directly.
 *     All mutations route through the apply* functions here. This keeps logic
 *     replayable from admin actions and migrations later.
 *   - No code outside this file may check `subscriptionStatus === '...'`.
 *     Use isBillingActive(state.subscriptionStatus) instead.
 */

import mongoose from 'mongoose';
import OrgPlanState, { type IOrgPlanState } from '../models/OrgPlanState.js';
import { type ICreditBalance } from '../models/CreditBalance.js';
// All credit_balances / credit_ledger IO now flows through the repositories below.
import { enqueueDomainEvent, emitDomainEventBestEffort } from './domainEventService.js';
import * as creditBalanceRepo from '../repositories/creditBalanceRepository.js';
import * as creditLedgerRepo from '../repositories/creditLedgerRepository.js';
import type {
    AdjustCreditsInput,
    BillingActivityEntry,
    BillingCycle,
    BillingPlanId,
    ConsumeCreditsInput,
    ConsumeCreditsResult,
    SubscriptionStatus,
    SubscriptionLifecycleState,
    UsageType,
} from '../types/billing.js';
import { MICRO_PER_CREDIT } from '../types/billing.js';
import {
    creditCostMicro,
    featureForUsageType,
    getIncludedVideoSeconds,
    getMonthlyCredits,
    getPlanById,
    getSeatLimit,
    getVideoPackMinutes,
    getVideoPackPriceUsd,
    planAllowsVideo,
    planHasFeature,
} from './billingEngine.js';
import { resolveSubscriptionLifecycleState } from './billingLifecycle.js';

/**
 * Status policy helper — the SINGLE source of truth for "is billing active?".
 *
 * Any `consumeCredits`-eligible status returns true. Add new Stripe statuses
 * (`paused`, `unpaid`, …) here only — never inline as `status === 'active'`.
 *
 * Contract: this is the only function in the codebase that may inspect
 * `subscriptionStatus` directly.
 */
export function isBillingActive(status: SubscriptionStatus | null | undefined): boolean {
    if (!status) return false;
    return status === 'active' || status === 'trialing';
}

/** Fallback billing window when Stripe period bounds are unavailable (same day next month). */
function defaultPeriod(): { start: Date; end: Date } {
    const start = new Date();
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    return { start, end };
}

function periodDatesMatch(a: Date | null | undefined, b: Date): boolean {
    if (!a) return false;
    return a.getTime() === b.getTime();
}

function seatCountForPlan(planId: BillingPlanId): number {
    const limit = getSeatLimit(planId);
    if (!limit) return 1;
    if (limit.type === 'unlimited') return 1;
    return limit.value;
}

/** Record an open Stripe Checkout session until webhook confirms payment. */
export async function markPendingCheckout(
    organizationId: string,
    input: {
        sessionId: string;
        planId: BillingPlanId;
        cycle: BillingCycle;
    },
): Promise<void> {
    await OrgPlanState.findOneAndUpdate(
        { organizationId },
        {
            $set: {
                pendingCheckoutSessionId: input.sessionId,
                pendingCheckoutAt: new Date(),
                pendingCheckoutPlanId: input.planId,
                pendingCheckoutCycle: input.cycle,
            },
        },
    ).exec();
}

/** Plan monthly allowance expressed in microCredits (balance reset target). */
function balanceMicroFromPlan(planId: BillingPlanId): number {
    return getMonthlyCredits(planId) * MICRO_PER_CREDIT;
}

function isDuplicateKeyError(err: unknown): boolean {
    return (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: number }).code === 11000
    );
}

/**
 * Detect environments where MongoDB multi-document transactions are unavailable
 * (standalone Mongo in local dev). Prod (Atlas replica set) always supports them.
 * Mirrors the same guard used in services/videoBillingService.ts.
 */
function isTransactionUnsupported(err: unknown): boolean {
    if (typeof err !== 'object' || err === null) return false;
    const e = err as { code?: number; codeName?: string; message?: string };
    if (e.code === 20 || e.codeName === 'IllegalOperation') return true;
    const msg = String(e.message || '');
    return /Transaction numbers are only allowed|replica set|mongos|not supported/i.test(msg);
}

/**
 * Ledger Snapshot helper (Architecture Contract 4 — hardened).
 *
 * Every CreditLedger entry must carry an IMMUTABLE snapshot of the catalog +
 * plan state at the write time, including the included credit caps. Catalog
 * can drift (price/credits/features changes); the audit trail must answer
 * "what plan and what allowance was active when this happened?" forever —
 * even if Professional later moves from 300 → 500 voice minutes.
 */
function buildPlanSnapshot(state: IOrgPlanState | null): {
    planId: BillingPlanId | null;
    cycle: BillingCycle | null;
    subscriptionStatus: SubscriptionStatus | null;
    monthlyCredits: number | null;
} {
    if (!state) {
        return { planId: null, cycle: null, subscriptionStatus: null, monthlyCredits: null };
    }
    return {
        planId: state.planId,
        cycle: state.billingCycle,
        subscriptionStatus: state.subscriptionStatus,
        monthlyCredits: getMonthlyCredits(state.planId),
    };
}

function mergeLedgerMetadata(
    base: Record<string, unknown> | undefined,
    state: IOrgPlanState | null,
): Record<string, unknown> {
    return {
        ...(base ?? {}),
        planSnapshot: buildPlanSnapshot(state),
    };
}

// ────────────────────────────────────────────────────────────────────────────
// State / balance accessors
// ────────────────────────────────────────────────────────────────────────────

export async function getOrgPlanState(
    organizationId: string,
): Promise<IOrgPlanState | null> {
    return OrgPlanState.findOne({ organizationId }).exec();
}

export async function getCreditBalance(
    organizationId: string,
): Promise<ICreditBalance | null> {
    return creditBalanceRepo.getByOrg(organizationId);
}

/**
 * Cents to charge back on upgrade for credits already consumed on the plan being
 * left. Stripe's time-based proration refunds the unused *time* of the old plan even
 * though the consumed credits are gone — which lets someone buy a plan, spend its
 * credits, upgrade the same day, and reclaim most of the money. This returns the
 * value of the consumed credits (at the leaving plan's per-credit rate), CAPPED at
 * the estimated proration refund (old price × remaining fraction of the period), so
 * the upgrade never costs more than a fresh prorated upgrade. Returns 0 when there is
 * nothing to recover (fresh upgrade, free/unknown plan, or unknown period). Pure read.
 */
export async function computeConsumedCreditRecoveryCents(input: {
    organizationId: string;
    fromPlanId: BillingPlanId;
    periodStart?: Date | null;
    periodEnd?: Date | null;
    now?: number;
}): Promise<number> {
    const allowance = getMonthlyCredits(input.fromPlanId);
    const priceInfo = getPlanById(input.fromPlanId)?.price;
    const priceUsd = priceInfo && priceInfo !== 'custom' ? priceInfo.monthly : 0;
    if (allowance <= 0 || priceUsd <= 0) return 0;

    const balance = await getCreditBalance(input.organizationId);
    const allowanceMicro = allowance * MICRO_PER_CREDIT;
    const remainingMicro = balance?.balanceMicro ?? 0;
    const consumedMicro = Math.max(0, allowanceMicro - remainingMicro);
    if (consumedMicro <= 0) return 0;

    const consumedValueCents = Math.round((consumedMicro / allowanceMicro) * priceUsd * 100);
    if (consumedValueCents <= 0) return 0;

    const start = input.periodStart?.getTime();
    const end = input.periodEnd?.getTime();
    const now = input.now ?? Date.now();
    if (!start || !end || end <= start) return 0;
    const remainingFraction = Math.min(1, Math.max(0, (end - now) / (end - start)));
    const prorationRefundCents = Math.round(priceUsd * 100 * remainingFraction);

    return Math.max(0, Math.min(consumedValueCents, prorationRefundCents));
}

/**
 * Phase 2b helper: reverse-lookup org by Stripe customer ID for webhook handlers.
 * Returns null when the customer has not been linked yet — handler decides policy.
 */
export async function findOrgByStripeCustomerId(
    stripeCustomerId: string,
): Promise<IOrgPlanState | null> {
    if (!stripeCustomerId) return null;
    return OrgPlanState.findOne({ stripeCustomerId }).exec();
}

// ────────────────────────────────────────────────────────────────────────────
// Mode A: transactional balance-refresh (grant / seed / Stripe-period)
// ────────────────────────────────────────────────────────────────────────────

interface RefreshLedgerInput {
    amountMicro: number;
    balanceBeforeMicro: number;
    balanceAfterMicro: number;
    sourceId?: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
}

/**
 * Persist a balance-period snapshot + its ledger row + the `CreditBalanceRefreshed`
 * event ATOMICALLY (single `withTransaction` on a replica set) so a grant/refresh can
 * never leave the balance and its ledger/event divergent (Mode A — matches the locked
 * "money is transactional" contract already used by consumeCredits). On standalone
 * Mongo (no transactions) it falls back to the legacy best-effort sequence — byte-for
 * -behavior identical to the pre-Mode-A code. Idempotent via the ledger's unique
 * idempotencyKey: a duplicate (retry / Stripe redelivery) is treated as already-applied
 * and returns the existing balance (the first grant already set it).
 */
async function refreshBalanceAtomically(
    organizationId: string,
    balanceSet: Record<string, unknown>,
    upsertOpts: { unset?: Record<string, unknown>; setDefaultsOnInsert?: boolean },
    ledger: RefreshLedgerInput,
    eventPayload: Record<string, unknown>,
): Promise<ICreditBalance | null> {
    const eventKey = `balance-refresh:${ledger.idempotencyKey}`;
    const ledgerRow = { organizationId, source: 'monthly_refresh' as const, ...ledger };

    const mongoSession = await mongoose.startSession();
    try {
        let balance: ICreditBalance | null = null;
        await mongoSession.withTransaction(async () => {
            balance = await creditBalanceRepo.upsertPeriod(organizationId, balanceSet, {
                ...upsertOpts,
                session: mongoSession,
            });
            await creditLedgerRepo.create(ledgerRow, mongoSession);
            await enqueueDomainEvent(
                { organizationId, type: 'CreditBalanceRefreshed', payload: eventPayload, idempotencyKey: eventKey },
                mongoSession,
            );
        });
        return balance;
    } catch (err) {
        // Already applied (retry / Stripe redelivery) — the first grant set the balance.
        if (isDuplicateKeyError(err)) return getCreditBalance(organizationId);

        if (isTransactionUnsupported(err)) {
            // Standalone Mongo (local dev): legacy best-effort sequence, unchanged.
            const balance = await creditBalanceRepo.upsertPeriod(organizationId, balanceSet, upsertOpts);
            try {
                await creditLedgerRepo.create(ledgerRow);
                void emitDomainEventBestEffort({
                    organizationId,
                    type: 'CreditBalanceRefreshed',
                    payload: eventPayload,
                    idempotencyKey: eventKey,
                });
            } catch (e) {
                if (!isDuplicateKeyError(e)) throw e;
            }
            return balance;
        }
        throw err;
    } finally {
        await mongoSession.endSession();
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Manual seed (Phase 2a — kept for admin / dev tooling)
// ────────────────────────────────────────────────────────────────────────────

export async function seedOrgBilling(
    organizationId: string,
    planId: BillingPlanId,
): Promise<{ orgPlanState: IOrgPlanState; creditBalance: ICreditBalance }> {
    const plan = getPlanById(planId);
    if (!plan) {
        throw new Error(`Unknown planId: ${planId}`);
    }

    const { start, end } = defaultPeriod();
    const now = new Date();
    const balanceMicro = balanceMicroFromPlan(planId);
    const monthlyCredits = getMonthlyCredits(planId);
    const includedVideoSeconds = getIncludedVideoSeconds(planId);

    const orgPlanState = await OrgPlanState.findOneAndUpdate(
        { organizationId },
        {
            $set: {
                planId,
                billingProvider: 'manual',
                subscriptionStatus: 'active',
                billingCycle: 'monthly',
                currentPeriodStart: start,
                currentPeriodEnd: end,
                cancelAtPeriodEnd: false,
                seats: seatCountForPlan(planId),
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
    ).exec();

    const idempotencyKey = `seed:${organizationId}:${now.toISOString()}`;
    const creditBalance = await refreshBalanceAtomically(
        organizationId,
        {
            balanceMicro,
            monthlyCredits,
            includedVideoSeconds,
            // New billing period (seed/new org): reset consumed included minutes.
            usedIncludedVideoSeconds: 0,
            periodStart: start,
            periodEnd: end,
            refreshedFromPlanAt: now,
        },
        {},
        {
            amountMicro: balanceMicro,
            balanceBeforeMicro: 0,
            balanceAfterMicro: balanceMicro,
            idempotencyKey,
            metadata: mergeLedgerMetadata({ seeded: true }, orgPlanState),
        },
        { balanceAfterMicro: balanceMicro, monthlyCredits, reason: 'seed' },
    );

    if (!creditBalance) {
        // upsert:true + new:true guarantees a row; guard keeps the non-null contract.
        throw new Error(`Failed to seed credit balance for org: ${organizationId}`);
    }

    return { orgPlanState, creditBalance };
}

export async function refreshBalanceFromPlan(
    organizationId: string,
): Promise<ICreditBalance | null> {
    const state = await getOrgPlanState(organizationId);
    if (!state) return null;

    const balanceMicro = balanceMicroFromPlan(state.planId);
    const monthlyCredits = getMonthlyCredits(state.planId);
    const includedVideoSeconds = getIncludedVideoSeconds(state.planId);
    const { start, end } = defaultPeriod();
    const now = new Date();

    const before = await getCreditBalance(organizationId);
    const balanceBeforeMicro = before?.balanceMicro ?? 0;

    const idempotencyKey = `refresh:${organizationId}:${now.getTime()}`;
    const creditBalance = await refreshBalanceAtomically(
        organizationId,
        {
            balanceMicro,
            monthlyCredits,
            // Snapshot the plan's included video allowance WITHOUT resetting
            // usedIncludedVideoSeconds — this is a plan/manual refresh, not a
            // new billing period. Only seed/Stripe-period events reset usage.
            includedVideoSeconds,
            periodStart: start,
            periodEnd: end,
            refreshedFromPlanAt: now,
        },
        { setDefaultsOnInsert: false },
        {
            amountMicro: balanceMicro - balanceBeforeMicro,
            balanceBeforeMicro,
            balanceAfterMicro: balanceMicro,
            idempotencyKey,
            metadata: mergeLedgerMetadata({}, state),
        },
        { balanceAfterMicro: balanceMicro, monthlyCredits, reason: 'plan_refresh' },
    );

    return creditBalance;
}

// ────────────────────────────────────────────────────────────────────────────
// Read-only gate (Phase 2a)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Pre-unified-credits Mongo rows stored per-bucket balances and never wrote balanceMicro.
 * Detect those so ensurePeriodCreditsSeeded can backfill the unified pool once.
 */
async function creditBalanceNeedsUnifiedMigration(
    organizationId: string,
    balance: ICreditBalance | null,
): Promise<boolean> {
    if ((balance?.balanceMicro ?? 0) > 0) return false;

    const raw = (await creditBalanceRepo.rawFindProjected(organizationId, {
        balanceMicro: 1,
        balances: 1,
        monthlyCredits: 1,
    })) as { balanceMicro?: number; balances?: Record<string, unknown>; monthlyCredits?: number } | null;

    if (!raw) return false;
    if (raw.balances != null && typeof raw.balances === 'object') return true;
    return raw.balanceMicro == null && (raw.monthlyCredits ?? 0) > 0;
}

/**
 * Seed monthly credits when Stripe subscription is active but this billing period
 * was never credited (e.g. webhook missed after checkout or plan reconcile only).
 * Also migrates legacy bucket-based balance docs to unified balanceMicro.
 * Does NOT re-seed when the period was already credited and balance was consumed.
 */
export async function ensurePeriodCreditsSeeded(organizationId: string): Promise<boolean> {
    const state = await getOrgPlanState(organizationId);
    if (!state?.stripeSubscriptionId || state.billingProvider !== 'stripe') {
        return false;
    }
    if (!isBillingActive(state.subscriptionStatus)) {
        return false;
    }

    const balance = await getCreditBalance(organizationId);
    if ((balance?.balanceMicro ?? 0) > 0) {
        return false;
    }

    const periodStart = state.currentPeriodStart ?? new Date();
    const periodEnd = state.currentPeriodEnd ?? new Date(Date.now() + 30 * 24 * 3600);
    const subId = state.stripeSubscriptionId;
    const periodMs = periodStart.getTime();

    if (await creditBalanceNeedsUnifiedMigration(organizationId, balance)) {
        await seedBalanceForStripe(
            organizationId,
            state.planId,
            periodStart,
            periodEnd,
            { source: 'migrate', stripeSubscriptionId: subId, planId: state.planId },
            state,
        );
        console.log(
            `[billing] migrated legacy balance → unified org=${organizationId} plan=${state.planId} credits=${getMonthlyCredits(state.planId)}`,
        );
        return true;
    }

    const seedKeys = [
        `stripe:reconcile-seed:${subId}:${periodMs}`,
        `stripe:checkout:${subId}:${periodMs}`,
        `stripe:plan-change:${subId}:${state.planId}:${periodMs}`,
    ];

    const existingSeed = await creditLedgerRepo.findOneLean({
        organizationId,
        source: 'monthly_refresh',
        idempotencyKey: { $in: seedKeys },
    });

    if (existingSeed) {
        return false;
    }

    const invoiceSeed = await creditLedgerRepo.findOneLean({
        organizationId,
        source: 'monthly_refresh',
        idempotencyKey: { $regex: /^stripe:invoice:/ },
        createdAt: { $gte: periodStart },
    });

    if (invoiceSeed) {
        return false;
    }

    await seedBalanceForStripe(
        organizationId,
        state.planId,
        periodStart,
        periodEnd,
        { source: 'reconcile', stripeSubscriptionId: subId },
        state,
    );

    console.log(
        `[billing] ensurePeriodCreditsSeeded org=${organizationId} plan=${state.planId} credits=${getMonthlyCredits(state.planId)}`,
    );
    return true;
}

export async function checkCredits(
    organizationId: string,
    usageType: UsageType,
    units: number,
): Promise<ConsumeCreditsResult> {
    const state = await getOrgPlanState(organizationId);
    if (!state) {
        return {
            ok: false,
            code: 'ORG_NOT_FOUND',
            message: 'Billing not configured for this organization',
        };
    }

    if (!isBillingActive(state.subscriptionStatus)) {
        return {
            ok: false,
            code: 'INACTIVE_SUBSCRIPTION',
            message: 'Subscription is not active',
        };
    }

    const feature = featureForUsageType(usageType);
    if (!planHasFeature(state.planId, feature)) {
        return {
            ok: false,
            code: 'FEATURE_DENIED',
            message: `Feature not included in plan: ${feature}`,
        };
    }

    const costMicro = creditCostMicro(usageType, units);

    let balance = await getCreditBalance(organizationId);
    let remainingMicro = balance?.balanceMicro ?? 0;

    if (remainingMicro < costMicro && isBillingActive(state.subscriptionStatus)) {
        await ensurePeriodCreditsSeeded(organizationId);
        balance = await getCreditBalance(organizationId);
        remainingMicro = balance?.balanceMicro ?? 0;
    }

    if (remainingMicro < costMicro) {
        return {
            ok: false,
            code: 'INSUFFICIENT_CREDITS',
            message: 'Insufficient credits',
        };
    }

    return {
        ok: true,
        balanceAfterMicro: remainingMicro - costMicro,
        ledgerEntryId: 'precheck',
    };
}

// ────────────────────────────────────────────────────────────────────────────
// Atomic consume (Phase 2a — unchanged metering semantics in 2b)
// ────────────────────────────────────────────────────────────────────────────

export async function consumeCredits(
    input: ConsumeCreditsInput,
): Promise<ConsumeCreditsResult> {
    const {
        organizationId,
        usageType,
        units,
        idempotencyKey,
        source,
        sourceId,
        metadata,
    } = input;

    const existingLedger = await creditLedgerRepo.findByIdempotencyKey(
        organizationId,
        idempotencyKey,
    );

    if (existingLedger) {
        return {
            ok: true,
            balanceAfterMicro: existingLedger.balanceAfterMicro,
            ledgerEntryId: String(existingLedger._id),
            duplicate: true,
        };
    }

    const state = await getOrgPlanState(organizationId);
    if (!state) {
        return {
            ok: false,
            code: 'ORG_NOT_FOUND',
            message: 'Billing not configured for this organization',
        };
    }

    if (!isBillingActive(state.subscriptionStatus)) {
        return {
            ok: false,
            code: 'INACTIVE_SUBSCRIPTION',
            message: 'Subscription is not active',
        };
    }

    const feature = featureForUsageType(usageType);
    if (!planHasFeature(state.planId, feature)) {
        return {
            ok: false,
            code: 'FEATURE_DENIED',
            message: `Feature not included in plan: ${feature}`,
        };
    }

    const costMicro = creditCostMicro(usageType, units);

    // Zero-cost (e.g. a 0-second session) — record nothing, succeed.
    if (costMicro <= 0) {
        const balance = await getCreditBalance(organizationId);
        return {
            ok: true,
            balanceAfterMicro: balance?.balanceMicro ?? 0,
            ledgerEntryId: 'noop',
        };
    }

    if (isBillingActive(state.subscriptionStatus)) {
        const preBalance = await getCreditBalance(organizationId);
        if ((preBalance?.balanceMicro ?? 0) < costMicro) {
            await ensurePeriodCreditsSeeded(organizationId);
        }
    }

    const currentBalance = await getCreditBalance(organizationId);
    if (!currentBalance) {
        return {
            ok: false,
            code: 'ORG_NOT_FOUND',
            message: 'Credit balance not initialized for this organization',
        };
    }

    const balanceBeforeMicro = currentBalance.balanceMicro;

    if (balanceBeforeMicro < costMicro) {
        return {
            ok: false,
            code: 'INSUFFICIENT_CREDITS',
            message: 'Insufficient credits',
        };
    }

    // Atomic compare-and-decrement + ledger insert in a SINGLE transaction so the
    // balance and its ledger row can never drift (Atlas replica set). balanceBefore
    // is derived from the post-decrement value so the ledger invariant
    // (before + amount === after) always holds, even under concurrency.
    const runConsume = async (
        session?: mongoose.ClientSession,
    ): Promise<ConsumeCreditsResult> => {
        const balanceAfterMicro = await creditBalanceRepo.decrementIfSufficient(
            organizationId,
            costMicro,
            session,
        );

        if (balanceAfterMicro === null) {
            return { ok: false, code: 'INSUFFICIENT_CREDITS', message: 'Insufficient credits' };
        }

        const ledger = await creditLedgerRepo.create(
            {
                organizationId,
                usageType,
                amountMicro: -costMicro,
                balanceBeforeMicro: balanceAfterMicro + costMicro,
                balanceAfterMicro,
                units,
                source,
                sourceId,
                idempotencyKey,
                metadata: mergeLedgerMetadata(metadata, state),
            },
            session,
        );

        // Transactional outbox (Phase 2, Mode A): CreditsConsumed commits atomically
        // with the debit + ledger row. The duplicate early-return above means a
        // replayed consume never reaches here, so the event is never double-emitted.
        await enqueueDomainEvent(
            {
                organizationId,
                type: 'CreditsConsumed',
                payload: {
                    usageType,
                    amountMicro: -costMicro,
                    balanceAfterMicro,
                    units,
                    source,
                    sourceId,
                    ledgerEntryId: String(ledger._id),
                },
                idempotencyKey: `credits:${idempotencyKey}`,
            },
            session,
        );

        return { ok: true, balanceAfterMicro, ledgerEntryId: String(ledger._id) };
    };

    const mongoSession = await mongoose.startSession();
    try {
        let result: ConsumeCreditsResult | undefined;
        await mongoSession.withTransaction(async () => {
            result = await runConsume(mongoSession);
        });
        // withTransaction awaits the callback, so result is always assigned here.
        return result ?? { ok: false, code: 'INSUFFICIENT_CREDITS', message: 'Insufficient credits' };
    } catch (err) {
        if (isDuplicateKeyError(err)) {
            const dup = await creditLedgerRepo.findByIdempotencyKey(organizationId, idempotencyKey);
            if (dup) {
                return {
                    ok: true,
                    balanceAfterMicro: dup.balanceAfterMicro,
                    ledgerEntryId: String(dup._id),
                    duplicate: true,
                };
            }
        }

        if (isTransactionUnsupported(err)) {
            // Standalone Mongo (local dev) — no transactions: decrement then compensate
            // on ledger failure, preserving idempotency (unchanged legacy behavior).
            const balanceAfterMicro = await creditBalanceRepo.decrementIfSufficient(
                organizationId,
                costMicro,
            );

            if (balanceAfterMicro === null) {
                return { ok: false, code: 'INSUFFICIENT_CREDITS', message: 'Insufficient credits' };
            }

            try {
                const ledger = await creditLedgerRepo.create({
                    organizationId,
                    usageType,
                    amountMicro: -costMicro,
                    balanceBeforeMicro: balanceAfterMicro + costMicro,
                    balanceAfterMicro,
                    units,
                    source,
                    sourceId,
                    idempotencyKey,
                    metadata: mergeLedgerMetadata(metadata, state),
                });
                // Standalone dev (no transactions): best-effort emit after commit.
                void emitDomainEventBestEffort({
                    organizationId,
                    type: 'CreditsConsumed',
                    payload: {
                        usageType,
                        amountMicro: -costMicro,
                        balanceAfterMicro,
                        units,
                        source,
                        sourceId,
                        ledgerEntryId: String(ledger._id),
                    },
                    idempotencyKey: `credits:${idempotencyKey}`,
                });
                return { ok: true, balanceAfterMicro, ledgerEntryId: String(ledger._id) };
            } catch (err2) {
                await creditBalanceRepo.incrementMicro(organizationId, costMicro);
                if (isDuplicateKeyError(err2)) {
                    const dup = await creditLedgerRepo.findByIdempotencyKey(
                        organizationId,
                        idempotencyKey,
                    );
                    if (dup) {
                        return {
                            ok: true,
                            balanceAfterMicro: dup.balanceAfterMicro,
                            ledgerEntryId: String(dup._id),
                            duplicate: true,
                        };
                    }
                }
                throw err2;
            }
        }

        throw err;
    } finally {
        await mongoSession.endSession();
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Manual adjustment (admin escape hatch)
// ────────────────────────────────────────────────────────────────────────────

export async function adjustCredits(input: AdjustCreditsInput): Promise<{
    balanceAfterMicro: number;
    ledgerEntryId: string;
    duplicate?: boolean;
}> {
    const { organizationId, amountMicro, idempotencyKey, metadata } = input;

    const existingLedger = await creditLedgerRepo.findByIdempotencyKey(
        organizationId,
        idempotencyKey,
    );

    if (existingLedger) {
        return {
            balanceAfterMicro: existingLedger.balanceAfterMicro,
            ledgerEntryId: String(existingLedger._id),
            duplicate: true,
        };
    }

    const balance = await getCreditBalance(organizationId);
    if (!balance) {
        throw new Error(`Credit balance not found for org: ${organizationId}`);
    }

    const state = await getOrgPlanState(organizationId);

    const balanceBeforeMicro = balance.balanceMicro;

    if (amountMicro < 0 && balanceBeforeMicro + amountMicro < 0) {
        throw new Error('Adjustment would make credit balance negative');
    }

    // Atomic adjust + ledger insert in a single transaction. For deductions the
    // balance decrement is guarded (`$gte`) so a concurrent race can never drive
    // the balance negative; balanceBefore is derived from the post-update value.
    const runAdjust = async (
        session?: mongoose.ClientSession,
    ): Promise<{ balanceAfterMicro: number; ledgerEntryId: string }> => {
        const balanceAfterMicro = await creditBalanceRepo.adjustGuarded(
            organizationId,
            amountMicro,
            session,
        );

        if (balanceAfterMicro === null) {
            throw new Error(
                amountMicro < 0
                    ? 'Adjustment would make credit balance negative'
                    : `Failed to adjust balance for org: ${organizationId}`,
            );
        }

        const ledger = await creditLedgerRepo.create(
            {
                organizationId,
                amountMicro,
                balanceBeforeMicro: balanceAfterMicro - amountMicro,
                balanceAfterMicro,
                source: 'manual_adjustment',
                idempotencyKey,
                metadata: mergeLedgerMetadata(metadata, state),
            },
            session,
        );

        return { balanceAfterMicro, ledgerEntryId: String(ledger._id) };
    };

    const mongoSession = await mongoose.startSession();
    try {
        let result: { balanceAfterMicro: number; ledgerEntryId: string } | undefined;
        await mongoSession.withTransaction(async () => {
            result = await runAdjust(mongoSession);
        });
        if (result) return result;
        throw new Error(`Failed to adjust balance for org: ${organizationId}`);
    } catch (err) {
        if (isDuplicateKeyError(err)) {
            const dup = await creditLedgerRepo.findByIdempotencyKey(organizationId, idempotencyKey);
            if (dup) {
                return {
                    balanceAfterMicro: dup.balanceAfterMicro,
                    ledgerEntryId: String(dup._id),
                    duplicate: true,
                };
            }
        }

        if (isTransactionUnsupported(err)) {
            // Standalone Mongo (local dev) — compensating fallback (legacy behavior).
            const balanceAfterMicro = await creditBalanceRepo.adjustGuarded(
                organizationId,
                amountMicro,
            );

            if (balanceAfterMicro === null) {
                throw new Error(`Failed to adjust balance for org: ${organizationId}`);
            }

            try {
                const ledger = await creditLedgerRepo.create({
                    organizationId,
                    amountMicro,
                    balanceBeforeMicro: balanceAfterMicro - amountMicro,
                    balanceAfterMicro,
                    source: 'manual_adjustment',
                    idempotencyKey,
                    metadata: mergeLedgerMetadata(metadata, state),
                });
                return { balanceAfterMicro, ledgerEntryId: String(ledger._id) };
            } catch (err2) {
                await creditBalanceRepo.incrementMicro(organizationId, -amountMicro);
                if (isDuplicateKeyError(err2)) {
                    const dup = await creditLedgerRepo.findByIdempotencyKey(
                        organizationId,
                        idempotencyKey,
                    );
                    if (dup) {
                        return {
                            balanceAfterMicro: dup.balanceAfterMicro,
                            ledgerEntryId: String(dup._id),
                            duplicate: true,
                        };
                    }
                }
                throw err2;
            }
        }

        throw err;
    } finally {
        await mongoSession.endSession();
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Status payload for /api/billing/status
// ────────────────────────────────────────────────────────────────────────────

export async function getBillingStatus(organizationId: string): Promise<{
    organizationId: string;
    planId: BillingPlanId | null;
    subscriptionStatus: SubscriptionStatus | null;
    billingCycle: string | null;
    periodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    balanceMicro: number | null;
    creditsRemaining: number | null;
    monthlyCredits: number | null;
    includedVideoSeconds: number | null;
    usedIncludedVideoSeconds: number | null;
    remainingIncludedVideoSeconds: number | null;
    purchasedVideoSeconds: number | null;
    usedPurchasedVideoSeconds: number | null;
    remainingPurchasedVideoSeconds: number | null;
    canBuyVideoPack: boolean;
    videoPackMinutes: number;
    videoPackPriceUsd: number | null;
    configured: boolean;
    lifecycleState: SubscriptionLifecycleState | null;
    pendingCheckoutPlanId: BillingPlanId | null;
}> {
    try {
        await reconcileOrgPlanWithStripe(organizationId);
    } catch (err) {
        console.warn('[billing/status] stripe reconcile skipped:', (err as Error).message);
    }
    try {
        await ensurePeriodCreditsSeeded(organizationId);
    } catch (err) {
        console.warn('[billing/status] credit seed skipped:', (err as Error).message);
    }

    let [state, balance] = await Promise.all([
        getOrgPlanState(organizationId),
        getCreditBalance(organizationId),
    ]);

    if (!state) {
        // حساب جديد بلا حالة فوترة → امنح الباقة المجانية تلقائياً (150 كردت
        // لمرة واحدة). لا تجديد شهري: ensurePeriodCreditsSeeded خاص بـ Stripe فقط.
        try {
            const seeded = await seedOrgBilling(organizationId, 'free');
            state = seeded.orgPlanState;
            balance = seeded.creditBalance;
            console.log(`[billing] auto-seeded free plan org=${organizationId} credits=150`);
        } catch (err) {
            console.warn('[billing/status] free plan auto-seed failed:', (err as Error).message);
        }
    }

    if (!state) {
        return {
            organizationId,
            planId: null,
            subscriptionStatus: null,
            billingCycle: null,
            periodEnd: null,
            cancelAtPeriodEnd: false,
            balanceMicro: null,
            creditsRemaining: null,
            monthlyCredits: null,
            includedVideoSeconds: null,
            usedIncludedVideoSeconds: null,
            remainingIncludedVideoSeconds: null,
            purchasedVideoSeconds: null,
            usedPurchasedVideoSeconds: null,
            remainingPurchasedVideoSeconds: null,
            canBuyVideoPack: false,
            videoPackMinutes: getVideoPackMinutes(),
            videoPackPriceUsd: null,
            configured: false,
            lifecycleState: null,
            pendingCheckoutPlanId: null,
        };
    }

    const balanceMicro = balance?.balanceMicro ?? 0;
    const includedVideoSeconds =
        balance?.includedVideoSeconds ?? getIncludedVideoSeconds(state.planId);
    const usedIncludedVideoSeconds = balance?.usedIncludedVideoSeconds ?? 0;
    const purchasedVideoSeconds = balance?.purchasedVideoSeconds ?? 0;
    const usedPurchasedVideoSeconds = balance?.usedPurchasedVideoSeconds ?? 0;
    const canBuyVideoPack = planAllowsVideo(state.planId);

    return {
        organizationId,
        planId: state.planId,
        subscriptionStatus: state.subscriptionStatus,
        billingCycle: state.billingCycle,
        periodEnd: balance?.periodEnd ?? state.currentPeriodEnd,
        cancelAtPeriodEnd: Boolean(state.cancelAtPeriodEnd),
        balanceMicro,
        // Floor to whole credits for display (don't show partial credits as "available").
        creditsRemaining: Math.floor(balanceMicro / MICRO_PER_CREDIT),
        monthlyCredits: balance?.monthlyCredits ?? getMonthlyCredits(state.planId),
        includedVideoSeconds,
        usedIncludedVideoSeconds,
        remainingIncludedVideoSeconds: Math.max(
            0,
            includedVideoSeconds - usedIncludedVideoSeconds,
        ),
        purchasedVideoSeconds,
        usedPurchasedVideoSeconds,
        remainingPurchasedVideoSeconds: Math.max(
            0,
            purchasedVideoSeconds - usedPurchasedVideoSeconds,
        ),
        canBuyVideoPack,
        videoPackMinutes: getVideoPackMinutes(),
        videoPackPriceUsd: canBuyVideoPack ? getVideoPackPriceUsd(state.planId) : null,
        configured: true,
        lifecycleState: resolveSubscriptionLifecycleState(state),
        pendingCheckoutPlanId: state.pendingCheckoutPlanId ?? null,
    };
}

/**
 * Credit a one-time video-pack purchase: add purchased video seconds that PERSIST
 * across billing periods. Idempotent via the unique (organizationId, idempotencyKey)
 * ledger index — replaying the same Stripe event is a no-op.
 *
 * Video packs never touch the credit balance (amountMicro = 0); they only grow
 * purchasedVideoSeconds. Returns whether the grant was newly applied.
 */
export async function applyVideoPackPurchase(
    organizationId: string,
    minutes: number,
    idempotencyKey: string,
    meta?: Record<string, unknown>,
): Promise<{ applied: boolean; addedSeconds: number }> {
    const addedSeconds = Math.max(0, Math.round(minutes)) * 60;
    if (addedSeconds <= 0) return { applied: false, addedSeconds: 0 };

    const balance = await getCreditBalance(organizationId);
    const balanceMicro = balance?.balanceMicro ?? 0;

    // Ledger-first: the unique index is the idempotency gate. If the row already
    // exists (replayed webhook), skip the increment entirely.
    try {
        await creditLedgerRepo.create({
            organizationId,
            amountMicro: 0,
            balanceBeforeMicro: balanceMicro,
            balanceAfterMicro: balanceMicro,
            units: addedSeconds,
            source: 'video_pack',
            idempotencyKey,
            metadata: { videoPackMinutes: minutes, addedSeconds, ...(meta ?? {}) },
        });
    } catch (err) {
        if (isDuplicateKeyError(err)) {
            return { applied: false, addedSeconds: 0 };
        }
        throw err;
    }

    await creditBalanceRepo.addPurchasedVideoSeconds(organizationId, addedSeconds);

    // Signals the client to refetch billing status (video seconds changed, not credits).
    void emitDomainEventBestEffort({
        organizationId,
        type: 'CreditBalanceRefreshed',
        payload: { balanceAfterMicro: balanceMicro, reason: 'video_pack', addedVideoSeconds: addedSeconds },
        idempotencyKey: `balance-refresh:${idempotencyKey}`,
    });

    return { applied: true, addedSeconds };
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 2b — Stripe state transitions (apply* functions)
//
// Architecture Contract 2: webhook handlers are translators.
// Every Stripe-driven mutation lives in this section. Handlers parse + dispatch.
// ────────────────────────────────────────────────────────────────────────────

export interface ApplyCheckoutSessionInput {
    organizationId: string;
    planId: BillingPlanId;
    cycle: BillingCycle;
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    currentPeriodStart?: Date;
    currentPeriodEnd?: Date;
    /** true when payment_status === 'paid' on the checkout session. */
    activate: boolean;
}

/**
 * Apply a completed Stripe checkout session to org_plan_state.
 *
 * Behavior:
 *   - Always upserts plan identity (planId, cycle, stripe IDs).
 *   - When `activate` is true (payment confirmed) → status='active' + seed balance.
 *   - When `activate` is false → status='incomplete' (waits for invoice.paid).
 */
export async function applyCheckoutSession(
    input: ApplyCheckoutSessionInput,
): Promise<IOrgPlanState> {
    const {
        organizationId,
        planId,
        cycle,
        stripeCustomerId,
        stripeSubscriptionId,
        currentPeriodStart,
        currentPeriodEnd,
        activate,
    } = input;

    const fallback = defaultPeriod();
    const periodStart = currentPeriodStart ?? fallback.start;
    const periodEnd = currentPeriodEnd ?? fallback.end;

    const updated = await OrgPlanState.findOneAndUpdate(
        { organizationId },
        {
            $set: {
                planId,
                billingProvider: 'stripe',
                subscriptionStatus: activate ? 'active' : 'incomplete',
                billingCycle: cycle,
                currentPeriodStart: periodStart,
                currentPeriodEnd: periodEnd,
                cancelAtPeriodEnd: false,
                seats: seatCountForPlan(planId),
                stripeCustomerId,
                stripeSubscriptionId,
            },
            $unset: {
                pendingCheckoutSessionId: 1,
                pendingCheckoutAt: 1,
                pendingCheckoutPlanId: 1,
                pendingCheckoutCycle: 1,
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
    ).exec();

    if (activate) {
        await seedBalanceForStripe(organizationId, planId, periodStart, periodEnd, {
            source: 'checkout',
            stripeSubscriptionId,
        });
    }

    return updated;
}

/**
 * Setup-mode Checkout completed — set default payment method on Stripe customer
 * (and active subscription when present). No Mongo mirror; portal reads live from Stripe.
 */
export async function applySetupCheckoutCompleted(
    session: import('stripe').Stripe.Checkout.Session,
): Promise<void> {
    const { finalizeSetupCheckoutSession } = await import('./stripeService.js');
    await finalizeSetupCheckoutSession(session);
}


export interface ApplySubscriptionUpdateInput {
    stripeSubscriptionId: string;
    planId: BillingPlanId;
    cycle: BillingCycle;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    subscriptionStatus: SubscriptionStatus;
}

/**
 * Sync Mongo org_plan_state with the latest Stripe subscription snapshot.
 * Triggered by `customer.subscription.updated` (plan switch, cancel-at-period-end toggle, status change).
 *
 * Provider ownership guard: only updates orgs whose billingProvider is already
 * 'stripe'. Prevents accidental cross-provider mutation if Paddle / manual
 * enterprise contracts are introduced later.
 */
export async function applySubscriptionUpdate(
    input: ApplySubscriptionUpdateInput,
): Promise<IOrgPlanState | null> {
    const { stripeSubscriptionId, ...changes } = input;
    const previous = await OrgPlanState.findOne({ stripeSubscriptionId, billingProvider: 'stripe' })
        .lean()
        .exec();

    const updated = await OrgPlanState.findOneAndUpdate(
        { stripeSubscriptionId, billingProvider: 'stripe' },
        {
            $set: {
                planId: changes.planId,
                billingCycle: changes.cycle,
                currentPeriodStart: changes.currentPeriodStart,
                currentPeriodEnd: changes.currentPeriodEnd,
                cancelAtPeriodEnd: changes.cancelAtPeriodEnd,
                subscriptionStatus: changes.subscriptionStatus,
                seats: seatCountForPlan(changes.planId),
            },
        },
        { new: true },
    ).exec();

    if (!updated) return null;

    const planChanged = previous?.planId != null && previous.planId !== changes.planId;

    if (planChanged && isBillingActive(changes.subscriptionStatus)) {
        await seedBalanceForStripe(
            updated.organizationId,
            changes.planId,
            changes.currentPeriodStart,
            changes.currentPeriodEnd,
            { source: 'plan_change', stripeSubscriptionId, planId: changes.planId },
            updated,
        );
    } else {
        await creditBalanceRepo.setFields(updated.organizationId, {
            monthlyCredits: getMonthlyCredits(changes.planId),
            includedVideoSeconds: getIncludedVideoSeconds(changes.planId),
            periodStart: changes.currentPeriodStart,
            periodEnd: changes.currentPeriodEnd,
        });
    }

    return updated;
}

function mapStripeSubscriptionStatus(status: string): SubscriptionStatus {
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

export type ReconcileOrgPlanResult = {
    changed: boolean;
    planId: BillingPlanId;
    cycle: BillingCycle;
};

/**
 * Mirror Stripe subscription identity onto org_plan_state when they drift.
 * Stripe is authoritative for planId/cycle on stripe-owned orgs.
 */
export async function reconcileOrgPlanWithStripe(
    organizationId: string,
): Promise<ReconcileOrgPlanResult | null> {
    const state = await getOrgPlanState(organizationId);
    if (!state?.stripeSubscriptionId || state.billingProvider !== 'stripe') {
        return null;
    }

    const { retrieveSubscription } = await import('./stripeService.js');
    const { resolvePlanForStripePrice } = await import('../config/stripePrices.js');

    const sub = await retrieveSubscription(state.stripeSubscriptionId);
    if (!sub) return null;

    const item = sub.items?.data?.[0];
    const priceId =
        typeof item?.price === 'string' ? item.price : item?.price?.id;
    if (!priceId) return null;

    const mapping = resolvePlanForStripePrice(priceId);
    if (!mapping) return null;

    const itemRaw = item as unknown as {
        current_period_start?: number;
        current_period_end?: number;
    };
    const subRaw = sub as unknown as {
        current_period_start?: number;
        current_period_end?: number;
    };
    const startSec =
        itemRaw.current_period_start ?? subRaw.current_period_start ?? Math.floor(Date.now() / 1000);
    const endSec =
        itemRaw.current_period_end ??
        subRaw.current_period_end ??
        startSec + 30 * 24 * 3600;

    const subscriptionStatus = mapStripeSubscriptionStatus(sub.status);
    const periodStart = new Date(startSec * 1000);
    const periodEnd = new Date(endSec * 1000);
    const cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end);

    const identityUnchanged =
        state.planId === mapping.planId &&
        state.billingCycle === mapping.cycle &&
        state.subscriptionStatus === subscriptionStatus &&
        state.cancelAtPeriodEnd === cancelAtPeriodEnd;
    const periodUnchanged =
        periodDatesMatch(state.currentPeriodStart, periodStart) &&
        periodDatesMatch(state.currentPeriodEnd, periodEnd);

    if (identityUnchanged && periodUnchanged) {
        return { changed: false, planId: mapping.planId, cycle: mapping.cycle };
    }

    await applySubscriptionUpdate({
        stripeSubscriptionId: state.stripeSubscriptionId,
        planId: mapping.planId,
        cycle: mapping.cycle,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd,
        subscriptionStatus,
    });

    console.log(
        `[billing] reconciled org=${organizationId} mongo=${state.planId}/${state.billingCycle} → stripe=${mapping.planId}/${mapping.cycle}`,
    );

    return { changed: true, planId: mapping.planId, cycle: mapping.cycle };
}

export interface ApplySubscriptionCanceledInput {
    stripeSubscriptionId: string;
}

/**
 * Hard cancel — Stripe `customer.subscription.deleted`.
 * Sets status='canceled' and clears cancelAtPeriodEnd (already canceled).
 * `consumeCredits` immediately rejects via isBillingActive().
 *
 * Provider ownership guard: only mutates rows already owned by stripe.
 */
export async function applySubscriptionCanceled(
    input: ApplySubscriptionCanceledInput,
): Promise<IOrgPlanState | null> {
    return OrgPlanState.findOneAndUpdate(
        { stripeSubscriptionId: input.stripeSubscriptionId, billingProvider: 'stripe' },
        { $set: { subscriptionStatus: 'canceled', cancelAtPeriodEnd: false } },
        { new: true },
    ).exec();
}

export interface ApplyInvoicePaidInput {
    stripeCustomerId: string;
    currentPeriodStart?: Date;
    currentPeriodEnd?: Date;
    stripeInvoiceId?: string;
}

/**
 * Recurring billing success — `invoice.paid`.
 *
 * Effects:
 *   1. Set status='active' (covers past_due → active recovery).
 *   2. Roll period dates forward.
 *   3. Refresh balance to plan-included amounts + write ledger entry with planSnapshot.
 *
 * Race safety guard (out-of-order delivery):
 *   Stripe retries can deliver invoice.paid events out of order — period N+1
 *   may arrive before a delayed period N. If the incoming periodEnd is not
 *   strictly after the stored periodEnd, treat as stale and no-op. This keeps
 *   balance + ledger monotonic relative to subscription periods.
 *
 * Provider ownership guard: only mutates stripe-owned rows.
 *
 * Idempotency: ledger key = `stripe:invoice:<invoiceId>` when provided, otherwise
 * derived from period start. Same invoice arriving twice (different event.id)
 * collides on the unique compound index and is silently ignored.
 */
export async function applyInvoicePaid(
    input: ApplyInvoicePaidInput,
): Promise<IOrgPlanState | null> {
    const state = await findOrgByStripeCustomerId(input.stripeCustomerId);
    if (!state) return null;

    const fallback = defaultPeriod();
    const periodStart = input.currentPeriodStart ?? fallback.start;
    const periodEnd = input.currentPeriodEnd ?? fallback.end;

    if (
        state.currentPeriodEnd &&
        periodEnd.getTime() <= state.currentPeriodEnd.getTime()
    ) {
        console.log(
            `[billing] invoice.paid skipped (out-of-order) — org=${state.organizationId} incomingPeriodEnd=${periodEnd.toISOString()} <= currentPeriodEnd=${state.currentPeriodEnd.toISOString()}`,
        );
        return state;
    }

    const next = await OrgPlanState.findOneAndUpdate(
        { organizationId: state.organizationId, billingProvider: 'stripe' },
        {
            $set: {
                subscriptionStatus: 'active',
                currentPeriodStart: periodStart,
                currentPeriodEnd: periodEnd,
            },
        },
        { new: true },
    ).exec();

    if (!next) {
        console.warn(
            `[billing] invoice.paid skipped — org=${state.organizationId} is not stripe-owned (provider=${state.billingProvider}).`,
        );
        return state;
    }

    await seedBalanceForStripe(
        state.organizationId,
        next.planId,
        periodStart,
        periodEnd,
        {
            source: 'invoice_paid',
            stripeInvoiceId: input.stripeInvoiceId,
        },
        next,
    );

    return next;
}

export interface ApplyPaymentFailedInput {
    stripeCustomerId: string;
    stripeInvoiceId?: string;
}

/**
 * Payment failure — `invoice.payment_failed`. Status flips to past_due.
 * `consumeCredits` then blocks via isBillingActive().
 * Provider ownership guard: only flips stripe-owned rows.
 */
export async function applyPaymentFailed(
    input: ApplyPaymentFailedInput,
): Promise<IOrgPlanState | null> {
    const updated = await OrgPlanState.findOneAndUpdate(
        { stripeCustomerId: input.stripeCustomerId, billingProvider: 'stripe' },
        { $set: { subscriptionStatus: 'past_due' } },
        { new: true },
    ).exec();
    if (updated && input.stripeInvoiceId) {
        console.warn(
            `[billing] payment_failed org=${updated.organizationId} invoice=${input.stripeInvoiceId} → past_due`,
        );
    }
    return updated;
}

// ────────────────────────────────────────────────────────────────────────────
// Internal — seed/refresh balance + ledger for Stripe events
// ────────────────────────────────────────────────────────────────────────────

interface SeedBalanceContext {
    source: 'checkout' | 'invoice_paid' | 'reconcile' | 'migrate' | 'plan_change';
    stripeSubscriptionId?: string;
    stripeInvoiceId?: string;
    planId?: BillingPlanId;
}

async function seedBalanceForStripe(
    organizationId: string,
    planId: BillingPlanId,
    periodStart: Date,
    periodEnd: Date,
    context: SeedBalanceContext,
    stateOverride?: IOrgPlanState,
): Promise<void> {
    const balanceMicro = balanceMicroFromPlan(planId);
    const monthlyCredits = getMonthlyCredits(planId);
    const includedVideoSeconds = getIncludedVideoSeconds(planId);
    const now = new Date();

    const previous = await getCreditBalance(organizationId);
    const balanceBeforeMicro = previous?.balanceMicro ?? 0;

    const state = stateOverride ?? (await getOrgPlanState(organizationId));
    const idempotencyKey =
        context.source === 'migrate' && context.stripeSubscriptionId && context.planId
            ? `stripe:migrate-unified:${context.stripeSubscriptionId}:${context.planId}`
            : context.source === 'plan_change' && context.stripeSubscriptionId && context.planId
              ? `stripe:plan-change:${context.stripeSubscriptionId}:${context.planId}:${periodStart.getTime()}`
              : context.source === 'reconcile' && context.stripeSubscriptionId
                ? `stripe:reconcile-seed:${context.stripeSubscriptionId}:${periodStart.getTime()}`
                : context.stripeInvoiceId
                  ? `stripe:invoice:${context.stripeInvoiceId}`
                  : context.stripeSubscriptionId
                    ? `stripe:checkout:${context.stripeSubscriptionId}:${periodStart.getTime()}`
                    : `stripe:refresh:${organizationId}:${periodStart.getTime()}`;

    // Mode A: balance snapshot + ledger + CreditBalanceRefreshed commit atomically.
    await refreshBalanceAtomically(
        organizationId,
        {
            balanceMicro,
            monthlyCredits,
            includedVideoSeconds,
            // checkout / invoice.paid mark a NEW billing period → reset usage.
            usedIncludedVideoSeconds: 0,
            periodStart,
            periodEnd,
            refreshedFromPlanAt: now,
        },
        { unset: { balances: 1 } },
        {
            amountMicro: balanceMicro - balanceBeforeMicro,
            balanceBeforeMicro,
            balanceAfterMicro: balanceMicro,
            sourceId: context.stripeInvoiceId || context.stripeSubscriptionId,
            idempotencyKey,
            metadata: mergeLedgerMetadata(
                {
                    stripeSource: context.source,
                    stripeInvoiceId: context.stripeInvoiceId,
                    stripeSubscriptionId: context.stripeSubscriptionId,
                },
                state,
            ),
        },
        { balanceAfterMicro: balanceMicro, monthlyCredits, reason: context.source },
    );
}

// ────────────────────────────────────────────────────────────────────────────
// Activity feed (credit ledger — all metered operations)
// ────────────────────────────────────────────────────────────────────────────

export async function listOrgBillingActivity(
    organizationId: string,
    options: { since?: Date; limit?: number } = {},
): Promise<BillingActivityEntry[]> {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
    const query: Record<string, unknown> = {
        organizationId,
        usageType: { $exists: true, $ne: null },
    };
    if (options.since) {
        query.createdAt = { $gte: options.since };
    }

    const rows = await creditLedgerRepo.list(query, { sort: { createdAt: -1 }, limit });

    return rows.map((row) => {
        const chargedMicro =
            typeof row.chargedMicroCredits === 'number' && row.chargedMicroCredits > 0
                ? row.chargedMicroCredits
                : Math.abs(row.amountMicro ?? 0);
        const credits = chargedMicro / MICRO_PER_CREDIT;
        return {
            id: String(row._id),
            createdAt:
                row.createdAt instanceof Date
                    ? row.createdAt.toISOString()
                    : new Date(row.createdAt).toISOString(),
            usageType: row.usageType as UsageType,
            source: row.source as BillingActivityEntry['source'],
            units: typeof row.units === 'number' ? row.units : undefined,
            credits,
            amountMicro: row.amountMicro ?? 0,
        };
    });
}
