// ============================================
// Stage 1/2/3 n8n callback HMAC mint + verify
// ============================================

import { createHmac, createHash, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import mongoose from 'mongoose';

export type StageCallbackMode = 'stage1' | 'stage2' | 'stage3';
export type StageCallbackSecurityMode = 'optional' | 'required';
export type StageCallbackClass = 'legacy' | 'partial_secure' | 'secure_complete';

export const STAGE_CALLBACK_TOKEN_TTL_SEC = 86400;
export const DEFAULT_STAGE_CALLBACK_CLOCK_SKEW_SEC = 300;

export interface StageSigningPayload {
    v: 1;
    mode: StageCallbackMode;
    candidateId: string;
    sessionId: string;
    campaignId: string;
    issuedAt: number;
    expiresAt: number;
}

export interface StageQueryClaims {
    candidateId: string;
    mode: StageCallbackMode;
    sessionId: string;
    campaignId: string;
    issuedAt: number;
    expiresAt: number;
    token: string;
}

export interface StageOutboundBundle {
    callbackUrl: string;
    inboundSecret: string;
}

export class StageCallbackConfigurationError extends Error {
    readonly statusCode = 503;

    constructor(message = 'Stage callback security is not configured') {
        super(message);
        this.name = 'StageCallbackConfigurationError';
    }
}

function trimEnv(name: string): string {
    return (process.env[name] || '').trim();
}

export function getStageCallbackSecurityMode(): StageCallbackSecurityMode {
    const raw = trimEnv('STAGE_CALLBACK_SECURITY_MODE').toLowerCase();
    if (raw === 'required') return 'required';
    return 'optional';
}

export function getStageClockSkewSec(): number {
    const raw = trimEnv('STAGE_CALLBACK_CLOCK_SKEW_SEC');
    if (!raw) return DEFAULT_STAGE_CALLBACK_CLOCK_SKEW_SEC;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_STAGE_CALLBACK_CLOCK_SKEW_SEC;
}

export function getStageInboundSecret(): string {
    return trimEnv('N8N_STAGE_INBOUND_SECRET');
}

export function getStageSigningSecret(): string {
    return trimEnv('STAGE_CALLBACK_SIGNING_SECRET');
}

export function areStageSecretsConfigured(): boolean {
    return Boolean(getStageInboundSecret() && getStageSigningSecret());
}

export function isEitherStageSecretConfigured(): boolean {
    return Boolean(getStageInboundSecret() || getStageSigningSecret());
}

/** All signed-callback query claim keys (existence checked for markers / complete bundle). */
export const STAGE_SECURE_QUERY_KEYS = [
    'candidateId',
    'mode',
    'sessionId',
    'campaignId',
    'issuedAt',
    'expiresAt',
    'token',
] as const;

export function hasQueryKey(req: Request, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(req.query, key);
}

export function hasInboundStageSecretHeader(req: Request): boolean {
    return Object.prototype.hasOwnProperty.call(req.headers, 'x-n8n-stage-secret');
}

/**
 * Full secure mint configuration: both secrets, non-empty allowlist, PUBLIC_API_URL origin allowed.
 * Optional + no secrets → no-op (legacy outbound only).
 * Optional + partial/inconsistent secrets or missing allowlist → throws (no partial bundle).
 * Required → throws when configuration is incomplete.
 */
export function assertStageSecureMintConfiguration(): void {
    const securityMode = getStageCallbackSecurityMode();
    const hasEither = isEitherStageSecretConfigured();
    const hasBoth = areStageSecretsConfigured();

    if (!hasEither) {
        if (securityMode === 'required') {
            throw new StageCallbackConfigurationError();
        }
        return;
    }

    if (!hasBoth) {
        throw new StageCallbackConfigurationError();
    }

    const allowlist = parseAllowlistOrigins();
    if (allowlist.size === 0) {
        throw new StageCallbackConfigurationError();
    }

    assertStageCallbackBaseAllowed(getPublicApiBase());
}

export function assertStageOutboundSecurityForTrigger(): void {
    if (getStageCallbackSecurityMode() !== 'required') return;
    assertStageSecureMintConfiguration();
}

export function isRequiredModeUnsignedRejection(callbackClass: StageCallbackClass): boolean {
    return getStageCallbackSecurityMode() === 'required' && callbackClass === 'legacy';
}

export function getPublicApiBase(): string {
    return (process.env.PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
}

function parseAllowlistOrigins(): Set<string> {
    const raw = trimEnv('STAGE_CALLBACK_ALLOWLIST');
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

export function assertStageCallbackBaseAllowed(baseUrl: string): void {
    const allowlist = parseAllowlistOrigins();
    if (allowlist.size === 0) {
        throw new StageCallbackConfigurationError();
    }
    let origin: string;
    try {
        origin = new URL(baseUrl).origin;
    } catch {
        throw new StageCallbackConfigurationError();
    }
    if (!allowlist.has(origin)) {
        throw new StageCallbackConfigurationError();
    }
}

const STAGE_CANONICAL_PATHS: Record<StageCallbackMode, string> = {
    stage1: '/webhook/n8n/stage1',
    stage2: '/webhook/n8n/stage2',
    stage3: '/webhook/n8n/stage3',
};

/** Canonical JSON signing bytes — keys inserted in fixed order before stringify. */
export function buildCanonicalSigningPayload(input: {
    mode: StageCallbackMode;
    candidateId: string;
    sessionId?: string;
    campaignId?: string;
    issuedAt: number;
    expiresAt: number;
}): StageSigningPayload {
    return {
        v: 1,
        mode: input.mode,
        candidateId: input.candidateId,
        sessionId: input.sessionId ?? '',
        campaignId: input.campaignId ?? '',
        issuedAt: input.issuedAt,
        expiresAt: input.expiresAt,
    };
}

export function serializeSigningPayload(payload: StageSigningPayload): string {
    const ordered = buildCanonicalSigningPayload(payload);
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

export function computeStageHmacToken(payload: StageSigningPayload, signingSecret: string): string {
    const bytes = Buffer.from(serializeSigningPayload(payload), 'utf8');
    const digest = createHmac('sha256', signingSecret).update(bytes).digest();
    return base64urlEncode(digest);
}

export function verifyStageHmacToken(
    claims: StageQueryClaims,
    signingSecret: string
): { ok: true } | { ok: false; errorCategory: string } {
    const payload = buildCanonicalSigningPayload(claims);
    const expected = computeStageHmacToken(payload, signingSecret);
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

export function validateStageTimestamps(
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
    const skew = getStageClockSkewSec();
    if (issuedAt > nowSec + skew) {
        return { ok: false, errorCategory: 'issued_at_future' };
    }
    if (nowSec > expiresAt) {
        return { ok: false, errorCategory: 'expired' };
    }
    return { ok: true };
}

export function mintStageCallbackUrl(input: {
    mode: StageCallbackMode;
    candidateId: string;
    sessionId?: string;
    campaignId?: string;
    applicationId?: string;
    nowSec?: number;
}): StageOutboundBundle & { issuedAt: number; expiresAt: number } {
    assertStageSecureMintConfiguration();

    const inboundSecret = getStageInboundSecret();
    const signingSecret = getStageSigningSecret();

    const candidateId = input.candidateId.trim();
    if (!mongoose.Types.ObjectId.isValid(candidateId) || !/^[a-fA-F0-9]{24}$/.test(candidateId)) {
        throw new Error('Invalid candidateId for stage callback mint');
    }

    const base = getPublicApiBase();

    const issuedAt = input.nowSec ?? Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + STAGE_CALLBACK_TOKEN_TTL_SEC;
    const payload = buildCanonicalSigningPayload({
        mode: input.mode,
        candidateId,
        sessionId: input.sessionId ?? '',
        campaignId: input.campaignId ?? '',
        issuedAt,
        expiresAt,
    });
    const token = computeStageHmacToken(payload, signingSecret!);
    const path = STAGE_CANONICAL_PATHS[input.mode];
    const qs = new URLSearchParams({
        candidateId,
        mode: input.mode,
        sessionId: payload.sessionId,
        campaignId: payload.campaignId,
        issuedAt: String(issuedAt),
        expiresAt: String(expiresAt),
        token,
    });
    const applicationId = input.applicationId?.trim();
    if (applicationId) qs.set('applicationId', applicationId);
    return {
        callbackUrl: `${base}${path}?${qs.toString()}`,
        inboundSecret: inboundSecret!,
        issuedAt,
        expiresAt,
    };
}

/**
 * Optional + both secrets → secure bundle.
 * Optional + missing secrets → null (fully legacy outbound).
 * Required → throws if secrets missing.
 */
export function tryBuildStageOutboundBundle(
    mode: StageCallbackMode,
    input: { candidateId: string; sessionId?: string; campaignId?: string; applicationId?: string }
): StageOutboundBundle | null {
    if (!isEitherStageSecretConfigured()) {
        if (getStageCallbackSecurityMode() === 'required') {
            throw new StageCallbackConfigurationError();
        }
        return null;
    }

    assertStageSecureMintConfiguration();

    const minted = mintStageCallbackUrl({
        mode,
        candidateId: input.candidateId,
        sessionId: input.sessionId,
        campaignId: input.campaignId,
        applicationId: input.applicationId,
    });
    return { callbackUrl: minted.callbackUrl, inboundSecret: minted.inboundSecret };
}

/** Attach secure outbound fields to a flat n8n payload when a bundle was minted. */
export function appendStageOutboundFields(
    payload: Record<string, unknown>,
    bundle: StageOutboundBundle | null
): void {
    if (!bundle) return;
    payload.callbackUrl = bundle.callbackUrl;
    payload.inboundSecret = bundle.inboundSecret;
}

function queryStringValue(raw: unknown): string {
    if (raw === undefined || raw === null) return '';
    if (Array.isArray(raw)) return String(raw[0] ?? '').trim();
    return String(raw).trim();
}

export function getInboundStageSecretHeader(req: Request): string {
    const raw = req.headers['x-n8n-stage-secret'];
    if (Array.isArray(raw)) return String(raw[0] ?? '').trim();
    if (typeof raw === 'string') return raw.trim();
    return '';
}

export function hasStageSecurityMarkers(req: Request): boolean {
    if (STAGE_SECURE_QUERY_KEYS.some((key) => hasQueryKey(req, key))) {
        return true;
    }
    return hasInboundStageSecretHeader(req);
}

export function isValidStageMode(raw: string): raw is StageCallbackMode {
    return raw === 'stage1' || raw === 'stage2' || raw === 'stage3';
}

export function parseStageQueryClaims(req: Request): StageQueryClaims | null {
    for (const key of STAGE_SECURE_QUERY_KEYS) {
        if (!hasQueryKey(req, key)) return null;
    }

    const candidateId = queryStringValue(req.query.candidateId);
    const modeRaw = queryStringValue(req.query.mode);
    const token = queryStringValue(req.query.token);
    const issuedAtRaw = queryStringValue(req.query.issuedAt);
    const expiresAtRaw = queryStringValue(req.query.expiresAt);

    if (!candidateId || !modeRaw || !token || !issuedAtRaw || !expiresAtRaw) {
        return null;
    }
    if (!isValidStageMode(modeRaw)) return null;

    const issuedAt = Number.parseInt(issuedAtRaw, 10);
    const expiresAt = Number.parseInt(expiresAtRaw, 10);
    if (!Number.isInteger(issuedAt) || !Number.isInteger(expiresAt)) return null;

    return {
        candidateId,
        mode: modeRaw,
        sessionId: queryStringValue(req.query.sessionId),
        campaignId: queryStringValue(req.query.campaignId),
        issuedAt,
        expiresAt,
        token,
    };
}

export function hasCompleteSecureQueryBundle(req: Request): boolean {
    if (!hasInboundStageSecretHeader(req)) return false;
    if (!getInboundStageSecretHeader(req)) return false;
    const claims = parseStageQueryClaims(req);
    if (!claims) return false;
    if (!mongoose.Types.ObjectId.isValid(claims.candidateId)) return false;
    if (!getStageSigningSecret()) return false;
    return true;
}

/** Stage 2/3 secure callbacks require a non-empty signed sessionId claim. */
export function secureSessionIdSatisfied(
    routeMode: StageCallbackMode,
    sessionId: string
): boolean {
    if (routeMode === 'stage2' || routeMode === 'stage3') {
        return sessionId.trim().length > 0;
    }
    return true;
}

export function classifyStageCallback(req: Request): StageCallbackClass {
    if (!hasStageSecurityMarkers(req)) return 'legacy';
    if (!hasCompleteSecureQueryBundle(req)) return 'partial_secure';
    return 'secure_complete';
}

export function verifyInboundStageSecret(req: Request): boolean {
    const expected = getStageInboundSecret();
    const got = getInboundStageSecretHeader(req);
    if (!expected || !got) return false;
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(got, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

export function candidateCorrelationRef(candidateId: string): string {
    return createHash('sha256').update(candidateId).digest('hex').slice(0, 8);
}

function normalizeBodyId(raw: unknown): string {
    if (raw === undefined || raw === null) return '';
    return String(raw).trim();
}

export function bodyIdentityConflictsWithClaims(
    body: Record<string, unknown>,
    claims: StageQueryClaims
): { ok: true } | { ok: false; status: 401 | 403; errorCategory: string } {
    const checks: Array<{ bodyVal: unknown; claimVal: string; category: string }> = [
        { bodyVal: body.candidateId, claimVal: claims.candidateId, category: 'candidate_id_mismatch' },
        { bodyVal: body.id, claimVal: claims.candidateId, category: 'candidate_id_mismatch' },
        { bodyVal: body.mode, claimVal: claims.mode, category: 'mode_mismatch' },
        { bodyVal: body.sessionId, claimVal: claims.sessionId, category: 'session_id_mismatch' },
        { bodyVal: body.campaignId, claimVal: claims.campaignId, category: 'campaign_id_mismatch' },
    ];

    for (const { bodyVal, claimVal, category } of checks) {
        const normalized = normalizeBodyId(bodyVal);
        if (!normalized) continue;
        if (normalized !== claimVal) {
            return { ok: false, status: 401, errorCategory: category };
        }
    }
    return { ok: true };
}

export const STAGE_EVALUATION_SOURCE: Record<StageCallbackMode, string> = {
    stage1: 'written',
    stage2: 'voice',
    stage3: 'video',
};
