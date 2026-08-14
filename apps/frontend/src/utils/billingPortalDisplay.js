/** Shared formatters + maps for billing portal UI (AccountStripePortal + AccountBilling). */

export const PAID_BG = 'rgba(16, 185, 129, 0.18)';
export const PAID_TEXT = '#047857';
export const FAIL_BG = 'rgba(239, 68, 68, 0.18)';
export const FAIL_TEXT = '#b91c1c';
export const NEUTRAL_BG = 'rgba(100, 116, 139, 0.18)';
export const NEUTRAL_TEXT = '#475569';

export const STATUS_KEY_MAP = {
    active: 'billing_status_active',
    trialing: 'billing_status_trialing',
    past_due: 'billing_status_past_due',
    canceled: 'billing_status_canceled',
    incomplete: 'billing_status_incomplete',
};

export const INVOICE_STATUS_KEY = {
    paid: 'billing_portal_invoice_paid',
    open: 'billing_portal_invoice_open',
    draft: 'billing_portal_invoice_draft',
    uncollectible: 'billing_portal_invoice_uncollectible',
    void: 'billing_portal_invoice_void',
};

/** Format Stripe cents to currency display (locale-aware via Intl). */
export function formatCurrencyCents(cents, currency = 'usd', locale = 'en-US') {
    if (typeof cents !== 'number' || !Number.isFinite(cents)) return null;
    try {
        return new Intl.NumberFormat(locale, {
            style: 'currency',
            currency: (currency || 'usd').toUpperCase(),
        }).format(cents / 100);
    } catch {
        return `$${(cents / 100).toFixed(2)}`;
    }
}

export function formatDateSafe(value, locale = 'en-US') {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    try {
        return new Intl.DateTimeFormat(locale, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        }).format(date);
    } catch {
        return date.toDateString();
    }
}

/** Month label for invoice filter dropdown, e.g. "May 2026". */
export function formatMonthYear(value, locale = 'en-US') {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    try {
        return new Intl.DateTimeFormat(locale, {
            year: 'numeric',
            month: 'long',
        }).format(date);
    } catch {
        return date.toDateString();
    }
}

/** YYYY-MM key for grouping invoices by month. */
export function monthKeyFromIso(iso) {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

export function invoiceStatusStyle(status) {
    switch (status) {
        case 'paid':
            return { bg: PAID_BG, color: PAID_TEXT };
        case 'open':
        case 'draft':
            return { bg: NEUTRAL_BG, color: NEUTRAL_TEXT };
        case 'uncollectible':
        case 'void':
            return { bg: FAIL_BG, color: FAIL_TEXT };
        default:
            return { bg: NEUTRAL_BG, color: NEUTRAL_TEXT };
    }
}

/** Stripe line copy: "1 × Plan (at $99.00 / month)" → "Plan ($99.00 / month)". */
function tidyStripeLineDescription(raw) {
    return raw
        .replace(/^\d+\s*[×xX]\s*/, '')
        .replace(/\(\s*at\s+/i, '(');
}

/**
 * Human-readable invoice description — Stripe line item when available,
 * otherwise a plan + cycle fallback for audit-friendly display.
 */
export function buildInvoiceDescription(inv, planDisplayName, t, locale = 'en-US') {
    if (inv?.description?.trim()) return tidyStripeLineDescription(inv.description.trim());
    const periodLabel = formatDateSafe(inv?.periodStart || inv?.createdAt, locale);
    if (planDisplayName && periodLabel && t) {
        return t('account_billing_invoice_desc_fallback')
            .replace('{plan}', planDisplayName)
            .replace('{date}', periodLabel);
    }
    if (inv?.number) return inv.number;
    return '—';
}

export function localeForBillingLang(currentLang) {
    if (currentLang === 'ar') return 'ar';
    if (currentLang === 'ku') return 'ku';
    return 'en-US';
}
