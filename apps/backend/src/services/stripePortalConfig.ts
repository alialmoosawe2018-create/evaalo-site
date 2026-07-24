/**
 * Ensures Stripe Customer Portal has subscription_update enabled so plan changes
 * can use the hosted subscription_update_confirm flow.
 */

import type Stripe from 'stripe';
import { listConfiguredStripePriceIds } from '../config/stripePrices.js';

let cachedPortalConfigId: string | null = null;

async function stripeClient(): Promise<Stripe> {
    const { getStripeClient } = await import('./stripeService.js');
    return getStripeClient();
}

function explicitPortalConfigId(): string | undefined {
    const id = (process.env.STRIPE_BILLING_PORTAL_CONFIG_ID || '').trim();
    return id || undefined;
}

async function buildPortalProductsFromPrices(): Promise<
    Array<{ product: string; prices: string[] }>
> {
    const priceIds = listConfiguredStripePriceIds();
    if (priceIds.length === 0) {
        throw new Error('[stripePortalConfig] No Stripe subscription price IDs configured.');
    }

    const stripe = await stripeClient();
    const byProduct = new Map<string, Set<string>>();

    for (const priceId of priceIds) {
        const price = await stripe.prices.retrieve(priceId);
        const productId =
            typeof price.product === 'string' ? price.product : price.product?.id;
        if (!productId) continue;
        if (!byProduct.has(productId)) byProduct.set(productId, new Set());
        byProduct.get(productId)!.add(priceId);
    }

    if (byProduct.size === 0) {
        throw new Error('[stripePortalConfig] Could not resolve Stripe products from price IDs.');
    }

    return Array.from(byProduct.entries()).map(([product, prices]) => ({
        product,
        prices: Array.from(prices),
    }));
}

function portalFeaturePatch(
    products: Array<{ product: string; prices: string[] }>,
): Stripe.BillingPortal.ConfigurationUpdateParams['features'] {
    return {
        subscription_update: {
            enabled: true,
            default_allowed_updates: ['price'],
            // always_invoice: bill the proration immediately on any plan change, so
            // an upgrade produces an immediate invoice/receipt (matching new-sub
            // Checkout behavior) instead of deferring the charge to the next cycle.
            proration_behavior: 'always_invoice',
            products,
        },
        subscription_cancel: {
            enabled: true,
            mode: 'at_period_end',
        },
        payment_method_update: {
            enabled: true,
        },
        invoice_history: {
            enabled: true,
        },
    } as Stripe.BillingPortal.ConfigurationUpdateParams['features'];
}

async function upsertPortalConfiguration(configId?: string): Promise<string> {
    const products = await buildPortalProductsFromPrices();
    const features = portalFeaturePatch(products);
    const stripe = await stripeClient();

    if (configId) {
        await stripe.billingPortal.configurations.update(configId, { features });
        return configId;
    }

    const configs = await stripe.billingPortal.configurations.list({ limit: 10, active: true });
    const existing = configs.data.find((c) => c.is_default) ?? configs.data[0];
    if (existing) {
        await stripe.billingPortal.configurations.update(existing.id, { features });
        return existing.id;
    }

    const created = await stripe.billingPortal.configurations.create({
        features: features as Stripe.BillingPortal.ConfigurationCreateParams['features'],
        metadata: { source: 'evaalo-billing' },
    });
    return created.id;
}

/**
 * Resolve (and if needed create/update) a portal configuration with subscription
 * updates enabled for all catalog prices in STRIPE_PRICE_* env vars.
 */
export async function ensureBillingPortalConfiguration(): Promise<string> {
    if (cachedPortalConfigId) return cachedPortalConfigId;

    const explicit = explicitPortalConfigId();
    const configId = await upsertPortalConfiguration(explicit);
    cachedPortalConfigId = configId;

    console.log(
        `[stripePortalConfig] Customer Portal ready — subscription_update enabled (config=${configId}).`,
    );
    return configId;
}

/** Clear cached config id — for tests only. */
export function __resetPortalConfigCacheForTests(): void {
    cachedPortalConfigId = null;
}
