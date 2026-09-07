import express from 'express';
import { recordMetricAsync, type MetricScope } from '../services/siteMetricService.js';

/**
 * Browser timing intake.
 *
 * Unauthenticated for the same reason as the error intake: the slowest moment in
 * the product is the one before a session exists — bundle, Clerk handshake, first
 * data call — and an endpoint that demands a token cannot measure it.
 *
 * Only a scope and a name are accepted, never a URL, so a caller cannot mint an
 * unbounded number of series. The name is normalized again in the service.
 */

const router = express.Router();

const MAX_SAMPLES_PER_REQUEST = 40;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;
/** A browser cannot usefully report longer than this; anything more is junk. */
const MAX_DURATION_MS = 10 * 60 * 1000;

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

/** The browser may only write to these; 'backend' stays server-authored. */
const CLIENT_SCOPES = new Set<MetricScope>(['api', 'interview']);

router.post('/', (req, res) => {
    try {
        const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
        if (rateLimited(ip)) {
            res.status(202).json({ accepted: 0 });
            return;
        }

        const body = req.body ?? {};
        const raw = Array.isArray(body.samples) ? body.samples : [body];
        const samples = raw.slice(0, MAX_SAMPLES_PER_REQUEST);
        let accepted = 0;

        for (const s of samples) {
            if (!s || typeof s !== 'object') continue;
            const scope = s.scope as MetricScope;
            if (!CLIENT_SCOPES.has(scope)) continue;
            const name = typeof s.name === 'string' ? s.name : '';
            if (!name.trim()) continue;
            const ms = Number(s.durationMs);
            if (!Number.isFinite(ms) || ms < 0 || ms > MAX_DURATION_MS) continue;

            recordMetricAsync({
                scope,
                name,
                durationMs: ms,
                failed: Boolean(s.failed),
                outcome: typeof s.outcome === 'string' ? s.outcome : undefined,
            });
            accepted += 1;
        }

        res.status(202).json({ accepted });
    } catch {
        res.status(202).json({ accepted: 0 });
    }
});

export default router;
