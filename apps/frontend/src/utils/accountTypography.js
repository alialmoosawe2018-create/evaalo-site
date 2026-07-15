/**
 * Account area typography — semantic hierarchy (WCAG 1.3.1 / common product UI):
 * 1) Page title (one h1): gradient via .account-gradient-text
 * 2) Section / category labels: .account-section-label
 * 3) Card titles & primary inline labels: .account-text-primary
 * 4) Descriptions & meta: .account-text-muted
 */

export const ACCOUNT_GRADIENT_TEXT_CLASS = 'account-gradient-text';
export const ACCOUNT_TEXT_MUTED_CLASS = 'account-text-muted';
export const ACCOUNT_TEXT_PRIMARY_CLASS = 'account-text-primary';
export const ACCOUNT_SECTION_LABEL_CLASS = 'account-section-label';
export const ACCOUNT_SECTION_LABEL_COMPACT_CLASS = 'account-section-label account-section-label--compact';
export const ACCOUNT_PAGE_H1_CLASS = 'account-page-h1 account-gradient-text';

/** @deprecated Prefer ACCOUNT_GRADIENT_TEXT_CLASS — kept for inline merges */
export const ACCOUNT_GRADIENT_TEXT = {
    background: 'linear-gradient(135deg, #60A5FA, #3B82F6)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
};

/** Level 1 — main page heading (h1); pair with ACCOUNT_PAGE_H1_CLASS */
export function accountPageH1Style(margin = '0 0 28px') {
    return {
        margin,
        fontSize: 28,
        fontWeight: 700,
        letterSpacing: '-0.02em',
        lineHeight: 1.2,
    };
}

/** Level 2 — section labels (Privacy, Profile, …) — matches Candidates "PROFESSIONAL DETAILS" */
export const accountSectionLabelStyle = {
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: '0.06em',
    color: '#22d3ee',
    textTransform: 'uppercase',
    marginBottom: 12,
    marginTop: 4,
};

/** Level 2 (compact) — uppercase labels inside cards (e.g. Spending) */
export const accountSectionLabelStyleCompact = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.08em',
    color: '#22d3ee',
    textTransform: 'uppercase',
    marginBottom: 10,
};

/** Level 3 — emphasized body / card row titles */
export const ACCOUNT_TEXT_PRIMARY = '#ffffff';

/** Secondary — supporting copy */
export const ACCOUNT_TEXT_MUTED = '#94a3b8';

/** Inline links on dark background */
export const ACCOUNT_LINK = '#60a5fa';
