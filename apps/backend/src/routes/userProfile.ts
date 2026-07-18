// ============================================
// ملف: routes/userProfile.ts
// GET/PATCH /api/users/me — HR account profile
// ============================================

import express, { type Request, type Response } from 'express';
import { conditionalRequireAuth } from '../middleware/conditionalAuth.js';
import { getAuthContext, getClerkUserId, getOrgId } from '../middleware/auth.js';
import {
    getProfileForClerkUser,
    updateProfileForClerkUser,
    upsertDevProfile,
    clearDashboardRecentInterviews,
} from '../services/userProfileService.js';
import { deleteAccountPermanently } from '../services/accountDeletionService.js';
import { isStripeLiveMode } from '../services/stripeService.js';
import { isBillingActive } from '../services/billingRuntimeService.js';
import { normalizeClerkRole } from '../config/rbacRoles.js';
import User from '../models/User.js';
import OrgPlanState from '../models/OrgPlanState.js';

const router = express.Router();

function headerString(req: Request, name: string): string | undefined {
    const raw = req.headers[name];
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
    if (Array.isArray(raw) && raw[0]) return String(raw[0]).trim();
    return undefined;
}

function resolveClerkUserId(req: Request): string {
    const headerId = headerString(req, 'x-clerk-user-id');
    if (headerId?.startsWith('user_')) return headerId;

    const id = getClerkUserId(req);
    if (id && id !== 'system') return id;

    return headerId || id;
}

function resolveDevEmail(req: Request): string | undefined {
    const authCtx = getAuthContext(req);
    if (authCtx.email?.trim()) return authCtx.email.trim().toLowerCase();
    const headerEmail = headerString(req, 'x-user-email');
    return headerEmail?.toLowerCase();
}

router.get('/me', conditionalRequireAuth(), async (req: Request, res: Response) => {
    try {
        const clerkUserId = resolveClerkUserId(req);
        const devEmail = resolveDevEmail(req);

        if (!clerkUserId.startsWith('user_') && devEmail) {
            const profile = await upsertDevProfile(`dev_${devEmail}`, {
                email: devEmail,
            });
            return res.json({ success: true, profile });
        }

        const profile = await getProfileForClerkUser(clerkUserId);
        return res.json({ success: true, profile });
    } catch (err) {
        const code = err instanceof Error ? err.message : 'profile_error';
        if (code === 'PROFILE_NOT_FOUND') {
            return res.status(404).json({ success: false, message: code });
        }
        if (code === 'CLERK_NOT_CONFIGURED') {
            return res.status(503).json({ success: false, message: code });
        }
        console.error('[userProfile] GET /me error:', err);
        return res.status(500).json({ success: false, message: 'profile_fetch_failed' });
    }
});

router.patch('/me', conditionalRequireAuth(), async (req: Request, res: Response) => {
    try {
        const clerkUserId = resolveClerkUserId(req);
        const devEmail = resolveDevEmail(req);
        const body = req.body as { fullName?: string; companyName?: string; companyDescription?: string };

        if (!clerkUserId.startsWith('user_')) {
            if (!devEmail) {
                return res.status(401).json({ success: false, message: 'unauthorized' });
            }
            const profile = await upsertDevProfile(`dev_${devEmail}`, {
                email: devEmail,
                fullName: body.fullName,
                companyName: body.companyName,
                companyDescription: body.companyDescription,
            });
            return res.json({ success: true, profile });
        }

        const profile = await updateProfileForClerkUser(clerkUserId, {
            fullName: body.fullName,
            companyName: body.companyName,
            companyDescription: body.companyDescription,
        });
        return res.json({ success: true, profile });
    } catch (err) {
        const code = err instanceof Error ? err.message : 'profile_error';
        if (code === 'INVALID_FULL_NAME' || code === 'INVALID_COMPANY' || code === 'INVALID_COMPANY_DESCRIPTION') {
            return res.status(400).json({ success: false, message: code });
        }
        if (code === 'PROFILE_NOT_FOUND') {
            return res.status(404).json({ success: false, message: code });
        }
        console.error('[userProfile] PATCH /me error:', err);
        return res.status(500).json({ success: false, message: 'profile_update_failed' });
    }
});

router.post(
    '/me/preferences/clear-recent-interviews',
    conditionalRequireAuth(),
    async (req: Request, res: Response) => {
        try {
            let clerkUserId = resolveClerkUserId(req);
            const devEmail = resolveDevEmail(req);

            if (!clerkUserId.startsWith('user_')) {
                if (!devEmail) {
                    return res.status(401).json({ success: false, message: 'unauthorized' });
                }
                clerkUserId = `dev_${devEmail}`;
                await upsertDevProfile(clerkUserId, { email: devEmail });
            }

            const profile = await clearDashboardRecentInterviews(clerkUserId);
            return res.json({
                success: true,
                preferences: profile.preferences ?? { dashboardRecentInterviewsClearedAt: null },
            });
        } catch (err) {
            const code = err instanceof Error ? err.message : 'clear_recent_error';
            if (code === 'PROFILE_NOT_FOUND') {
                return res.status(404).json({ success: false, message: code });
            }
            console.error('[userProfile] POST clear-recent-interviews error:', err);
            return res.status(500).json({ success: false, message: 'clear_recent_interviews_failed' });
        }
    }
);

// ============================================
// DELETE /me — حذف نهائي للحساب وبياناته
// ============================================
//
// مصدر النطاق الموثوق: clerkUserId من جلسة Clerk → User.primaryOrgId من Mongo.
// لا نعتمد على orgId القادم من headers لعملية مدمّرة كهذه إلا كـ fallback عند غياب User doc.
//
// Member delete ≠ org billing cancel. Only org owners with an active live subscription
// must cancel billing first; Stripe Customer ID alone never blocks a member delete.
router.delete('/me', conditionalRequireAuth(), async (req: Request, res: Response) => {
    try {
        const clerkUserId = resolveClerkUserId(req);
        const devEmail = resolveDevEmail(req);

        if (!clerkUserId.startsWith('user_') && !devEmail) {
            return res.status(401).json({ success: false, message: 'unauthorized' });
        }

        const authCtx = getAuthContext(req);
        const userDoc = await User.findOne({ clerkUserId, deletedAt: { $exists: false } }).lean();
        const orgId = userDoc?.primaryOrgId?.trim() || getOrgId(req);
        const role = normalizeClerkRole(userDoc?.role || authCtx.role);
        const isOwner = role === 'OWNER';

        if (isOwner) {
            const plan = await OrgPlanState.findOne({ organizationId: orgId }).lean();
            if (
                plan?.stripeSubscriptionId &&
                isBillingActive(plan.subscriptionStatus) &&
                isStripeLiveMode()
            ) {
                return res.status(409).json({
                    success: false,
                    code: 'ACTIVE_SUBSCRIPTION',
                    message:
                        'Cancel your organization subscription before deleting your owner account.',
                });
            }
            await deleteAccountPermanently({ clerkUserId, orgId, scope: 'owner_org' });
        } else {
            await deleteAccountPermanently({ clerkUserId, orgId, scope: 'member' });
        }

        return res.json({ success: true });
    } catch (err) {
        const code = err instanceof Error ? err.message : 'account_delete_error';
        if (code === 'CLERK_NOT_CONFIGURED') {
            return res.status(503).json({ success: false, message: code });
        }
        console.error('[userProfile] DELETE /me error:', err);
        return res.status(500).json({ success: false, message: 'account_delete_failed' });
    }
});

export default router;
