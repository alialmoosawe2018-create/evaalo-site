// ============================================
// ملف: middleware/conditionalAuth.ts
// الوظيفة: requireAuth ذكي يحترم بيئة الانتقال.
// ============================================
//
// سلوك الـ middleware:
//   - عند ENFORCE_AUTH=on (الافتراضي عند توفر CLERK_SECRET_KEY):
//       يرفض الطلب بدون جلسة بـ 401 JSON.
//   - عند ENFORCE_AUTH=off (أو غياب CLERK_SECRET_KEY):
//       يمرّر الطلب بدون فحص. ضروري في:
//         * بيئة dev قبل ربط Clerk بحساب مستخدم حقيقي.
//         * مرحلة الانتقال بين MOCK و Clerk.
//
// الاستخدام:
//   import { conditionalRequireAuth } from '../middleware/conditionalAuth.js';
//   router.delete('/:id', conditionalRequireAuth(), requirePermission('candidate.delete'), handler);

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { getAuth, requireAuth } from '@clerk/express';

const ENFORCE_AUTH = (() => {
    const explicit = process.env.ENFORCE_AUTH;
    if (typeof explicit === 'string' && explicit.trim()) {
        return explicit.toLowerCase() !== 'off';
    }
    // افتراضيًا on فقط لو Clerk مُكوَّن
    return Boolean(process.env.CLERK_SECRET_KEY);
})();

if (!ENFORCE_AUTH) {
    console.warn(
        '[conditionalAuth] ENFORCE_AUTH=off (or CLERK_SECRET_KEY missing). ' +
            'requireAuth checks will be SKIPPED on protected routes. Switch ENFORCE_AUTH=on ' +
            'once HR users can sign in via Clerk.'
    );
}

const passthrough: RequestHandler = (_req: Request, _res: Response, next: NextFunction) => next();
const clerkRequireAuth = requireAuth();

/**
 * An API answers a signed-out request with 401, not a redirect.
 *
 * `requireAuth()` from @clerk/express sends `302 → /` when the session is
 * missing. A browser `fetch` follows that, so the caller received the API root
 * banner with status 200 and could not tell "signed out" from "no data": pages
 * rendered themselves empty and the client's 401 handling never ran. Reading the
 * session ourselves keeps Clerk's verification (clerkMiddleware already ran) and
 * replaces only the response.
 */
const enforceApiAuth: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    let userId: string | null | undefined;
    try {
        userId = getAuth(req).userId;
    } catch {
        // clerkMiddleware() never ran (keys unset mid-flight) — defer to Clerk's
        // own gate rather than locking every request out on a misconfiguration.
        clerkRequireAuth(req, res, next);
        return;
    }

    if (!userId) {
        res.status(401).set('Cache-Control', 'no-store').json({
            success: false,
            error: 'authentication_required',
            message: 'Sign in again to continue.',
        });
        return;
    }

    next();
};

const gate = ENFORCE_AUTH ? enforceApiAuth : passthrough;

export function conditionalRequireAuth(): RequestHandler {
    return gate;
}
