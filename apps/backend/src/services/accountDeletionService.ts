// ============================================
// ملف: services/accountDeletionService.ts
// الوظيفة: حذف الحساب — member delete ≠ org billing cancel.
// ============================================

import Candidate from '../models/Candidate.js';
import RecruitmentCampaign from '../models/RecruitmentCampaign.js';
import VideoInterviewSession from '../models/VideoInterviewSession.js';
import OrgIntegration from '../models/OrgIntegration.js';
import CreditLedger from '../models/CreditLedger.js';
import CreditBalance from '../models/CreditBalance.js';
import OrgPlanState from '../models/OrgPlanState.js';
import AuditLog from '../models/AuditLog.js';
import User from '../models/User.js';
import { DEFAULT_ORG_ID } from '../config/multiTenant.js';

export type DeleteAccountScope = 'member' | 'owner_org';

interface DeleteAccountInput {
    clerkUserId: string;
    orgId: string;
    /** member = user data only; owner_org = full org purge when sole owner deletes. */
    scope?: DeleteAccountScope;
}

function isProd(): boolean {
    return process.env.NODE_ENV === 'production';
}

function devLog(collection: string, deletedCount: number): void {
    if (!isProd()) {
        console.log(`[accountDeletion] purged ${collection}: ${deletedCount}`);
    }
}

async function deleteClerkUser(clerkUserId: string): Promise<void> {
    const secret = process.env.CLERK_SECRET_KEY;
    if (!secret) return;
    if (!clerkUserId.startsWith('user_')) return;

    const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(clerkUserId)}`, {
        method: 'DELETE',
        headers: {
            Authorization: `Bearer ${secret}`,
            'Content-Type': 'application/json',
        },
    });

    if (res.ok || res.status === 404) {
        return;
    }

    const text = await res.text().catch(() => '');
    const err = new Error(`clerk_delete_${res.status}`);
    (err as Error & { status: number; body: string }).status = res.status;
    (err as Error & { body: string }).body = text;
    throw err;
}

/**
 * Permanent account deletion.
 *
 * - `member`: removes the user's business data only — org billing/subscription docs stay intact.
 * - `owner_org`: removes org-level billing when the owner deletes the whole org (V1 sole-owner orgs).
 * - `org_default` (shared dev): always user-scoped only.
 */
export async function deleteAccountPermanently({
    clerkUserId,
    orgId,
    scope = 'owner_org',
}: DeleteAccountInput): Promise<void> {
    const isSharedDevOrg = orgId === DEFAULT_ORG_ID;
    const purgeOrgBilling = scope === 'owner_org' && !isSharedDevOrg;

    const userScopedFilter = isSharedDevOrg
        ? { organizationId: orgId, createdByClerkUserId: clerkUserId }
        : purgeOrgBilling
          ? { organizationId: orgId }
          : { organizationId: orgId, createdByClerkUserId: clerkUserId };

    const candidateRes = await Candidate.deleteMany(userScopedFilter);
    devLog('candidates', candidateRes.deletedCount ?? 0);

    const campaignRes = await RecruitmentCampaign.deleteMany(userScopedFilter);
    devLog('recruitmentCampaigns', campaignRes.deletedCount ?? 0);

    const videoRes = await VideoInterviewSession.deleteMany(userScopedFilter);
    devLog('videoInterviewSessions', videoRes.deletedCount ?? 0);

    if (purgeOrgBilling) {
        const orgFilter = { organizationId: orgId };

        const integrationRes = await OrgIntegration.deleteMany(orgFilter);
        devLog('orgIntegrations', integrationRes.deletedCount ?? 0);

        const ledgerRes = await CreditLedger.deleteMany(orgFilter);
        devLog('creditLedger', ledgerRes.deletedCount ?? 0);

        const balanceRes = await CreditBalance.deleteMany(orgFilter);
        devLog('creditBalance', balanceRes.deletedCount ?? 0);

        const planRes = await OrgPlanState.deleteMany(orgFilter);
        devLog('orgPlanState', planRes.deletedCount ?? 0);

        const auditRes = await AuditLog.deleteMany(orgFilter);
        devLog('auditLog', auditRes.deletedCount ?? 0);
    }

    await deleteClerkUser(clerkUserId);

    const userRes = await User.deleteOne({ clerkUserId });
    devLog('user', userRes.deletedCount ?? 0);
}

export default { deleteAccountPermanently };
