import crypto from 'crypto';
import SiteError from '../models/SiteError.js';

/**
 * Fire-and-forget writer for site errors.
 *
 * Mirrors auditService: every failure is swallowed and only logged. Reporting an
 * error must never itself break a request — an observability write that can throw
 * is worse than no observability at all.
 */

export interface RecordSiteErrorInput {
    source: 'frontend' | 'backend' | 'agent';
    severity?: 'error' | 'warn' | 'info';
    message: string;
    stack?: string;
    route?: string;
    method?: string;
    httpStatus?: number;
    buildId?: string;
    sessionId?: string;
    organizationId?: string;
    userAgent?: string;
    ip?: string;
    language?: string;
    viewport?: string;
    breadcrumbs?: unknown[];
    fingerprint?: string;
}

const MAX_MESSAGE = 2000;
const MAX_STACK = 8000;

/** Strip anything that looks like personal data before it is ever stored. */
function scrub(text: string): string {
    return String(text)
        .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
        .replace(/\+?\d[\d\s()-]{7,}\d/g, '[phone]')
        .replace(/\b(eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, '[jwt]');
}

/** First stack frame only — keeps the same bug on one fingerprint across line noise. */
function firstFrame(stack?: string): string {
    if (!stack) return '';
    const line = stack.split('\n').find((l) => /\s+at\s+/.test(l));
    return (line || '').trim().slice(0, 200);
}

export function buildFingerprint(input: RecordSiteErrorInput): string {
    const basis = [
        input.source,
        input.severity || 'error',
        scrub(input.message).slice(0, 300),
        firstFrame(input.stack),
        input.route || '',
        input.httpStatus ? String(input.httpStatus) : '',
    ].join('|');
    return crypto.createHash('sha1').update(basis).digest('hex');
}

/**
 * Upsert one occurrence. Same fingerprint -> `count++` and `lastSeen` bumped, so a
 * storm of identical errors stays a single row.
 */
export async function recordSiteError(input: RecordSiteErrorInput): Promise<void> {
    try {
        if (!input?.message) return;
        const fingerprint = input.fingerprint || buildFingerprint(input);
        const now = new Date();
        const message = scrub(input.message).slice(0, MAX_MESSAGE);
        const stack = input.stack ? scrub(input.stack).slice(0, MAX_STACK) : undefined;

        await SiteError.findOneAndUpdate(
            { fingerprint },
            {
                $inc: { count: 1 },
                $set: {
                    lastSeen: now,
                    message,
                    ...(stack ? { stack } : {}),
                    ...(input.route ? { route: input.route } : {}),
                    ...(input.method ? { method: input.method } : {}),
                    ...(input.httpStatus ? { httpStatus: input.httpStatus } : {}),
                    ...(input.buildId ? { buildId: input.buildId } : {}),
                    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
                    ...(input.organizationId ? { organizationId: input.organizationId } : {}),
                    ...(input.userAgent ? { userAgent: String(input.userAgent).slice(0, 400) } : {}),
                    ...(input.ip ? { ip: input.ip } : {}),
                    ...(input.language ? { language: input.language } : {}),
                    ...(input.viewport ? { viewport: input.viewport } : {}),
                    ...(input.breadcrumbs ? { breadcrumbs: input.breadcrumbs } : {}),
                },
                $setOnInsert: {
                    fingerprint,
                    source: input.source,
                    severity: input.severity || 'error',
                    firstSeen: now,
                    status: 'new',
                },
            },
            { upsert: true, new: false },
        ).exec();
    } catch (err: any) {
        console.warn(`[siteError] record failed (ignored): ${err?.message || err}`);
    }
}

/** Never await this from a request path. */
export function recordSiteErrorAsync(input: RecordSiteErrorInput): void {
    void recordSiteError(input).catch(() => undefined);
}
