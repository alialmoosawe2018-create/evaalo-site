/**
 * Operational subscription state per organization.
 * Billing authority (Phase 2a): Mongo org_plan_state — NOT Clerk metadata.
 * Phase 2b: Stripe webhooks update this collection.
 */

import mongoose, { Schema, Document } from 'mongoose';
import type { BillingCycle, BillingPlanId, BillingProvider, SubscriptionStatus } from '../types/billing.js';

export interface IOrgPlanState extends Document {
    organizationId: string;
    planId: BillingPlanId;
    billingProvider: BillingProvider;
    subscriptionStatus: SubscriptionStatus;
    billingCycle: BillingCycle;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    seats: number;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    /** Set when Stripe Checkout session is created; cleared on checkout.session.completed. */
    pendingCheckoutSessionId?: string;
    pendingCheckoutAt?: Date;
    pendingCheckoutPlanId?: BillingPlanId;
    pendingCheckoutCycle?: BillingCycle;
    createdAt: Date;
    updatedAt: Date;
}

const OrgPlanStateSchema = new Schema<IOrgPlanState>(
    {
        organizationId: {
            type: String,
            required: true,
            unique: true,
            index: true,
            trim: true,
        },
        planId: {
            type: String,
            required: true,
            enum: ['starter', 'team', 'professional', 'business'],
        },
        billingProvider: {
            type: String,
            required: true,
            enum: ['manual', 'stripe'],
            default: 'manual',
        },
        subscriptionStatus: {
            type: String,
            required: true,
            enum: ['active', 'trialing', 'past_due', 'canceled', 'incomplete'],
            default: 'active',
        },
        billingCycle: {
            type: String,
            required: true,
            enum: ['monthly', 'annual'],
            default: 'monthly',
        },
        currentPeriodStart: { type: Date, required: true },
        currentPeriodEnd: { type: Date, required: true },
        cancelAtPeriodEnd: { type: Boolean, default: false },
        seats: { type: Number, required: true, min: 1, default: 1 },
        stripeCustomerId: { type: String, trim: true },
        stripeSubscriptionId: { type: String, trim: true },
        pendingCheckoutSessionId: { type: String, trim: true },
        pendingCheckoutAt: { type: Date },
        pendingCheckoutPlanId: {
            type: String,
            enum: ['starter', 'team', 'professional', 'business'],
        },
        pendingCheckoutCycle: { type: String, enum: ['monthly', 'annual'] },
    },
    { timestamps: true, collection: 'org_plan_states' },
);

export default mongoose.model<IOrgPlanState>('OrgPlanState', OrgPlanStateSchema);
