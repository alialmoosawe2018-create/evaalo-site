// Fail-closed authentication for Campaign Compare API routes only.

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { requireAuth } from '@clerk/express';
import { SYSTEM_ACTOR_ID } from '../config/multiTenant.js';
import { getOrgId } from './auth.js';
import {
    assertCampaignCompareSecureConfiguration,
    CampaignCompareConfigurationError,
    parseCampaignCompareAllowedOrgIds,
    type CampaignCompareStage,
} from '../services/campaignCompareCallbackAuth.js';

function isEnforceAuthOff(): boolean {
    const explicit = process.env.ENFORCE_AUTH;
    if (typeof explicit === 'string' && explicit.trim()) {
        return explicit.toLowerCase() === 'off';
    }
    return !process.env.CLERK_SECRET_KEY;
}

function isRbacEnforcementOff(): boolean {
    return (process.env.RBAC_ENFORCEMENT || 'on').toLowerCase() === 'off';
}

function clerkSecretConfigured(): boolean {
    return Boolean((process.env.CLERK_SECRET_KEY || '').trim());
}

function respond503(res: Response, error = 'campaign_compare_auth_unconfigured'): void {
    res.status(503).json({ ok: false, error });
}

export function assertCampaignCompareApiInfrastructure(
    options: { requireDispatchWebhook?: CampaignCompareStage } = {}
): RequestHandler {
    return (_req: Request, res: Response, next: NextFunction) => {
        if (!clerkSecretConfigured()) {
            respond503(res);
            return;
        }
        if (isEnforceAuthOff()) {
            respond503(res);
            return;
        }
        if (isRbacEnforcementOff()) {
            respond503(res);
            return;
        }
        try {
            assertCampaignCompareSecureConfiguration({
                requireDispatchWebhook: options.requireDispatchWebhook,
            });
        } catch (err) {
            if (err instanceof CampaignCompareConfigurationError) {
                respond503(res);
                return;
            }
            respond503(res);
            return;
        }
        next();
    };
}

const clerkRequireAuth = requireAuth();

export const requireCampaignCompareStrictClerkAuth: RequestHandler = (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    clerkRequireAuth(req, res, (err?: unknown) => {
        if (err) {
            res.status(401).json({ ok: false, error: 'authentication_required' });
            return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const userId = String((req as any).auth?.userId ?? '').trim();
        if (!userId || userId === SYSTEM_ACTOR_ID) {
            res.status(401).json({ ok: false, error: 'authentication_required' });
            return;
        }
        next();
    });
};

export function assertCampaignCompareOrgAllowlist(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
        const allowed = parseCampaignCompareAllowedOrgIds();
        const orgId = getOrgId(req)?.trim();
        if (!orgId || !allowed.has(orgId)) {
            res.status(403).json({ ok: false, error: 'organization_not_allowed' });
            return;
        }
        next();
    };
}
