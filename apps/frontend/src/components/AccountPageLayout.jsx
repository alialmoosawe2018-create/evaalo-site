import React from 'react';
import '../design-styles.css';

const innerStyle = {
    maxWidth: 1400,
    margin: '0 auto',
    position: 'relative',
    zIndex: 1,
    display: 'flex',
    gap: 28,
    alignItems: 'flex-start',
};

/* Account shell styles live in design-styles.css (.account-dashboard-page) */
const baseCss = '';

/**
 * Shared shell for /account/* pages: dashboard gradient, orbs, width — matches Account overview.
 * @param {string} [props.pageClass] — e.g. account-settings-page (for scoped CSS)
 * @param {string} [props.injectStyle] — extra scoped CSS (media queries, page-specific)
 */
export function AccountPageLayout({ pageClass = '', injectStyle = '', children }) {
    return (
        <div
            className={`dashboard-page dashboard-page--evaalo-visual account-dashboard-page ${pageClass}`.trim()}
        >
            <div className="design-background">
                <div className="design-orb-1" />
                <div className="design-orb-2" />
                <div className="design-orb-3" />
            </div>
            <style>
                {baseCss}
                {injectStyle}
            </style>
            <div className="account-dashboard-inner" style={innerStyle}>
                {children}
            </div>
        </div>
    );
}

export default AccountPageLayout;
