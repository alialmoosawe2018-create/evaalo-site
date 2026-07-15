/**
 * Live unified credit balance per organization — runtime source for remaining credits.
 * Catalog (billingPlans.ts) defines the monthly allowance; this collection holds
 * what is left, tracked in microCredits (1 credit = 1e6 µ) for per-second precision.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface ICreditBalance extends Document {
    organizationId: string;
    /** Remaining balance in microCredits (1 credit = 1,000,000 µ). */
    balanceMicro: number;
    /** Whole-credit monthly allowance snapshot for this period (for display %). */
    monthlyCredits: number;
    /** Included video seconds granted by the plan for this period (reset monthly). */
    includedVideoSeconds: number;
    /** Included video seconds consumed this period (reset only on a new period). */
    usedIncludedVideoSeconds: number;
    /**
     * Extra video seconds purchased via one-time packs. PERSISTS across billing
     * periods (cash purchase) — never reset by seed/refresh/Stripe-period events.
     */
    purchasedVideoSeconds: number;
    /** Purchased video seconds consumed to date. Persists across periods. */
    usedPurchasedVideoSeconds: number;
    /**
     * Atomic single-active-video lock. While set, no second video session may
     * start for this organization.
     */
    activeVideoSessionId?: string | null;
    /** Auto-expiry for the active video lock; the sweep settles/releases it. */
    activeVideoSessionExpiresAt?: Date | null;
    periodStart: Date;
    periodEnd: Date;
    refreshedFromPlanAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

const CreditBalanceSchema = new Schema<ICreditBalance>(
    {
        organizationId: {
            type: String,
            required: true,
            unique: true,
            index: true,
            trim: true,
        },
        balanceMicro: { type: Number, required: true, min: 0, default: 0 },
        monthlyCredits: { type: Number, required: true, min: 0, default: 0 },
        includedVideoSeconds: { type: Number, required: true, min: 0, default: 0 },
        usedIncludedVideoSeconds: { type: Number, required: true, min: 0, default: 0 },
        purchasedVideoSeconds: { type: Number, required: true, min: 0, default: 0 },
        usedPurchasedVideoSeconds: { type: Number, required: true, min: 0, default: 0 },
        activeVideoSessionId: { type: String, trim: true, default: null },
        activeVideoSessionExpiresAt: { type: Date, default: null },
        periodStart: { type: Date, required: true },
        periodEnd: { type: Date, required: true },
        refreshedFromPlanAt: { type: Date, required: true },
    },
    { timestamps: true, collection: 'credit_balances' },
);

export default mongoose.model<ICreditBalance>('CreditBalance', CreditBalanceSchema);
