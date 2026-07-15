// Campaign Compare Stage 1/2/3 — required-only HMAC callback mint + verify

import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';

export type CampaignCompareStage = 'stage1' | 'stage2' | 'stage3';

export const CAMPAIGN_COMPARE_CALLBACK_TOKEN_TTL_SEC = 86400;
export const DEFAULT_CAMPAIGN_COMPARE_CLOCK_SKEW_SEC = 300;

const ALLOWED_CALLBACK_ORIGINS = new Set([
    'https://api.evaalo.com',
    'http://100.73.82.78:5000',
    'http://localhost:5000',
]);

export interface CampaignCompareSigningPayload {
    v: 1;
    compareStage: CampaignCompareStage;
    requestId: string;
    campaignId: string;
    organizationId: string;
    issuedAt: number;
    expiresAt: number;
}

export interface CampaignCompareQueryClaims {
    requestId: string;
    compareStage: CampaignCompareStage;
    campaignId: string;
    organizationId: string;
    issuedAt: number;
    expiresAt: number;
    token: string;
}

export interface CampaignCompareOutboundBundle {
    callbackUrl: string;
    inboundSecret: string;
}

export class CampaignCompareConfigurationError extends Error {
    readonly statusCode = 503;

    constructor(message = 'Campaign Compare security is not configured') {
        super(message);
        this.name = 'CampaignCompareConfigurationError';
    }
}

function trimEnv(name: string): string {
    return (process.env[name] || '').trim();
}

export function getCampaignCompareSecurityMode(): 'required' {
    const raw = trimEnv('CAMPAIGN_COMPARE_CALLBACK_SECURITY_MODE').toLowerCase();
    if (raw !== 'required') {
        throw new CampaignCompareConfigurationError(
            'CAMPAIGN_COMPARE_CALLBACK_SECURITY_MODE must be required'
        );
    }
    return 'required';
}

export function getCampaignCompareClockSkewSec(): number {
    const raw = trimEnv('CAMPAIGN_COMPARE_CALLBACK_CLOCK_SKEW_SEC');
    if (!raw) return DEFAULT_CAMPAIGN_COMPARE_CLOCK_SKEW_SEC;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_CAMPAIGN_COMPARE_CLOCK_SKEW_SEC;
}

export function getCampaignCompareTokenTtlSec(): number {
    const raw = trimEnv('CAMPAIGN_COMPARE_CALLBACK_TOKEN_TTL_SEC');
    if (!raw) return CAMPAIGN_COMPARE_CALLBACK_TOKEN_TTL_SEC;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : CAMPAIGN_COMPARE_CALLBACK_TOKEN_TTL_SEC;
}

export function getCampaignCompareInboundSecret(): string {
    return trimEnv('N8N_CAMPAIGN_COMPARE_INBOUND_SECRET');
}

export function getCampaignCompareSigningSecret(): string {
    return trimEnv('CAMPAIGN_COMPARE_CALLBACK_SIGNING_SECRET');
}

export function getCampaignCompareStageWebhookUrl(stage: CampaignCompareStage): string {
    if (stage === 'stage1') return trimEnv('N8N_CAMPAIGN_COMPARE_STAGE1_WEBHOOK_URL');
    if (stage === 'stage2') return trimEnv('N8N_CAMPAIGN_COMPARE_STAGE2_WEBHOOK_URL');
    return trimEnv('N8N_CAMPAIGN_COMPARE_STAGE3_WEBHOOK_URL');
}

export function parseCampaignCompareAllowlistOrigins(): Set<string> {
    const raw = trimEnv('CAMPAIGN_COMPARE_CALLBACK_ALLOWLIST');
    const origins = new Set<string>();
    for (const part of raw.split(',')) {
        const p = part.trim();
        if (!p) continue;
        try {
            origins.add(new URL(p).origin);
        } catch {
            /* skip invalid */
        }
    }
    return origins;
}

export function parseCampaignCompareAllowedOrgIds(): Set<string> {
    const raw = trimEnv('CAMPAIGN_COMPARE_ALLOW_ORG_IDS');
    const ids = new Set<string>();
    for (const part of raw.split(',')) {
        const p = part.trim();
        if (p) ids.add(p);
    }
    return ids;
}

export function getPublicApiBase(): string {
    return (process.env.PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
}

export function assertCampaignCompareCallbackBaseAllowed(baseUrl: string): void {
    const allowlist = parseCampaignCompareAllowlistOrigins();
    if (allowlist.size === 0) {
        throw new CampaignCompareConfigurationError();
    }
    let origin: string;
    try {
        origin = new URL(baseUrl).origin;
    } catch {
        throw new CampaignCompareConfigurationError();
    }
    for (const entry of allowlist) {
        if (!ALLOWED_CALLBACK_ORIGINS.has(entry)) {
            throw new CampaignCompareConfigurationError(
                `CAMPAIGN_COMPARE_CALLBACK_ALLOWLIST entry not allowed: ${entry}`
            );
        }
    }
    if (!allowlist.has(origin)) {
        throw new CampaignCompareConfigurationError();
    }
}

const CANONICAL_PATHS: Record<CampaignCompareStage, string> = {
    stage1: '/webhook/n8n/campaign-compare/stage1',
    stage2: '/webhook/n8n/campaign-compare/stage2',
    stage3: '/webhook/n8n/campaign-compare/stage3',
};

export function buildCanonicalCampaignCompareSigningPayload(input: {
    compareStage: CampaignCompareStage;
    requestId: string;
    campaignId: string;
    organizationId: string;
    issuedAt: number;
    expiresAt: number;
}): CampaignCompareSigningPayload {
    return {
        v: 1,
        compareStage: input.compareStage,
        requestId: input.requestId,
        campaignId: input.campaignId,
        organizationId: input.organizationId,
        issuedAt: input.issuedAt,
        expiresAt: input.expiresAt,
    };
}

export function serializeCampaignCompareSigningPayload(
    payload: CampaignCompareSigningPayload
): string {
    const ordered = buildCanonicalCampaignCompareSigningPayload(payload);
    return JSON.stringify(ordered);
}

function base64urlEncode(buf: Buffer): string {
    return buf.toString('base64url');
}

function base64urlDecode(token: string): Buffer | null {
    try {
        return Buffer.from(token, 'base64url');
    } catch {
        return null;
    }
}

export function computeCampaignCompareHmacToken(
    payload: CampaignCompareSigningPayload,
    signingSecret: string
): string {
    const bytes = Buffer.from(serializeCampaignCompareSigningPayload(payload), 'utf8');
    const digest = createHmac('sha256', signingSecret).update(bytes).digest();
    return base64urlEncode(digest);
}

export function verifyCampaignCompareHmacToken(
    claims: CampaignCompareQueryClaims,
    signingSecret: string
): { ok: true } | { ok: false; errorCategory: string } {
    const payload = buildCanonicalCampaignCompareSigningPayload(claims);
    const expected = computeCampaignCompareHmacToken(payload, signingSecret);
    const gotBuf = base64urlDecode(claims.token);
    const expBuf = base64urlDecode(expected);
    if (!gotBuf || !expBuf || gotBuf.length !== expBuf.length) {
        return { ok: false, errorCategory: 'hmac_invalid' };
    }
    if (!timingSafeEqual(gotBuf, expBuf)) {
        return { ok: false, errorCategory: 'hmac_invalid' };
    }
    return { ok: true };
}

export function validateCampaignCompareTimestamps(
    issuedAt: number,
    expiresAt: number,
    nowSec = Math.floor(Date.now() / 1000)
): { ok: true } | { ok: false; errorCategory: string } {
    if (!Number.isInteger(issuedAt) || !Number.isInteger(expiresAt)) {
        return { ok: false, errorCategory: 'timestamp_invalid' };
    }
    if (expiresAt <= issuedAt) {
        return { ok: false, errorCategory: 'timestamp_invalid' };
    }
    const skew = getCampaignCompareClockSkewSec();
    if (issuedAt > nowSec + skew) {
        return { ok: false, errorCategory: 'issued_at_future' };
    }
    if (nowSec > expiresAt) {
        return { ok: false, errorCategory: 'expired' };
    }
    return { ok: true };
}

export function assertCampaignCompareSecureConfiguration(
    options: { requireDispatchWebhook?: CampaignCompareStage } = {}
): void {
    getCampaignCompareSecurityMode();

    const inbound = getCampaignCompareInboundSecret();
    const signing = getCampaignCompareSigningSecret();
    if (!inbound || !signing) {
        throw new CampaignCompareConfigurationError();
    }

    const allowlist = parseCampaignCompareAllowlistOrigins();
    if (allowlist.size === 0) {
        throw new CampaignCompareConfigurationError();
    }

    assertCampaignCompareCallbackBaseAllowed(getPublicApiBase());

    const orgIds = parseCampaignCompareAllowedOrgIds();
    if (orgIds.size === 0) {
        throw new CampaignCompareConfigurationError(
            'CAMPAIGN_COMPARE_ALLOW_ORG_IDS must be non-empty'
        );
    }

    if (options.requireDispatchWebhook) {
        const url = getCampaignCompareStageWebhookUrl(options.requireDispatchWebhook);
        if (!url) {
            throw new CampaignCompareConfigurationError();
        }
    }
}

export function mintCampaignCompareCallbackUrl(input: {
    compareStage: CampaignCompareStage;
    requestId: string;
    campaignId: string;
    organizationId: string;
    nowSec?: number;
}): CampaignCompareOutboundBundle & { issuedAt: number; expiresAt: number } {
    assertCampaignCompareSecureConfiguration();

    const inboundSecret = getCampaignCompareInboundSecret();
    const signingSecret = getCampaignCompareSigningSecret();
    const base = getPublicApiBase();
    const issuedAt = input.nowSec ?? Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + getCampaignCompareTokenTtlSec();

    const payload = buildCanonicalCampaignCompareSigningPayload({
        compareStage: input.compareStage,
        requestId: input.requestId,
        campaignId: input.campaignId,
        organizationId: input.organizationId,
        issuedAt,
        expiresAt,
    });
    const token = computeCampaignCompareHmacToken(payload, signingSecret!);
    const path = CANONICAL_PATHS[input.compareStage];
    const qs = new URLSearchParams({
        requestId: input.requestId,
        compareStage: input.compareStage,
        campaignId: input.campaignId,
        organizationId: input.organizationId,
        issuedAt: String(issuedAt),
        expiresAt: String(expiresAt),
        token,
    });

    return {
        callbackUrl: `${base}${path}?${qs.toString()}`,
        inboundSecret: inboundSecret!,
        issuedAt,
        expiresAt,
    };
}

function queryStringValue(raw: unknown): string {
    if (raw === undefined || raw === null) return '';
    if (Array.isArray(raw)) return String(raw[0] ?? '').trim();
    return String(raw).trim();
}

const VALID_COMPARE_STAGES = new Set<CampaignCompareStage>(['stage1', 'stage2', 'stage3']);

export function parseCampaignCompareQueryClaims(
    req: Request
): CampaignCompareQueryClaims | null {
    const requestId = queryStringValue(req.query.requestId);
    const compareStage = queryStringValue(req.query.compareStage) as CampaignCompareStage;
    const campaignId = queryStringValue(req.query.campaignId);
    const organizationId = queryStringValue(req.query.organizationId);
    const issuedAtRaw = queryStringValue(req.query.issuedAt);
    const expiresAtRaw = queryStringValue(req.query.expiresAt);
    const token = queryStringValue(req.query.token);

    if (!requestId || !compareStage || !campaignId || !organizationId || !token) {
        return null;
    }
    if (!VALID_COMPARE_STAGES.has(compareStage)) {
        return null;
    }

    const issuedAt = Number.parseInt(issuedAtRaw, 10);
    const expiresAt = Number.parseInt(expiresAtRaw, 10);
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) {
        return null;
    }

    return {
        requestId,
        compareStage,
        campaignId,
        organizationId,
        issuedAt,
        expiresAt,
        token,
    };
}

export function getInboundCampaignCompareSecretHeader(req: Request): string {
    const raw = req.headers['x-campaign-compare-secret'];
    if (Array.isArray(raw)) return String(raw[0] ?? '').trim();
    if (typeof raw === 'string') return raw.trim();
    return '';
}

export function verifyInboundCampaignCompareSecret(
    req: Request
): { ok: true } | { ok: false; errorCategory: string } {
    const expected = getCampaignCompareInboundSecret();
    if (!expected) {
        return { ok: false, errorCategory: 'secret_unconfigured' };
    }
    const received = getInboundCampaignCompareSecretHeader(req);
    const expBuf = Buffer.from(expected, 'utf8');
    const gotBuf = Buffer.from(received, 'utf8');
    if (gotBuf.length !== expBuf.length) {
        return { ok: false, errorCategory: 'secret_invalid' };
    }
    if (!timingSafeEqual(gotBuf, expBuf)) {
        return { ok: false, errorCategory: 'secret_invalid' };
    }
    return { ok: true };
}

export const CAMPAIGN_COMPARE_SECURE_QUERY_KEYS = [
    'requestId',
    'compareStage',
    'campaignId',
    'organizationId',
    'issuedAt',
    'expiresAt',
    'token',
] as const;
