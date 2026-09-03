import express from 'express';
import { recordSiteErrorAsync } from '../services/siteErrorService.js';

/**
 * Browser error intake.
 *
 * Deliberately UNAUTHENTICATED: the errors worth catching most are the ones around
 * and before sign-in (a frozen login form reports nothing if the endpoint needs a
 * session). Abuse is bounded by a per-IP rate limit, a small batch cap, and hard
 * field truncation in the service — never by requiring a token.
 */

const router = express.Router();

const MAX_EVENTS_PER_REQUEST = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;

/** Tiny in-process limiter; the intake is cheap and a restart resetting it is fine. */
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
    const now = Date.now();
    const row = hits.get(ip);
    if (!row || now > row.resetAt) {
        hits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        if (hits.size > 5000) hits.clear();
        return false;
    }
    row.count += 1;
    return row.count > RATE_LIMIT_MAX_REQUESTS;
}

const SEVERITIES = new Set(['error', 'warn', 'info']);

router.post('/', (req, res) => {
    // Always 202: the browser must never retry or surface a failure here.
    try {
        const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
        if (rateLimited(ip)) {
            res.status(202).json({ accepted: 0 });
            return;
        }

        const body = req.body ?? {};
        const rawEvents = Array.isArray(body.events) ? body.events : [body];
        const events = rawEvents.slice(0, MAX_EVENTS_PER_REQUEST);
        const userAgent = String(req.get('user-agent') || '').slice(0, 400);
        let accepted = 0;

        for (const ev of events) {
            if (!ev || typeof ev !== 'object') continue;
            const message = typeof ev.message === 'string' ? ev.message : '';
            if (!message.trim()) continue;

            recordSiteErrorAsync({
                source: 'frontend',
                severity: SEVERITIES.has(ev.severity) ? ev.severity : 'error',
                message,
                stack: typeof ev.stack === 'string' ? ev.stack : undefined,
                route: typeof ev.route === 'string' ? ev.route.slice(0, 300) : undefined,
                httpStatus: Number.isFinite(ev.httpStatus) ? Number(ev.httpStatus) : undefined,
                buildId: typeof ev.buildId === 'string' ? ev.buildId.slice(0, 100) : undefined,
                sessionId: typeof ev.sessionId === 'string' ? ev.sessionId.slice(0, 100) : undefined,
                language: typeof ev.language === 'string' ? ev.language.slice(0, 20) : undefined,
                viewport: typeof ev.viewport === 'string' ? ev.viewport.slice(0, 40) : undefined,
                breadcrumbs: Array.isArray(ev.breadcrumbs) ? ev.breadcrumbs.slice(-20) : undefined,
                userAgent,
                ip,
            });
            accepted += 1;
        }

        res.status(202).json({ accepted });
    } catch {
        res.status(202).json({ accepted: 0 });
    }
});

export default router;
