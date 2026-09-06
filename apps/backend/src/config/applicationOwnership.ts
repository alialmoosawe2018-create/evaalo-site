// ============================================
// File: config/applicationOwnership.ts
// Purpose: The kill switch for "the application owns campaign state".
//
// It lives on its own so both the readers (services/applicationJobContext.ts)
// and the writers (candidateApplicationService, interviewLinkAccess) can ask
// without importing each other — those two already form a dependency pair.
// ============================================

/** Same shape as CAMPAIGN_COMPARE_V2_ENABLED, so the deploy story is familiar. */
export function isApplicationOwnsCampaignStateEnabled(): boolean {
    return (process.env.APPLICATION_OWNS_CAMPAIGN_STATE || '').trim().toLowerCase() === 'true';
}
