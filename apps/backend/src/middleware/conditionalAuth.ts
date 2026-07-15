// ============================================
// ملف: middleware/conditionalAuth.ts
// الوظيفة: requireAuth ذكي يحترم بيئة الانتقال.
// ============================================
//
// سلوك الـ middleware:
//   - عند ENFORCE_AUTH=on (الافتراضي عند توفر CLERK_SECRET_KEY):
//       يستدعي @clerk/express.requireAuth() — يرفض الطلب بدون session بـ 401.
//   - عند ENFORCE_AUTH=off (أو غياب CLERK_SECRET_KEY):
//       يمرّر الطلب بدون فحص. ضروري في:
//         * بيئة dev قبل ربط Clerk بحساب مستخدم حقيقي.
//         * مرحلة الانتقال بين MOCK و Clerk.
//
// الاستخدام:
//   import { conditionalRequireAuth } from '../middleware/conditionalAuth.js';
//   router.delete('/:id', conditionalRequireAuth(), requirePermission('candidate.delete'), handler);

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { requireAuth } from '@clerk/express';

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
const clerkRequireAuth = ENFORCE_AUTH ? requireAuth() : passthrough;

export function conditionalRequireAuth(): RequestHandler {
    return clerkRequireAuth;
}
