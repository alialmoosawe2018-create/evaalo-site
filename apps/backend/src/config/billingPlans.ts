/**
 * Billing plans catalog — DATA ONLY (no helpers, no logic).
 *
 * Source of truth for plan IDs, monthly credit allowance, features, pricing,
 * and seat limits. All logic lives in `services/billingEngine.ts`.
 *
 * Frontend mirror: apps/frontend/src/config/billingPlans.js
 * Keep both files in sync manually until a build script ships.
 *
 * Unified credit model:
 *   - 4 plans: starter / team / professional / business
 *   - single monthly intelligence-credit pool per plan (monthlyCredits)
 *   - Video interviews + private links gated to team and above (launch protection)
 */

import type { BillingPlan, BillingPlanId } from '../types/billing.js';

const SEAT_LIMIT_SINGLE: { type: 'fixed'; value: number } = { type: 'fixed', value: 1 };

/** Features shared by every plan (no video, no private links). */
const STARTER_FEATURES: BillingPlan['features'] = [
    'screening.basic',
    'screening.cv_compare',
    'interviews.voice',
    'search.headhunter',
    'jobs.display',
    'jobs.publish',
    'reports.ai_scoring',
    'ads.basic',
    'voice.default',
];

/** Team adds advanced interviews (video), private links, limited custom voice. */
const TEAM_FEATURES: BillingPlan['features'] = [
    ...STARTER_FEATURES,
    'interviews.video',
    'interviews.privateLinks',
    'voice.identity.customization',
];

/** Professional adds advanced screening, campaign ads, priority + deeper analytics. */
const PROFESSIONAL_FEATURES: BillingPlan['features'] = [
    ...TEAM_FEATURES,
    'screening.advanced',
    'avatar.branding',
];

/** Business adds custom integrations and priority support (avatar.branding inherited from Professional). */
const BUSINESS_FEATURES: BillingPlan['features'] = [
    ...PROFESSIONAL_FEATURES,
    'integrations.custom',
    'support.priority',
];

export const BILLING_PLANS: readonly BillingPlan[] = [
    {
        id: 'starter',
        displayNameKey: 'billing_plan_starter_name',
        displayDescKey: 'billing_plan_starter_desc',
        price: { monthly: 39, currency: 'USD' },
        seatLimit: SEAT_LIMIT_SINGLE,
        monthlyCredits: 500,
        includedVideoMinutes: 0,
        features: STARTER_FEATURES,
    },
    {
        id: 'team',
        displayNameKey: 'billing_plan_team_name',
        displayDescKey: 'billing_plan_team_desc',
        price: { monthly: 99, currency: 'USD' },
        seatLimit: SEAT_LIMIT_SINGLE,
        monthlyCredits: 1500,
        includedVideoMinutes: 50,
        features: TEAM_FEATURES,
    },
    {
        id: 'professional',
        displayNameKey: 'billing_plan_professional_name',
        displayDescKey: 'billing_plan_professional_desc',
        price: { monthly: 189, currency: 'USD' },
        seatLimit: SEAT_LIMIT_SINGLE,
        monthlyCredits: 3500,
        includedVideoMinutes: 100,
        features: PROFESSIONAL_FEATURES,
        flags: { popular: true },
    },
    {
        id: 'business',
        displayNameKey: 'billing_plan_business_name',
        displayDescKey: 'billing_plan_business_desc',
        price: { monthly: 359, currency: 'USD' },
        seatLimit: SEAT_LIMIT_SINGLE,
        monthlyCredits: 7000,
        includedVideoMinutes: 150,
        features: BUSINESS_FEATURES,
    },
];

export const DEFAULT_PLAN_ID: BillingPlanId = 'starter';
