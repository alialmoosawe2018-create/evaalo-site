/**
 * Extra video-minute packs — DATA ONLY (display prices + pack size).
 *
 * After a plan's included video minutes are exhausted, video can only continue
 * by purchasing these one-time packs (NEVER by spending credits). The Stripe
 * Price IDs that back these packs live in config/stripePrices.ts (runtime env),
 * because they rotate between test/live; this file holds only catalog display
 * data and the pack size.
 *
 * Frontend mirror: apps/frontend/src/config/videoPacks.js (keep in sync).
 *
 * Pricing (flat pack price for all video-capable plans):
 *   Team / Professional / Business  $20.00 / 50 min  ($0.40/min)
 *   Starter                         no video → no pack
 */

import type { BillingPlanId } from '../types/billing.js';

/** Minutes granted by a single extra video pack. */
export const VIDEO_PACK_MINUTES = 50;

/** Display price (USD) of one 50-minute pack, per plan. Null = pack not offered. */
export const VIDEO_PACK_PRICE_USD: Record<BillingPlanId, number | null> = {
    starter: null,
    team: 20,
    professional: 20,
    business: 20,
};
