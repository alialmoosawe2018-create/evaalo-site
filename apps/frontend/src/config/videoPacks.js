/**
 * Extra video-minute packs — frontend data mirror (DATA ONLY).
 *
 * Keep in sync with apps/backend/src/config/videoPacks.ts (manual sync).
 *
 * After a plan's included video minutes run out, video continues only by buying
 * these one-time packs (never by spending credits). Stripe Price IDs live on the
 * backend; the frontend only shows the price + pack size and triggers checkout.
 *
 * Pricing (flat for all video-capable plans):
 *   Team / Professional / Business  $20.00 / 50 min
 *   Starter                         no video → no pack
 */

export const VIDEO_PACK_MINUTES = 50;

export const VIDEO_PACK_PRICE_USD = Object.freeze({
    starter: null,
    team: 20,
    professional: 20,
    business: 20,
});
