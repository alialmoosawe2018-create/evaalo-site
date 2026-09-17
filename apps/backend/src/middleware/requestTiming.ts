import type { Request, Response, NextFunction } from 'express';
import { recordMetricAsync, SLOW_THRESHOLD_MS } from '../services/siteMetricService.js';

/**
 * Times every request and rolls it up by route.
 *
 * Searching production logs for a slow endpoint returned nothing — not because
 * nothing was slow, but because nobody wrote the durations down. This is that
 * missing line.
 *
 * It measures on `finish`, so the number is time-to-last-byte as the client
 * experiences it, not time-to-handler-return.
 *
 * The name uses Express's matched `route.path` where one exists, so
 * `/api/candidates/:id` is one series instead of one per candidate. Requests that
 * never matched a route (404s) collapse to a single bucket rather than minting a
 * series per scanned URL — otherwise a bot sweeping for `/wp-admin` writes a row
 * an hour for every path it tries.
 */

/**
 * This middleware is mounted on the app, so `req.path` is the WHOLE path.
 *
 * The health router is mounted at `/api/health`, which makes its real paths
 * `/api/health` and `/api/health/ready`. The list used to name `/health/ready`
 * — a path no request has ever carried — while the two that do exist were never
 * matched, so every probe wrote a row: 241 of them, 6% of `site_metrics`, for
 * checks the list was written to exclude. `/health` (the separate liveness
 * endpoint) was the only entry that ever worked.
 *
 * The prefix test covers a trailing slash and anything added to that router later.
 */
const SKIP = new Set(['/health', '/favicon.ico']);

function isSkipped(path: string): boolean {
    if (SKIP.has(path)) return true;
    return path === '/api/health' || path.startsWith('/api/health/');
}

export function requestTiming(req: Request, res: Response, next: NextFunction): void {
    if (isSkipped(req.path)) return next();

    const startedAt = process.hrtime.bigint();

    res.once('finish', () => {
        try {
            const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const matched = (req as any).route?.path as string | undefined;
            const base = matched ? `${req.baseUrl || ''}${matched}` : null;
            const name = `${req.method} ${base || (res.statusCode === 404 ? '[unmatched]' : req.path)}`;

            recordMetricAsync({
                scope: 'backend',
                name,
                durationMs: ms,
                failed: res.statusCode >= 500,
            });

            // A line in the container log too: the rollup answers "is this normal",
            // the log answers "which request was it".
            if (ms >= SLOW_THRESHOLD_MS) {
                console.warn(
                    `[slow] ${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${Math.round(ms)}ms`,
                );
            }
        } catch {
            /* never let measurement break a response that already finished */
        }
    });

    next();
}

export default requestTiming;
