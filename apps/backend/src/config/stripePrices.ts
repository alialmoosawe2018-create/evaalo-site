/**
 * Stripe price ID ⇄ catalog plan mapping (Phase 2b).
 *
 * Architecture contract:
 *   - Source of truth for plan data is `config/billingPlans.ts` (catalog DATA only).
 *   - This file lives outside the catalog because price IDs come from Stripe Dashboard
 *     and rotate between environments (test vs live). Treat as runtime config.
 *   - All 4 plans (starter/team/professional/business) are paid Stripe subscriptions.
 *
 * `validateStripePrices()` is a fail-fast boot check called from `server.ts` BEFORE
 * `app.listen()`. It catches misconfigured envs before a single webhook arrives.
 */

import type { BillingCycle, BillingPlanId } from '../types/billing.js';

type StripePriceMapping = { planId: BillingPlanId; cycle: BillingCycle };

interface PriceMapEntry {
    planId: BillingPlanId;
    cycle: BillingCycle;
    envVar: string;
}

/** Monthly subscription prices only — annual billing is not offered. */
const PRICE_MAP_ENTRIES: PriceMapEntry[] = [
    { planId: 'starter', cycle: 'monthly', envVar: 'STRIPE_PRICE_STARTER_MONTHLY' },
    { planId: 'team', cycle: 'monthly', envVar: 'STRIPE_PRICE_TEAM_MONTHLY' },
    { planId: 'professional', cycle: 'monthly', envVar: 'STRIPE_PRICE_PROFESSIONAL_MONTHLY' },
    { planId: 'business', cycle: 'monthly', envVar: 'STRIPE_PRICE_BUSINESS_MONTHLY' },
];

function buildPriceToPlanMap(): Record<string, StripePriceMapping> {
    const map: Record<string, StripePriceMapping> = {};
    for (const entry of PRICE_MAP_ENTRIES) {
        const priceId = (process.env[entry.envVar] || '').trim();
        if (!priceId) continue;
        map[priceId] = { planId: entry.planId, cycle: entry.cycle };
    }
    return map;
}

/**
 * Lookup table: Stripe price ID → catalog identity.
 * Built lazily on first access so env vars loaded by `loadEnv` are picked up.
 */
let cachedPriceMap: Record<string, StripePriceMapping> | null = null;

function getPriceMap(): Record<string, StripePriceMapping> {
    if (cachedPriceMap === null) {
        cachedPriceMap = buildPriceToPlanMap();
    }
    return cachedPriceMap;
}

/** Exposed for tests / verify scripts that need to inspect the map. */
export function STRIPE_PRICE_TO_PLAN(): Record<string, StripePriceMapping> {
    return { ...getPriceMap() };
}

/**
 * Resolve the Stripe price ID for a (planId, cycle) pair.
 * Returns null if not configured.
 */
export function getStripePriceId(
    planId: BillingPlanId,
    cycle: BillingCycle,
): string | null {
    const entry = PRICE_MAP_ENTRIES.find(
        (e) => e.planId === planId && e.cycle === cycle,
    );
    if (!entry) return null;
    const value = (process.env[entry.envVar] || '').trim();
    return value || null;
}

/**
 * Reverse lookup: Stripe price ID → catalog identity.
 * Returns null for unknown price IDs (handlers no-op rather than crash).
 */
export function getPlanForStripePrice(priceId: string): StripePriceMapping | null {
    if (!priceId) return null;
    const map = getPriceMap();
    return map[priceId] ?? null;
}

let cachedLegacyPriceMap: Record<string, StripePriceMapping> | null = null;

function parseLegacyPriceMap(): Record<string, StripePriceMapping> {
    const raw = (process.env.BILLING_LEGACY_PRICE_MAP || '').trim();
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw) as Record<
            string,
            { planId?: BillingPlanId; cycle?: BillingCycle }
        >;
        const out: Record<string, StripePriceMapping> = {};
        for (const [priceId, entry] of Object.entries(parsed)) {
            if (!priceId.startsWith('price_')) continue;
            const planId = entry?.planId;
            const cycle = entry?.cycle;
            if (
                planId &&
                cycle &&
                (PRICE_MAP_ENTRIES.some((e) => e.planId === planId && e.cycle === cycle))
            ) {
                out[priceId] = { planId, cycle };
            }
        }
        return out;
    } catch {
        console.warn('[stripePrices] BILLING_LEGACY_PRICE_MAP is invalid JSON — ignoring.');
        return {};
    }
}

function getLegacyPriceMap(): Record<string, StripePriceMapping> {
    if (cachedLegacyPriceMap === null) {
        cachedLegacyPriceMap = parseLegacyPriceMap();
    }
    return cachedLegacyPriceMap;
}

/**
 * Resolve Stripe price ID → plan identity (current env prices + optional legacy map).
 * Returns null for unknown IDs — callers must NOT silently default to starter.
 */
export function resolvePlanForStripePrice(priceId: string): StripePriceMapping | null {
    const direct = getPlanForStripePrice(priceId);
    if (direct) return direct;
    return getLegacyPriceMap()[priceId] ?? null;
}

/** All configured subscription price IDs (monthly/annual plans). */
export function listConfiguredStripePriceIds(): string[] {
    return Object.keys(getPriceMap());
}

/**
 * One-time video-pack price IDs (Stripe `mode: 'payment'`), one per video-capable
 * plan. Starter has no video so no pack price. These are separate products from
 * the recurring subscription prices above.
 */
const VIDEO_PACK_PRICE_ENV: Partial<Record<BillingPlanId, string>> = {
    team: 'STRIPE_PRICE_VIDEOPACK_TEAM',
    professional: 'STRIPE_PRICE_VIDEOPACK_PROFESSIONAL',
    business: 'STRIPE_PRICE_VIDEOPACK_BUSINESS',
};

/**
 * Resolve the one-time Stripe price ID for a plan's video pack.
 * Returns null when the plan has no pack (Starter) or the env var is unset.
 */
export function getVideoPackStripePriceId(planId: BillingPlanId): string | null {
    const envVar = VIDEO_PACK_PRICE_ENV[planId];
    if (!envVar) return null;
    const value = (process.env[envVar] || '').trim();
    return value || null;
}

/**
 * Boot-time integrity check.
 *
 * Invariants enforced:
 *   1. Each (starter | team | professional | business) monthly price
 *      has a non-empty env var.
 *   2. No two entries share the same price ID.
 *   3. Every configured value starts with `price_` (Stripe convention).
 *
 * Severity policy:
 *   - Invalid entries (malformed / duplicate) ALWAYS throw — they signal a real
 *     config mistake regardless of environment.
 *   - Missing entries throw in production (fail-fast) but only warn outside it,
 *     so dev can boot before every plan×cycle price exists in Stripe. Checkout
 *     for an unconfigured plan still fails clearly at call time via getStripePriceId.
 */
export function validateStripePrices(): void {
    cachedPriceMap = null;

    const missing: string[] = [];
    const invalid: string[] = [];
    const seen = new Map<string, string>();

    for (const entry of PRICE_MAP_ENTRIES) {
        const raw = (process.env[entry.envVar] || '').trim();
        if (!raw) {
            missing.push(entry.envVar);
            continue;
        }
        if (!raw.startsWith('price_')) {
            invalid.push(`${entry.envVar}=${raw} (must start with "price_")`);
            continue;
        }
        const prev = seen.get(raw);
        if (prev) {
            invalid.push(
                `${entry.envVar} duplicates ${prev} — each plan×cycle must have a unique Stripe price ID`,
            );
            continue;
        }
        seen.set(raw, entry.envVar);
    }

    const packMissing: string[] = [];
    for (const [planId, envVar] of Object.entries(VIDEO_PACK_PRICE_ENV)) {
        const raw = (process.env[envVar] || '').trim();
        if (!raw) {
            packMissing.push(`${envVar} (${planId} video pack)`);
            continue;
        }
        if (!raw.startsWith('price_')) {
            invalid.push(`${envVar}=${raw} (must start with "price_")`);
        }
    }

    const isProduction = process.env.NODE_ENV === 'production';
    const missingIsFatal = isProduction && missing.length > 0;

    if (invalid.length > 0 || missingIsFatal) {
        const lines = [
            '[stripePrices] Misconfiguration detected — refusing to start.',
            ...(missingIsFatal ? [`  Missing env vars: ${missing.join(', ')}`] : []),
            ...(invalid.length ? [`  Invalid entries:`, ...invalid.map((e) => `    - ${e}`)] : []),
            '  Fix in apps/backend/.env or set them in the deployment environment.',
        ];
        throw new Error(lines.join('\n'));
    }

    cachedPriceMap = buildPriceToPlanMap();

    if (missing.length > 0) {
        console.warn(
            `[stripePrices] WARNING — ${missing.length} subscription price env var(s) missing: ${missing.join(', ')}. ` +
                `Checkout for those plan/cycle pairs will fail until configured. ` +
                `(non-production: continuing with ${Object.keys(cachedPriceMap).length} mapped price ID(s).)`,
        );
    }
    if (packMissing.length > 0) {
        console.warn(
            `[stripePrices] WARNING — video pack price(s) missing: ${packMissing.join(', ')}. ` +
                `Video pack checkout will fail for those plans until configured ($20 / 50 min in catalog).`,
        );
    }
    if (missing.length === 0 && packMissing.length === 0) {
        console.log(
            `[stripePrices] OK — ${Object.keys(cachedPriceMap).length} subscription price IDs + video packs configured.`,
        );
        return;
    }
    if (missing.length > 0) {
        return;
    }

    console.log(
        `[stripePrices] OK — ${Object.keys(cachedPriceMap).length} subscription price ID(s) mapped; configure video pack env vars for full checkout.`,
    );
}
