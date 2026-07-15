/**
 * CV Comparison configuration, callback allowlist, and token verification.
 */

import crypto from 'crypto';

export const CV_COMPARISON_ERROR = {
    NOT_CONFIGURED: 'CV_COMPARISON_NOT_CONFIGURED',
    WEBHOOK_NOT_CONFIGURED: 'CV_COMPARISON_WEBHOOK_NOT_CONFIGURED',
    CALLBACK_SECRET_NOT_CONFIGURED: 'CV_COMPARISON_CALLBACK_SECRET_NOT_CONFIGURED',
    CALLBACK_NOT_CONFIGURED: 'CV_COMPARISON_CALLBACK_NOT_CONFIGURED',
    CALLBACK_ORIGIN_DENIED: 'CV_COMPARISON_CALLBACK_ORIGIN_DENIED',
} as const;

export type CvComparisonConfigErrorCode =
    (typeof CV_COMPARISON_ERROR)[keyof typeof CV_COMPARISON_ERROR];

export class CvComparisonConfigurationError extends Error {
    readonly code: CvComparisonConfigErrorCode;

    constructor(code: CvComparisonConfigErrorCode, message: string) {
        super(message);
        this.name = 'CvComparisonConfigurationError';
        this.code = code;
    }
}

export function generateCvComparisonCallbackToken(): string {
    return crypto.randomBytes(32).toString('hex');
}

export function verifyCvComparisonCallbackToken(expected: string, provided: string): boolean {
    if (!expected || !provided) return false;
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(provided, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

export function verifyCvComparisonInboundSecret(expected: string, provided: string): boolean {
    if (!expected || !provided) return false;
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(provided, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

export function resolveCvComparisonWebhookUrl(): string {
    return (process.env.N8N_CV_COMPARISON_WEBHOOK_URL || '').trim();
}

export function resolveCvComparisonInboundSecret(): string {
    return (process.env.N8N_CV_COMPARISON_INBOUND_SECRET || '').trim();
}

export function resolvePublicApiUrl(): string {
    return (process.env.PUBLIC_API_URL || '').trim().replace(/\/$/, '');
}

/** Normalizes a URL to `protocol//host` for allowlist comparison. */
export function normalizeCvComparisonCallbackOrigin(url: string): string {
    const trimmed = url.trim();
    if (!trimmed) return '';
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error('unsupported protocol');
        }
        return `${parsed.protocol}//${parsed.host}`;
    } catch {
        throw new CvComparisonConfigurationError(
            CV_COMPARISON_ERROR.CALLBACK_ORIGIN_DENIED,
            'Invalid callback origin URL.'
        );
    }
}

export function parseCvComparisonCallbackAllowlist(
    envValue: string | undefined = process.env.CV_COMPARISON_CALLBACK_ALLOWLIST
): string[] {
    const raw = (envValue || '').trim();
    if (!raw) return [];
    const origins: string[] = [];
    for (const part of raw.split(',')) {
        const entry = part.trim();
        if (!entry) continue;
        origins.push(normalizeCvComparisonCallbackOrigin(entry));
    }
    return [...new Set(origins)];
}

export function assertCvComparisonCallbackAllowlistConfigured(
    envValue?: string | undefined
): string[] {
    const allowlist = parseCvComparisonCallbackAllowlist(envValue);
    if (allowlist.length === 0) {
        throw new CvComparisonConfigurationError(
            CV_COMPARISON_ERROR.CALLBACK_NOT_CONFIGURED,
            'CV comparison callback allowlist is not configured.'
        );
    }
    return allowlist;
}

export function isCvComparisonCallbackOriginAllowed(
    publicApiBase: string,
    envAllowlist?: string | undefined
): boolean {
    try {
        assertCvComparisonCallbackAllowlistConfigured(envAllowlist);
        const origin = normalizeCvComparisonCallbackOrigin(publicApiBase);
        const allowlist = parseCvComparisonCallbackAllowlist(envAllowlist);
        return allowlist.includes(origin);
    } catch {
        return false;
    }
}

export function assertCvComparisonCallbackOriginAllowed(
    publicApiBase: string,
    envAllowlist?: string | undefined
): void {
    const allowlist = assertCvComparisonCallbackAllowlistConfigured(envAllowlist);
    const origin = normalizeCvComparisonCallbackOrigin(publicApiBase);
    if (!allowlist.includes(origin)) {
        throw new CvComparisonConfigurationError(
            CV_COMPARISON_ERROR.CALLBACK_ORIGIN_DENIED,
            'PUBLIC_API_URL origin is not allowlisted for CV comparison callbacks.'
        );
    }
}

export function buildCvComparisonCallbackUrl(
    publicApiBase: string,
    comparisonId: string,
    callbackToken: string,
    envAllowlist?: string | undefined
): string {
    const base = publicApiBase.replace(/\/$/, '');
    assertCvComparisonCallbackOriginAllowed(base, envAllowlist);
    return `${base}/webhook/n8n/cv-comparison?comparisonId=${encodeURIComponent(comparisonId)}&token=${encodeURIComponent(callbackToken)}`;
}

export function assertCvComparisonWebhookConfigured(): string {
    const url = resolveCvComparisonWebhookUrl();
    if (!url) {
        throw new CvComparisonConfigurationError(
            CV_COMPARISON_ERROR.WEBHOOK_NOT_CONFIGURED,
            'CV comparison webhook is not configured.'
        );
    }
    return url;
}

export function assertCvComparisonInboundSecretConfigured(): string {
    const secret = resolveCvComparisonInboundSecret();
    if (!secret) {
        throw new CvComparisonConfigurationError(
            CV_COMPARISON_ERROR.CALLBACK_SECRET_NOT_CONFIGURED,
            'CV comparison inbound secret is not configured.'
        );
    }
    return secret;
}

export function assertPublicApiUrlConfigured(): string {
    const base = resolvePublicApiUrl();
    if (!base) {
        throw new CvComparisonConfigurationError(
            CV_COMPARISON_ERROR.CALLBACK_NOT_CONFIGURED,
            'PUBLIC_API_URL is not configured for CV comparison callbacks.'
        );
    }
    return base;
}

/** Fail-closed preflight before outbound n8n fetch or callback URL minting. */
export function assertCvComparisonOutboundReady(envAllowlist?: string | undefined): {
    webhookUrl: string;
    inboundSecret: string;
    publicApiBase: string;
} {
    const webhookUrl = assertCvComparisonWebhookConfigured();
    const inboundSecret = assertCvComparisonInboundSecretConfigured();
    const publicApiBase = assertPublicApiUrlConfigured();
    assertCvComparisonCallbackOriginAllowed(publicApiBase, envAllowlist);
    return { webhookUrl, inboundSecret, publicApiBase };
}

export function cvComparisonConfigErrorResponse(err: unknown): {
    status: number;
    body: { ok: false; error: string; message: string };
} {
    if (err instanceof CvComparisonConfigurationError) {
        return {
            status: 503,
            body: {
                ok: false,
                error: err.code,
                message: err.message,
            },
        };
    }
    return {
        status: 503,
        body: {
            ok: false,
            error: CV_COMPARISON_ERROR.NOT_CONFIGURED,
            message: 'CV comparison is not configured.',
        },
    };
}
