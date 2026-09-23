import { Router } from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import { requirePermission } from '../middleware/rbac.js';
import { logAudit } from '../services/auditService.js';
import { conditionalRequireAuth } from '../middleware/conditionalAuth.js';
import { getOrgId, getClerkUserId, getAuthContext } from '../middleware/auth.js';
import HeadHunterSourcingContext from '../models/HeadHunterSourcingContext.js';
import RecruitmentCampaign from '../models/RecruitmentCampaign.js';
import { orgScopedQuery } from '../middleware/orgScope.js';
import { campaignRoleFromCampaign } from '../services/campaignRole.js';
import HeadHunterSearchHistory from '../models/HeadHunterSearchHistory.js';
import AuditLog from '../models/AuditLog.js';
import { checkCredits, consumeCredits } from '../services/billingRuntimeService.js';
import { emitDomainEventBestEffort } from '../services/domainEventService.js';
import {
    executeContactReveal,
    listRevealedContactStates,
} from '../services/contactRevealService.js';
import { getIntegrationStatus, recordMessageSent, recordError } from '../services/integrationService.js';
import { isLinkedInAutomationEnabled } from '../config/featureFlags.js';
import { sendMessage, sendInterviewInvite } from '../services/messaging/messagingService.js';
import type { MessageChannelId } from '../services/messaging/types.js';
import {
    buildHeadHunterIdempotencyKey,
    claimWebhook,
    completeWebhook,
    failWebhook,
    errorMessage as wbErrorMessage,
} from '../services/webhookIdempotency.js';
import {
    assertHeadHunterCallbackOriginAllowed,
    assertHeadHunterWebhookConfigured,
    buildHeadHunterCallbackUrl,
    HeadHunterConfigurationError,
    resolveSearchExperienceFilters,
} from '../services/headHunterSecurity.js';
import {
    getInternalHeadHunterSourcingContext,
    isValidHeadHunterContextId,
} from '../services/headHunterSourcingContextService.js';
import {
    headHunterPhotoObjectKey,
    isHeadHunterPhotoHash,
    mirrorHeadHunterPhotos,
} from '../services/headHunterPhotoMirror.js';
import { getObjectBuffer } from '../services/r2Service.js';
import { buildHeadHunterCompetencyModel } from '../services/headHunterCompetencyModel.js';

const router = Router();

const BILLING_ENFORCE = process.env.BILLING_ENFORCE !== 'false';

type HeadHunterSearchStatus = 'submitted' | 'completed' | 'failed';

type HeadHunterSearchRecord = {
    searchId: string;
    status: HeadHunterSearchStatus;
    organizationId: string;
    userId: string;
    submittedAt: string;
    callbackToken: string;
    receivedAt?: string;
    payload?: unknown;
    errorMessage?: string;
};

/** نتائج Head Hunter لكل بحث — معزولة بـ searchId + userId + organizationId (مثل CV Comparison). */
const headHunterResultsById = new Map<string, HeadHunterSearchRecord>();

const HH_MAX_RECORDS = 200;
const HH_RECORD_TTL_MS = 24 * 60 * 60 * 1000;

function generateSearchId(): string {
    return `headhunter_${crypto.randomUUID()}`;
}

function generateCallbackToken(): string {
    return crypto.randomBytes(32).toString('hex');
}

function getPublicApiBase(): string {
    return (process.env.PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
}

function pickCallbackToken(req: Request): string {
    const q = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    return q;
}

function pickSearchId(req: Request, body: unknown): string {
    const q = typeof req.query.searchId === 'string' ? req.query.searchId.trim() : '';
    if (q) return q;
    if (body != null && typeof body === 'object' && !Array.isArray(body)) {
        const o = body as Record<string, unknown>;
        const fromBody =
            typeof o.searchId === 'string'
                ? o.searchId.trim()
                : typeof o.search_id === 'string'
                  ? o.search_id.trim()
                  : '';
        if (fromBody) return fromBody;
    }
    return '';
}

function authorizeHeadHunterRecord(req: Request, record: HeadHunterSearchRecord): boolean {
    const orgId = getOrgId(req);
    const userId = getClerkUserId(req);
    return record.organizationId === orgId && record.userId === userId;
}

function cleanupHeadHunterRecords(): void {
    const now = Date.now();
    for (const [id, rec] of headHunterResultsById) {
        const ts = Date.parse(rec.receivedAt || rec.submittedAt);
        if (!Number.isFinite(ts) || now - ts > HH_RECORD_TTL_MS) {
            headHunterResultsById.delete(id);
        }
    }
    if (headHunterResultsById.size <= HH_MAX_RECORDS) return;
    const sorted = [...headHunterResultsById.entries()].sort((a, b) => {
        const ta = Date.parse(a[1].receivedAt || a[1].submittedAt) || 0;
        const tb = Date.parse(b[1].receivedAt || b[1].submittedAt) || 0;
        return ta - tb;
    });
    const excess = sorted.length - HH_MAX_RECORDS;
    for (let i = 0; i < excess; i += 1) {
        headHunterResultsById.delete(sorted[i][0]);
    }
}

function isSearchComplete(body: unknown): boolean {
    if (!isPlainRecord(body)) return false;
    return body.searchComplete === true || body.completed === true || body.done === true;
}

function isSearchFailed(body: unknown): boolean {
    if (!isPlainRecord(body)) return false;
    return body.searchFailed === true || body.status === 'failed';
}

function pickInboundErrorMessage(body: unknown): string | undefined {
    if (!isPlainRecord(body)) return undefined;
    const msg = pickFirstStr(body, ['errorMessage', 'error', 'message']);
    return msg || undefined;
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
    return v != null && typeof v === 'object' && !Array.isArray(v);
}

function pickFirstStr(obj: Record<string, unknown>, keys: string[]): string {
    for (const k of keys) {
        const v = obj[k];
        if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
}

/** رابط صورة HTTP(s) من حقول enrichlayer / n8n الشائعة */
function pickPhotoUrlStr(obj: Record<string, unknown>): string {
    const raw = pickFirstStr(obj, [
        'profile_pic_url',
        'profilePicUrl',
        'photo_url',
        'photoUrl',
        'profile_picture_url',
        'profilePictureUrl',
        'profile_image_url',
        'profileImageUrl',
        'avatar_url',
        'avatarUrl',
        'image_url',
        'imageUrl',
        'picture_url',
        'pictureUrl',
        'thumbnail_url',
        'thumbnailUrl',
    ]);
    if (!raw) return '';
    if (/^urn:li:/i.test(raw)) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^\/\//.test(raw)) return `https:${raw}`;
    if (/^(?:media\.licdn\.com|static\.licdn\.com|assets\.enrichlayer\.com|[a-z0-9](?:[a-z0-9-]*\.)+[a-z]{2,})\//i.test(raw)) {
        return `https://${raw}`;
    }
    return '';
}

/** دمج مرشح مكرر — يفضّل الحقول غير الفارغة الواردة لاحقاً (مثل profile_pic_url) */
function mergeCandidateRow(
    existing: Record<string, unknown>,
    incoming: Record<string, unknown>
): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...existing, ...incoming };
    const photo = pickPhotoUrlStr(incoming) || pickPhotoUrlStr(existing);
    if (photo) {
        merged.photo_url = photo;
        if (!pickFirstStr(merged, ['profile_pic_url', 'profilePicUrl'])) {
            merged.profile_pic_url = photo;
        }
    }
    return canonicalizeInboundCandidate(merged);
}

/** حقول meta من n8n لا تُعدّ مرشحاً */
const INBOUND_META_KEYS = new Set([
    'searchId',
    'search_id',
    'searchComplete',
    'completed',
    'done',
    'event',
    'timestamp',
    'source',
]);

/** يحوّل شكل n8n الشائع (name, job_title, bio, experiences) إلى حقول LinkedIn التي تفهمها الواجهة */
function canonicalizeInboundCandidate(o: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...o };
    const name = pickFirstStr(o, ['Name', 'name', 'full_name', 'fullName', 'display_name']);
    const jobTitle = pickFirstStr(o, ['job_title', 'jobTitle', 'current_title', 'currentTitle', 'title']);
    const bio = pickFirstStr(o, ['bio', 'summary', 'about', 'overview']);
    const loc = pickFirstStr(o, ['Location', 'location', 'city', 'geo', 'region']);
    const industry = pickFirstStr(o, ['industry', 'sector']);

    if (name && !pickFirstStr(out, ['Name', 'name', 'full_name', 'fullName'])) {
        out.full_name = name;
    }
    if (jobTitle) {
        if (!pickFirstStr(out, ['current_title', 'currentTitle', 'job_title'])) out.current_title = jobTitle;
        if (!pickFirstStr(out, ['headline', 'occupation'])) out.headline = jobTitle;
    }
    if (bio) {
        if (!pickFirstStr(out, ['summary', 'bio', 'about'])) out.summary = bio;
    }
    if (loc && !pickFirstStr(out, ['Location', 'location', 'city'])) out.location = loc;
    if (industry && !pickFirstStr(out, ['industry'])) out.industry = industry;
    if (jobTitle && bio && typeof out.occupation !== 'string') {
        out.occupation = `${jobTitle}\n\n${bio}`;
    } else if (bio && typeof out.occupation !== 'string') {
        out.occupation = bio;
    } else if (jobTitle && typeof out.occupation !== 'string') {
        out.occupation = jobTitle;
    }
    const photo = pickPhotoUrlStr(out);
    if (photo) {
        out.photo_url = photo;
        if (!pickFirstStr(out, ['profile_pic_url', 'profilePicUrl'])) {
            out.profile_pic_url = photo;
        }
    }
    return out;
}

/** جسم وارد من n8n بلا أي بيانات مرشح (قالب فارغ) */
function isShellCandidate(o: Record<string, unknown>): boolean {
    const profileKeys = Object.keys(o).filter((k) => !INBOUND_META_KEYS.has(k));
    if (profileKeys.length === 0) return true;

    const hasText =
        pickFirstStr(o, [
            'Name',
            'name',
            'full_name',
            'fullName',
            'job_title',
            'jobTitle',
            'bio',
            'summary',
            'occupation',
            'Location',
            'location',
            'email',
            'phone',
            'industry',
            'headline',
        ]) !== '';
    const hasExp =
        (Array.isArray(o.experiences) && o.experiences.length > 0) ||
        (Array.isArray(o.experience) && o.experience.length > 0) ||
        (Array.isArray(o.experience_timeline) && o.experience_timeline.length > 0);
    const hasSkills = Array.isArray(o.skills) && o.skills.length > 0;
    const hasEdu = Array.isArray(o.education) && o.education.length > 0;
    return !hasText && !hasExp && !hasSkills && !hasEdu;
}

/** مطابق تقريباً لواجهة headHunterNormalize — ملف LinkedIn مفرد من n8n */
function looksLikeSingleProfileCandidate(o: Record<string, unknown>): boolean {
    if (isShellCandidate(o)) return false;
    const hasName = pickFirstStr(o, ['Name', 'name', 'full_name', 'fullName', 'display_name']) !== '';
    const hasOccupation = typeof o.occupation === 'string' && String(o.occupation).trim() !== '';
    const hasJobTitle = pickFirstStr(o, ['job_title', 'jobTitle', 'current_title', 'currentTitle', 'headline']) !== '';
    const hasBio = pickFirstStr(o, ['bio', 'summary', 'about', 'overview']) !== '';
    const hasLoc = pickFirstStr(o, ['Location', 'location', 'city', 'geo', 'region']) !== '';
    const hasExp =
        (Array.isArray(o.experiences) && o.experiences.length > 0) ||
        (Array.isArray(o.experience) && o.experience.length > 0);
    const hasEdu = Array.isArray(o.education) && o.education.length > 0;
    const identity = hasName || hasJobTitle || hasBio;
    const substance = hasOccupation || hasJobTitle || hasLoc || hasExp || hasEdu || hasBio;
    return identity && substance;
}

function profileDedupeKey(o: Record<string, unknown>): string {
    const linked = pickFirstStr(o, ['linkedin_url', 'linkedinUrl', 'linkedin', 'profile_url']);
    if (linked) return `li:${linked.slice(0, 200)}`;
    const name = pickFirstStr(o, ['Name', 'name', 'full_name', 'fullName']);
    const jobTitle = pickFirstStr(o, ['job_title', 'jobTitle', 'current_title', 'headline']);
    const occ =
        typeof o.occupation === 'string' && String(o.occupation).trim() !== ''
            ? String(o.occupation).slice(0, 120)
            : jobTitle.slice(0, 120);
    const loc = pickFirstStr(o, ['Location', 'location', 'city']);
    const email = pickFirstStr(o, ['email', 'email_address']);
    if (email) return `em:${email.slice(0, 120)}`;
    return `${name}|${occ}|${loc}`;
}

function extractCandidateRows(payload: unknown): Record<string, unknown>[] {
    if (payload == null) return [];
    if (typeof payload === 'string') {
        const s = payload.trim();
        if (!s) return [];
        try {
            return extractCandidateRows(JSON.parse(s) as unknown);
        } catch {
            return [];
        }
    }
    if (Array.isArray(payload)) {
        return payload
            .filter(isPlainRecord)
            .map(canonicalizeInboundCandidate)
            .filter((o) => !isShellCandidate(o));
    }
    if (!isPlainRecord(payload)) return [];
    for (const key of ['candidates', 'results', 'items', 'data', 'profiles', 'people', 'records']) {
        const v = payload[key];
        if (Array.isArray(v)) {
            return v
                .filter(isPlainRecord)
                .map(canonicalizeInboundCandidate)
                .filter((o) => !isShellCandidate(o));
        }
    }
    if (isPlainRecord(payload.profile)) {
        const canon = canonicalizeInboundCandidate(payload.profile);
        if (looksLikeSingleProfileCandidate(canon)) return [canon];
    }
    const rootCanon = canonicalizeInboundCandidate(payload);
    if (looksLikeSingleProfileCandidate(rootCanon)) return [rootCanon];
    return [];
}

function appendSingleProfile(prev: unknown, incoming: Record<string, unknown>): unknown {
    const keyIn = profileDedupeKey(incoming);
    const seen = new Set<string>();
    const out: Record<string, unknown>[] = [];

    const pushUnique = (o: Record<string, unknown>) => {
        const k = profileDedupeKey(o);
        if (seen.has(k)) return;
        seen.add(k);
        out.push(o);
    };

    for (const o of extractCandidateRows(prev)) {
        pushUnique(o);
    }
    if (!seen.has(keyIn)) {
        pushUnique(canonicalizeInboundCandidate(incoming));
    } else {
        const idx = out.findIndex((o) => profileDedupeKey(o) === keyIn);
        if (idx >= 0) {
            out[idx] = mergeCandidateRow(out[idx], incoming);
        }
    }

    if (out.length === 0) return incoming;
    if (out.length === 1) return out[0];
    return { candidates: out };
}

/** دمج أو استبدال حسب شكل الحمولة الواردة من n8n */
function mergeHeadHunterInbound(prev: unknown, incoming: unknown): unknown {
    const rows = extractCandidateRows(incoming);
    if (rows.length > 1) {
        let merged: unknown = prev ?? null;
        for (const row of rows) {
            merged = appendSingleProfile(merged, row);
        }
        return merged;
    }
    if (rows.length === 1) {
        return appendSingleProfile(prev, rows[0]);
    }
    if (isPlainRecord(incoming) && isShellCandidate(incoming)) {
        return prev ?? null;
    }
    /* لا نستبدل الدفعة المجمّعة بجسم فارغ أو غير قابل للتحليل (أخطاء أو إشعارات من n8n) */
    return prev ?? incoming;
}

/** تسلسل inbound لنفس searchId — يمنع فقدان مرشح عند webhooks متزامنة من n8n */
const inboundChains = new Map<string, Promise<unknown>>();

function runSerializedInbound<T>(searchId: string, task: () => Promise<T>): Promise<T> {
    const prev = inboundChains.get(searchId) ?? Promise.resolve();
    const next = prev.then(task, task);
    inboundChains.set(
        searchId,
        next.finally(() => {
            if (inboundChains.get(searchId) === next) inboundChains.delete(searchId);
        })
    );
    return next;
}

function headHunterRecordHasData(record: HeadHunterSearchRecord): boolean {
    return extractCandidateRows(record.payload).length > 0;
}

/** Debit 6 credits per newly arrived candidate (idempotent per searchId + profile key). */
async function billNewHeadHunterCandidates(
    organizationId: string,
    searchId: string,
    prevPayload: unknown,
    mergedPayload: unknown,
): Promise<{ billed: number; failedCode?: string }> {
    if (!BILLING_ENFORCE) return { billed: 0 };

    const prevKeys = new Set(extractCandidateRows(prevPayload).map(profileDedupeKey));
    const mergedRows = extractCandidateRows(mergedPayload);
    let billed = 0;

    for (const row of mergedRows) {
        const key = profileDedupeKey(row);
        if (prevKeys.has(key)) continue;

        const safeKey = key.replace(/[^a-zA-Z0-9_|:-]/g, '_').slice(0, 120);
        const result = await consumeCredits({
            organizationId,
            usageType: 'SEARCH_CANDIDATE',
            units: 1,
            idempotencyKey: `hh-search:${searchId}:${safeKey}`,
            source: 'headhunter',
            sourceId: searchId,
            metadata: { searchId, candidateKey: safeKey },
        });

        if (!result.ok) {
            return { billed, failedCode: result.code };
        }
        billed += 1;
        prevKeys.add(key);
    }

    return { billed };
}

async function applyHeadHunterInboundMerge(
    searchId: string,
    payload: unknown
): Promise<{ merged: unknown; rowCount: number; complete: boolean; receivedAt: string }> {
    const existing = headHunterResultsById.get(searchId);
    if (!existing) {
        throw new Error('Unknown searchId');
    }
    const receivedAt = new Date().toISOString();
    /**
     * Photos are copied to our own storage before the record is stored, because the
     * client mirrors whatever it first polls into localStorage and would keep the
     * provider's expiring URLs forever. Falls back to those URLs on any failure.
     */
    const merged = await mirrorHeadHunterPhotos(
        mergeHeadHunterInbound(existing.payload ?? null, payload)
    );
    const complete = isSearchComplete(payload);
    const rowCount = extractCandidateRows(merged).length;
    const inboundError = pickInboundErrorMessage(payload);
    const failed = isSearchFailed(payload) || (complete && Boolean(inboundError) && rowCount === 0);
    if (rowCount === 0 && isPlainRecord(payload) && isShellCandidate(payload) && !isSearchComplete(payload)) {
        console.warn(
            `[head-hunter] empty candidate shell ignored for ${searchId} — check n8n workflow output (name/job_title/experiences)`
        );
    }
    let status: HeadHunterSearchStatus = existing.status === 'failed' ? 'failed' : 'submitted';
    if (failed) status = 'failed';
    else if (complete) status = 'completed';

    headHunterResultsById.set(searchId, {
        ...existing,
        status,
        errorMessage: inboundError || (failed ? existing.errorMessage : undefined),
        receivedAt,
        payload: merged,
    });

    // Domain event (Phase 4) — terminal state reached; lets the client drop its 1s poll.
    const wasTerminal = existing.status === 'completed' || existing.status === 'failed';
    if ((status === 'completed' || status === 'failed') && !wasTerminal) {
        void emitDomainEventBestEffort({
            organizationId: existing.organizationId,
            type: 'HeadHunterSearchCompleted',
            payload: { searchId, status, requestedByClerkUserId: existing.userId, candidateCount: rowCount },
            idempotencyKey: `hh-search-done:${searchId}`,
        });
    }

    cleanupHeadHunterRecords();
    return { merged, rowCount, complete, receivedAt };
}

/**
 * POST مستخدم من server.ts — استقبال نتائج الـ workflow من n8n (HTTP Request → هذا الرابط).
 * لا يستخدم multer ولا candidateId؛ منفصل عن مسارات المقابلات `/webhook/.../stage*`.
 *
 * اختياري: N8N_HEADHUNTER_INBOUND_SECRET — أرسل الرأس `X-Head-Hunter-Secret: <نفس القيمة>`.
 */
export async function postHeadHunterN8nInbound(req: Request, res: Response): Promise<void> {
    const secret = (process.env.N8N_HEADHUNTER_INBOUND_SECRET || '').trim();
    if (secret) {
        const h = req.headers['x-head-hunter-secret'];
        const token = typeof h === 'string' ? h.trim() : '';
        if (token !== secret) {
            res.status(401).json({ ok: false, error: 'Invalid or missing X-Head-Hunter-Secret' });
            return;
        }
    }

    const searchId = pickSearchId(req, req.body);
    if (!searchId) {
        res.status(400).json({ ok: false, error: 'searchId is required' });
        return;
    }

    const existing = headHunterResultsById.get(searchId);
    if (!existing) {
        res.status(404).json({ ok: false, error: 'Unknown searchId' });
        return;
    }

    const tokenQ = pickCallbackToken(req);
    if (!existing.callbackToken || tokenQ !== existing.callbackToken) {
        res.status(401).json({ ok: false, error: 'Invalid or missing callback token' });
        return;
    }

    const idempotencyKey = buildHeadHunterIdempotencyKey(req);
    let claimed = false;
    try {
        const claim = await claimWebhook('n8n-head-hunter', idempotencyKey, {
            route: '/webhook/n8n/head-hunter',
        });
        if (claim.duplicate) {
            const payload = req.body;
            const prevKeys = new Set(
                extractCandidateRows(existing.payload).map((row) => profileDedupeKey(row))
            );
            const incomingRows = isPlainRecord(payload)
                ? extractCandidateRows(payload).filter(
                      (row) => !prevKeys.has(profileDedupeKey(row))
                  )
                : [];

            if (incomingRows.length > 0 || (isPlainRecord(payload) && isSearchComplete(payload))) {
                const prevPayload = existing.payload ?? null;
                const { merged, rowCount, complete, receivedAt } = await runSerializedInbound(
                    searchId,
                    async () => applyHeadHunterInboundMerge(searchId, payload)
                );

                const billing = await billNewHeadHunterCandidates(
                    existing.organizationId,
                    searchId,
                    prevPayload,
                    merged,
                );
                if (billing.failedCode) {
                    console.warn(
                        `[head-hunter] billing stopped searchId=${searchId} after ${billing.billed} candidate(s): ${billing.failedCode}`,
                    );
                } else if (billing.billed > 0) {
                    console.log(
                        `[head-hunter] billed ${billing.billed} candidate(s) @ 6 credits searchId=${searchId}`,
                    );
                }

                console.log(
                    `[head-hunter] inbound merged despite idempotency collision searchId=${searchId} candidates=${rowCount}${complete ? ' complete' : ''}`
                );

                res.json({
                    ok: true,
                    searchId,
                    receivedAt,
                    status: complete ? 'completed' : 'submitted',
                    message: 'Payload stored; fetch via GET /api/head-hunter/last-result?searchId=…',
                    idempotencyCollision: true,
                });
                return;
            }

            const receivedAt = existing.receivedAt || new Date().toISOString();
            console.log('♻️ head-hunter duplicate webhook ignored:', idempotencyKey);
            res.json({
                ok: true,
                duplicate: true,
                searchId,
                receivedAt,
                message: 'Webhook already processed (idempotency)',
                attemptCount: claim.record?.attemptCount,
            });
            return;
        }
        claimed = true;

        const payload = req.body;
        const prevPayload = existing.payload ?? null;
        const { merged, rowCount, complete, receivedAt } = await runSerializedInbound(searchId, async () =>
            applyHeadHunterInboundMerge(searchId, payload)
        );

        const billing = await billNewHeadHunterCandidates(
            existing.organizationId,
            searchId,
            prevPayload,
            merged,
        );
        if (billing.failedCode) {
            console.warn(
                `[head-hunter] billing stopped searchId=${searchId} after ${billing.billed} candidate(s): ${billing.failedCode}`,
            );
        } else if (billing.billed > 0) {
            console.log(
                `[head-hunter] billed ${billing.billed} candidate(s) @ 6 credits searchId=${searchId}`,
            );
        }

        console.log(
            `[head-hunter] inbound searchId=${searchId} candidates=${rowCount}${complete ? ' complete' : ''}`
        );

        await completeWebhook('n8n-head-hunter', idempotencyKey);
        res.json({
            ok: true,
            searchId,
            receivedAt,
            status: complete ? 'completed' : 'submitted',
            message: 'Payload stored; fetch via GET /api/head-hunter/last-result?searchId=…',
        });
    } catch (err) {
        if (claimed) {
            await failWebhook('n8n-head-hunter', idempotencyKey, wbErrorMessage(err)).catch(
                () => undefined
            );
        }
        console.error('[head-hunter] inbound handler error:', err);
        res.status(500).json({ ok: false, error: 'Internal server error' });
    }
}

/**
 * AI Head Hunter proxy → n8n
 *
 * Requires N8N_HEADHUNTER_WEBHOOK_URL and HEAD_HUNTER_CALLBACK_ALLOWLIST (see env.example).
 *
 * Payload POSTed to n8n (JSON):
 *   { searchId, organizationId, userId, callbackUrl, inboundSecret?,
 *     position: string, location: string, query?: string,
 *     yearsOfExperience?: '0-1' | '1-3' | '3-5' | '5-10' | '10-plus',
 *     ageRange?: '18-24' | '25-34' | '35-44' | '45-54' | '55-plus',
 *     aiCompareTop?: boolean,
 *     availableEmployeesOnly?: boolean,
 *     employeesWithoutPositionsOnly?: boolean, // synonym of availableEmployeesOnly (legacy key)
 *     minCandidateCount?: 20 | 40,  // legacy: 15 | 30
 *     requiredLanguages?: string,
 *     requiredSkills?: string,
 *     certifications?: string,
 *     company?: string,
 *     gender?: string,
 *     optionsPhrases?: { en: string; ar: string }[], optionsSummaryEn?: string, optionsSummaryAr?: string,
 *     source: "ai-head-hunter", submittedAt: ISO8601 }
 */
const MAX_LEN = 500;
const MAX_QUERY = 2000;
const MAX_OPTION_LEN = 80;

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 20;
const ipBuckets = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: Request): string {
    const xf = req.headers['x-forwarded-for'];
    if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
    return req.socket?.remoteAddress || 'unknown';
}

function rateLimitOk(ip: string): boolean {
    const now = Date.now();
    let b = ipBuckets.get(ip);
    if (!b || now > b.resetAt) {
        b = { count: 1, resetAt: now + RATE_WINDOW_MS };
        ipBuckets.set(ip, b);
        return true;
    }
    if (b.count >= RATE_MAX) return false;
    b.count += 1;
    return true;
}

function headHunterConfigErrorResponse(err: HeadHunterConfigurationError): {
    status: number;
    body: { ok: false; error: string; message: string };
} {
    return {
        status: 503,
        body: { ok: false, error: err.code, message: err.message },
    };
}

function parseBool(v: unknown): boolean {
    if (v === true) return true;
    if (v === false || v == null) return false;
    if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        return s === '1' || s === 'true' || s === 'yes';
    }
    return false;
}

const PHRASE_AI_COMPARE_TOP = {
    en: 'Enable AI analysis',
    ar: 'تفعيل التحليل بالذكاء الاصطناعي',
};

/** Matches UI checkbox label «Available employees only» — forwarded to n8n in optionsPhrases */
const LABEL_AVAILABLE_EMPLOYEES_ONLY_EN = 'Available employees only';

const PHRASE_AVAILABLE_EMPLOYEES_ONLY = {
    en: LABEL_AVAILABLE_EMPLOYEES_ONLY_EN,
    ar: 'الموظفون المتاحون فقط',
};

const PHRASE_ARABIC_TRANSLATION = {
    en: 'Arabic translation',
    ar: 'ترجمة عربية',
};

const PHRASE_YEARS_EXPERIENCE: Record<string, { en: string; ar: string }> = {
    '0-1': { en: 'Years of experience: 0–1', ar: 'سنوات الخبرة: 0–1' },
    '1-3': { en: 'Years of experience: 1–3', ar: 'سنوات الخبرة: 1–3' },
    '3-5': { en: 'Years of experience: 3–5', ar: 'سنوات الخبرة: 3–5' },
    '5-10': { en: 'Years of experience: 5–10', ar: 'سنوات الخبرة: 5–10' },
    '10-plus': { en: 'Years of experience: 10+', ar: 'سنوات الخبرة: 10+' },
};

const PHRASE_AGE_RANGE: Record<string, { en: string; ar: string }> = {
    '18-24': { en: 'Age: 18–24', ar: 'العمر: 18–24' },
    '25-34': { en: 'Age: 25–34', ar: 'العمر: 25–34' },
    '35-44': { en: 'Age: 35–44', ar: 'العمر: 35–44' },
    '45-54': { en: 'Age: 45–54', ar: 'العمر: 45–54' },
    '55-plus': { en: 'Age: 55+', ar: 'العمر: 55+' },
};

const ALLOWED_MIN_CANDIDATE_COUNTS = new Set([15, 20, 30, 40]);

const PHRASE_MIN_CANDIDATE_COUNT: Record<number, { en: string; ar: string }> = {
    15: { en: 'Return more than 15 candidates', ar: 'إرجاع أكثر من 15 مرشح' },
    20: { en: 'Return more than 20 candidates', ar: 'إرجاع أكثر من 20 مرشح' },
    30: { en: 'Return more than 30 candidates', ar: 'إرجاع أكثر من 30 مرشح' },
    40: { en: 'Return more than 40 candidates', ar: 'إرجاع أكثر من 40 مرشح' },
};

const OPTIONAL_CRITERION_LABELS: Record<string, { en: string; ar: string }> = {
    requiredLanguages: { en: 'Required languages', ar: 'اللغات المطلوبة' },
    requiredSkills: { en: 'Required skills', ar: 'المهارات المطلوبة' },
    certifications: { en: 'Certifications', ar: 'الشهادات' },
    company: { en: 'Company', ar: 'الشركة' },
    gender: { en: 'Gender', ar: 'الجنس' },
    industryType: { en: 'Industry type', ar: 'نوع القطاع' },
};

const OPTIONAL_CRITERION_KEYS = Object.keys(OPTIONAL_CRITERION_LABELS);

function parseOptionalCriterion(body: Record<string, unknown>, key: string): string | undefined {
    const raw = typeof body[key] === 'string' ? body[key].trim() : '';
    if (!raw) return undefined;
    if (raw.length > MAX_LEN) {
        throw new Error(`${key} must be at most ${MAX_LEN} characters`);
    }
    return raw;
}

function phraseOptionalCriterion(key: string, value: string): { en: string; ar: string } {
    const label = OPTIONAL_CRITERION_LABELS[key];
    if (label) {
        return { en: `${label.en}: ${value}`, ar: `${label.ar}: ${value}` };
    }
    return { en: `${key}: ${value}`, ar: `${key}: ${value}` };
}

function parseMinCandidateCount(v: unknown): number | undefined {
    const n =
        typeof v === 'number' && Number.isFinite(v)
            ? Math.trunc(v)
            : typeof v === 'string' && v.trim()
              ? parseInt(v.trim(), 10)
              : NaN;
    if (!Number.isFinite(n) || !ALLOWED_MIN_CANDIDATE_COUNTS.has(n)) return undefined;
    return n;
}

/**
 * GET /api/head-hunter/photo/:hash — صورة مرشح نسخناها إلى R2.
 *
 * بلا مصادقة بقصد: الرابط يوضع في وسم `<img>`، ووسم الصورة لا يستطيع إرسال
 * رأس `Authorization`. البديلان المتاحان كانا رابطاً موقّتاً قصير العمر — وهو
 * يُعيد المشكلة التي جئنا نحلّها إذ ينتهي — أو مسار عامّ كما هو `/uploads`.
 * الحماية هنا أن المفتاح بصمة sha256 لا تُخمّن، والمحتوى صورة كانت أصلاً
 * منشورة علناً على الشبكة المهنية.
 */
router.get('/photo/:hash', async (req: Request, res: Response) => {
    const hash = typeof req.params.hash === 'string' ? req.params.hash.trim().toLowerCase() : '';
    if (!isHeadHunterPhotoHash(hash)) {
        return res.status(400).set('Cache-Control', 'no-store').json({ ok: false, error: 'Bad key' });
    }

    try {
        const object = await getObjectBuffer(headHunterPhotoObjectKey(hash));
        if (!object) {
            // لا تُخزَّن: نسخة قد تنجح لاحقاً لنفس المفتاح إن أعاد بحثٌ سحب الصورة.
            return res.status(404).set('Cache-Control', 'no-store').json({ ok: false, error: 'Not found' });
        }
        res.setHeader('Content-Type', object.contentType);
        res.setHeader('Content-Length', String(object.body.byteLength));
        res.setHeader('X-Content-Type-Options', 'nosniff');
        // المفتاح مشتقّ من رابط المصدر والبايتات لا تتغيّر بعد الرفع.
        res.setHeader('Cache-Control', 'public, max-age=604800');
        return res.end(object.body);
    } catch (err) {
        console.error('[head-hunter] photo read failed:', err);
        return res.status(502).set('Cache-Control', 'no-store').json({ ok: false, error: 'Upstream error' });
    }
});

/** GET /api/head-hunter/last-result?searchId= — نتيجة بحث معزولة للمستخدم الحالي */
router.get(
    '/last-result',
    conditionalRequireAuth(),
    requirePermission('headhunter.search'),
    (req: Request, res: Response) => {
        const searchId = typeof req.query.searchId === 'string' ? req.query.searchId.trim() : '';
        if (!searchId) {
            return res.status(400).json({ ok: false, message: 'searchId query parameter is required' });
        }

        const record = headHunterResultsById.get(searchId);
        if (!record) {
            return res.status(404).json({ ok: false, message: 'Search not found' });
        }
        if (!authorizeHeadHunterRecord(req, record)) {
            return res.status(403).json({ ok: false, message: 'Forbidden' });
        }

        const hasData = headHunterRecordHasData(record);
        const rowCount = hasData ? extractCandidateRows(record.payload).length : 0;
        return res.json({
            ok: true,
            searchId: record.searchId,
            status: record.status,
            hasData,
            candidateCount: rowCount,
            receivedAt: record.receivedAt ?? null,
            payload: hasData ? record.payload : null,
            errorMessage: record.errorMessage ?? null,
        });
    }
);

/* POST /suggest-criteria was removed here: no caller remained. The shared
   `SuggestSearchCriteriaButton` is mounted on one page only — AI CV Comparison,
   which passes `/api/cv-comparison/suggest-criteria` — and the Head Hunter page
   has no such button, so this endpoint had been unreachable from the product
   since 2026-08-19 (its last two uses in the audit log) while still spending a
   credit for anyone who called it directly. `suggestSearchCriteriaHandler`
   itself stays: cvComparison.ts still serves it. */

/** POST /api/head-hunter/search */
router.post('/search', conditionalRequireAuth(), requirePermission('headhunter.search'), async (req: Request, res: Response) => {
    const ip = clientIp(req);
    if (!rateLimitOk(ip)) {
        return res.status(429).json({ ok: false, error: 'Too many requests' });
    }

    let webhookUrl: string;
    try {
        webhookUrl = assertHeadHunterWebhookConfigured();
        assertHeadHunterCallbackOriginAllowed(getPublicApiBase());
    } catch (err) {
        if (err instanceof HeadHunterConfigurationError) {
            const response = headHunterConfigErrorResponse(err);
            return res.status(response.status).json(response.body);
        }
        throw err;
    }

    const body = req.body ?? {};
    const position = typeof body.position === 'string' ? body.position.trim() : '';
    const location = typeof body.location === 'string' ? body.location.trim() : '';
    const rawQuery = typeof body.query === 'string' ? body.query.trim() : '';

    const aiCompareTop = parseBool(body.aiCompareTop);
    const availableEmployeesOnly =
        parseBool(body.availableEmployeesOnly) || parseBool(body.employeesWithoutPositionsOnly);
    const arabicTranslation = parseBool(body.arabicTranslation);
    const minCandidateCount = parseMinCandidateCount(body.minCandidateCount);

    const optionalCriteria: Record<string, string> = {};
    for (const key of OPTIONAL_CRITERION_KEYS) {
        try {
            const parsed = parseOptionalCriterion(body, key);
            if (parsed) optionalCriteria[key] = parsed;
        } catch (err) {
            const message = err instanceof Error ? err.message : `${key} is invalid`;
            return res.status(400).json({ ok: false, message });
        }
    }

    const experienceResolved = resolveSearchExperienceFilters({
        yearsOfExperience: body.yearsOfExperience,
        ageRange: body.ageRange,
    });
    if (!experienceResolved.ok) {
        return res.status(400).json({ ok: false, message: experienceResolved.error });
    }
    const { yearsOfExperience, ageRange, optionalCriteriaExtras } = experienceResolved.filters;
    for (const [key, value] of Object.entries(optionalCriteriaExtras)) {
        optionalCriteria[key] = value;
    }

    const optionsPhrases: { en: string; ar: string }[] = [];
    if (aiCompareTop) optionsPhrases.push(PHRASE_AI_COMPARE_TOP);
    if (availableEmployeesOnly) optionsPhrases.push(PHRASE_AVAILABLE_EMPLOYEES_ONLY);
    if (arabicTranslation) optionsPhrases.push(PHRASE_ARABIC_TRANSLATION);
    if (yearsOfExperience) {
        optionsPhrases.push(PHRASE_YEARS_EXPERIENCE[yearsOfExperience]);
    }
    if (ageRange) {
        optionsPhrases.push(PHRASE_AGE_RANGE[ageRange]);
    }
    if (optionalCriteriaExtras.yearsOfExperience) {
        optionsPhrases.push({
            en: `Years of experience: ${optionalCriteriaExtras.yearsOfExperience}`,
            ar: `سنوات الخبرة: ${optionalCriteriaExtras.yearsOfExperience}`,
        });
    }
    if (optionalCriteriaExtras.ageRange) {
        optionsPhrases.push({
            en: `Age: ${optionalCriteriaExtras.ageRange}`,
            ar: `العمر: ${optionalCriteriaExtras.ageRange}`,
        });
    }
    if (minCandidateCount && PHRASE_MIN_CANDIDATE_COUNT[minCandidateCount]) {
        optionsPhrases.push(PHRASE_MIN_CANDIDATE_COUNT[minCandidateCount]);
    }
    for (const [key, value] of Object.entries(optionalCriteria)) {
        if (key === 'yearsOfExperience' || key === 'ageRange') {
            if (optionalCriteriaExtras[key]) {
                continue;
            }
        }
        optionsPhrases.push(phraseOptionalCriterion(key, value));
    }

    const optionsSummaryEn = optionsPhrases.map((p) => p.en).join(' | ');
    const optionsSummaryAr = optionsPhrases.map((p) => p.ar).join(' | ');

    if (!position || !location) {
        return res.status(400).json({
            ok: false,
            message: 'position and location are required',
        });
    }
    if (position.length > MAX_LEN || location.length > MAX_LEN) {
        return res.status(400).json({
            ok: false,
            message: `position and location must be at most ${MAX_LEN} characters`,
        });
    }
    if (rawQuery.length > MAX_QUERY) {
        return res.status(400).json({
            ok: false,
            message: `query must be at most ${MAX_QUERY} characters`,
        });
    }

    const organizationId = getOrgId(req);
    const userId = getClerkUserId(req);

    if (BILLING_ENFORCE) {
        const estimatedCandidates =
            minCandidateCount === 40 || minCandidateCount === 30
                ? 40
                : minCandidateCount === 20 || minCandidateCount === 15
                  ? 20
                  : 1;
        const gate = await checkCredits(organizationId, 'SEARCH_CANDIDATE', estimatedCandidates);
        if (!gate.ok) {
            const status = gate.code === 'INSUFFICIENT_CREDITS' ? 402 : 403;
            return res.status(status).json({
                ok: false,
                code: gate.code,
                message: gate.message,
            });
        }
    }

    const searchId = generateSearchId();
    const submittedAt = new Date().toISOString();
    const callbackToken = generateCallbackToken();

    let callbackUrl: string;
    try {
        callbackUrl = buildHeadHunterCallbackUrl(getPublicApiBase(), searchId, callbackToken);
    } catch (err) {
        if (err instanceof HeadHunterConfigurationError) {
            const response = headHunterConfigErrorResponse(err);
            return res.status(response.status).json(response.body);
        }
        throw err;
    }

    headHunterResultsById.set(searchId, {
        searchId,
        status: 'submitted',
        organizationId,
        userId,
        submittedAt,
        callbackToken,
    });
    cleanupHeadHunterRecords();

    const inboundSecret = (process.env.N8N_HEADHUNTER_INBOUND_SECRET || '').trim();

    // The competency model of the role being searched for: generated in the
    // background, never shown to or edited by the recruiter, and sent alongside
    // their own filters so n8n can rank on what the job actually requires, not
    // only on the boxes they ticked. Null when the feature is off, unavailable,
    // or slow — the search then goes out exactly as it did before.
    const competencyModel = await buildHeadHunterCompetencyModel({
        position,
        location,
        query: rawQuery,
        criteria: optionalCriteria,
        ...roleFieldsFrom(body as Record<string, unknown>),
    });

    const payload = {
        searchId,
        organizationId,
        userId,
        callbackUrl,
        position,
        location,
        ...(inboundSecret ? { inboundSecret } : {}),
        ...(yearsOfExperience ? { yearsOfExperience } : {}),
        ...(ageRange ? { ageRange } : {}),
        ...(rawQuery ? { query: rawQuery } : {}),
        aiCompareTop,
        availableEmployeesOnly,
        employeesWithoutPositionsOnly: availableEmployeesOnly,
        arabicTranslation,
        ...(minCandidateCount ? { minCandidateCount } : {}),
        ...optionalCriteria,
        optionsPhrases,
        optionsSummaryEn: optionsSummaryEn || '',
        optionsSummaryAr: optionsSummaryAr || '',
        ...(competencyModel ? { competencyModel } : {}),
        source: 'ai-head-hunter',
        submittedAt,
    };

    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 20_000);
        const n8nRes = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: ctrl.signal,
        });
        clearTimeout(t);

        if (!n8nRes.ok) {
            const text = await n8nRes.text().catch(() => '');
            console.warn('[head-hunter] n8n non-OK:', n8nRes.status, text?.slice(0, 200));
            headHunterResultsById.set(searchId, {
                ...headHunterResultsById.get(searchId)!,
                status: 'failed',
                errorMessage: 'n8n webhook returned an error',
            });
            return res.status(502).json({
                ok: false,
                message: 'n8n webhook returned an error',
                searchId,
                status: 'failed',
            });
        }

        logAudit(req, {
            action: 'headhunter.search',
            targetType: 'headhunter',
            metadata: {
                searchId,
                position,
                location,
                yearsOfExperience,
                ageRange,
                minCandidateCount,
                ...optionalCriteria,
                options: optionsSummaryEn,
            },
        });
        return res.json({ ok: true, searchId, status: 'submitted' });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[head-hunter] fetch error:', msg);
        const existing = headHunterResultsById.get(searchId);
        if (existing) {
            headHunterResultsById.set(searchId, {
                ...existing,
                status: 'failed',
                errorMessage: 'Failed to reach n8n webhook',
            });
        }
        return res.status(502).json({
            ok: false,
            message: 'Failed to reach n8n webhook',
            searchId,
            status: 'failed',
        });
    }
});

/**
 * POST /api/head-hunter/contact — التواصل مع مرشح عبر WhatsApp أو LinkedIn.
 * body: { channel: 'whatsapp'|'linkedin', recipient, message?, sendInterviewLink?, campaignId?, interviewType?, position? }
 *  - whatsapp: recipient = رقم هاتف
 *  - linkedin: recipient = رابط ملف شخصي (محكوم بـ feature flag)
 */
router.post(
    '/contact',
    conditionalRequireAuth(),
    requirePermission('headhunter.contact'),
    async (req: Request, res: Response) => {
        const orgId = getOrgId(req);
        const body = req.body ?? {};
        const channel = (typeof body.channel === 'string' ? body.channel.trim() : '') as MessageChannelId;
        const recipient = typeof body.recipient === 'string' ? body.recipient.trim() : '';
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        const campaignId = typeof body.campaignId === 'string' ? body.campaignId.trim() : '';
        const sendInterviewLink = body.sendInterviewLink === true || body.sendInterviewLink === 'true';
        const rawInterviewType = typeof body.interviewType === 'string' ? body.interviewType.trim() : '';
        const interviewType = rawInterviewType === 'video' ? 'video' : 'form';
        const position = typeof body.position === 'string' ? body.position.trim() : '';
        const headHunterContextId =
            typeof body.headHunterContextId === 'string'
                ? body.headHunterContextId.trim()
                : typeof body.hh === 'string'
                  ? body.hh.trim()
                  : '';
        const language = typeof body.language === 'string' ? body.language.trim() : '';

        if (channel !== 'whatsapp' && channel !== 'linkedin') {
            return res.status(400).json({ ok: false, error: 'Invalid channel' });
        }
        if (!recipient) {
            return res.status(400).json({ ok: false, error: 'recipient is required' });
        }
        if (!sendInterviewLink && !message) {
            return res.status(400).json({ ok: false, error: 'message or sendInterviewLink is required' });
        }
        /*
         * The automated-send path builds the same video link the share popover
         * copies, so it needs the same binding — and the same ownership proof.
         * `orgScopedQuery` scopes to the authenticated sender's organization, so
         * a campaign outside it does not exist here.
         */
        if (sendInterviewLink && interviewType === 'video') {
            if (!campaignId) {
                return res.status(400).json({
                    ok: false,
                    code: 'CAMPAIGN_REQUIRED',
                    error: 'campaignId is required to send a video interview link',
                });
            }
            const ownsCampaign = await RecruitmentCampaign.exists(
                orgScopedQuery(req, { campaignId })
            ).catch(() => null);
            if (!ownsCampaign) {
                return res.status(404).json({
                    ok: false,
                    code: 'CAMPAIGN_NOT_FOUND',
                    error: 'Campaign not found in this organization',
                });
            }
        }

        // LinkedIn automation gated by feature flag
        if (channel === 'linkedin' && !isLinkedInAutomationEnabled()) {
            return res.status(409).json({ ok: false, error: 'linkedin_automation_disabled' });
        }

        // Connection guard
        const status = await getIntegrationStatus(orgId, channel);
        if (!status?.connected) {
            return res.status(409).json({ ok: false, error: `${channel}_not_connected` });
        }

        try {
            const result = sendInterviewLink
                ? await sendInterviewInvite({
                      orgId,
                      channel,
                      recipient,
                      campaignId: campaignId || undefined,
                      message: message || undefined,
                      interviewType,
                      position: position || undefined,
                      headHunterContextId: headHunterContextId || undefined,
                      language: language || undefined,
                  })
                : await sendMessage(
                      orgId,
                      channel === 'whatsapp'
                          ? { channel: 'whatsapp', toPhone: recipient, text: message }
                          : { channel: 'linkedin', profileUrl: recipient, text: message }
                  );

            if (!result.ok) {
                await recordError(orgId, channel, result.error || 'send_failed');
                logAudit(req, {
                    action: 'headhunter.message_failed',
                    targetType: 'candidate',
                    metadata: { channel, error: result.error || 'send_failed', sentInterviewLink: sendInterviewLink, campaignId: campaignId || null, interviewType },
                });
                return res.status(502).json({ ok: false, error: result.error || 'send_failed' });
            }

            await recordMessageSent(orgId, channel);
            logAudit(req, {
                action: 'headhunter.message_sent',
                targetType: 'candidate',
                metadata: { channel, sentInterviewLink: sendInterviewLink, campaignId: campaignId || null, interviewType },
            });

            return res.json({ ok: true, channel, providerMessageId: result.providerMessageId });
        } catch (err) {
            console.error('[head-hunter] contact error:', err);
            await recordError(orgId, channel, err instanceof Error ? err.message : String(err));
            return res.status(500).json({ ok: false, error: 'Internal server error' });
        }
    }
);

// ============================================
// Contact reveal — field-level idempotency + atomic transaction (contactRevealService)
// ============================================

/**
 * POST /api/head-hunter/reveal-contact
 * body: { candidateKey?|candidateId?, phone?, email?, linkedin?|linkedin_url? }
 * 1 credit per contact field (phone/email/linkedin), field-level idempotent.
 */
router.post(
    '/reveal-contact',
    conditionalRequireAuth(),
    requirePermission('headhunter.contact'),
    async (req: Request, res: Response) => {
        try {
            const orgId = getOrgId(req);
            const body = (req.body ?? {}) as Record<string, unknown>;
            const ctx = getAuthContext(req);

            const result = await executeContactReveal({
                organizationId: orgId,
                body,
                clerkUserId: getClerkUserId(req) || undefined,
                auditPayload: {
                    actorClerkUserId: ctx.userId,
                    actorEmail: ctx.email,
                    ip: (req.ip || req.headers['x-forwarded-for'] || '')
                        .toString()
                        .split(',')[0]
                        ?.trim(),
                    userAgent: (req.headers['user-agent'] || '').toString(),
                },
            });

            if (!result.ok) {
                const httpStatus =
                    result.code === 'INSUFFICIENT_CREDITS'
                        ? 402
                        : result.code === 'FEATURE_DENIED' || result.code === 'INACTIVE_SUBSCRIPTION'
                          ? 403
                          : result.code === 'CANDIDATE_ID_REQUIRED' || result.code === 'NO_CONTACT_PIECES'
                            ? 400
                            : 409;
                return res.status(httpStatus).json({
                    ok: false,
                    error: result.code,
                    message: result.message,
                });
            }

            return res.json({
                ok: true,
                alreadyRevealed: result.alreadyRevealed,
                creditsCharged: result.creditsCharged,
                candidateKey: result.candidateKey,
                revealedFields: result.revealedFields,
                newlyRevealedFields: result.newlyRevealedFields,
                balanceAfterMicro: result.balanceAfterMicro,
                creditsRemaining: result.creditsRemaining,
            });
        } catch (err) {
            console.error('[head-hunter] reveal-contact error:', err);
            return res.status(500).json({ ok: false, error: 'Internal server error' });
        }
    },
);

/**
 * POST /api/head-hunter/revealed-contacts
 * body: { keys: string[] } — hydrate field-level reveal state for visible cards.
 */
router.post(
    '/revealed-contacts',
    conditionalRequireAuth(),
    requirePermission('headhunter.contact'),
    async (req: Request, res: Response) => {
        try {
            const orgId = getOrgId(req);
            const body = (req.body ?? {}) as Record<string, unknown>;
            const rawKeys = Array.isArray(body.keys) ? body.keys : [];
            const keys = [
                ...new Set(
                    rawKeys
                        .map((k) => (typeof k === 'string' ? k.trim() : ''))
                        .filter(Boolean)
                        .slice(0, 500),
                ),
            ];

            if (keys.length === 0) {
                return res.json({ ok: true, records: [], revealed: [] });
            }

            const records = await listRevealedContactStates(orgId, keys);
            const fullyRevealedKeys = records
                .filter((r) => r.legacyFullReveal || r.revealedFields.length > 0)
                .map((r) => r.candidateKey);

            return res.json({
                ok: true,
                records,
                /** @deprecated use records — kept for backward-compatible clients */
                revealed: fullyRevealedKeys,
            });
        } catch (err) {
            console.error('[head-hunter] revealed-contacts error:', err);
            return res.status(500).json({ ok: false, error: 'Internal server error' });
        }
    },
);

// ============================================
// Sourcing Context — لقطة بروفايل المرشح + معايير البحث للهيد هانتر
// ============================================

const SC_STR_MAX = 600;
const SC_LONG_MAX = 2000;
const SC_ARR_MAX = 40;
const SC_TIMELINE_MAX = 12;

function scStr(v: unknown, max = SC_STR_MAX): string | undefined {
    if (v == null) return undefined;
    const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
    if (!s) return undefined;
    return s.length > max ? s.slice(0, max) : s;
}

function scStrArray(v: unknown, maxItems = SC_ARR_MAX, maxLen = 120): string[] | undefined {
    if (!Array.isArray(v)) return undefined;
    const out: string[] = [];
    for (const item of v) {
        const s = scStr(item, maxLen);
        if (s) out.push(s);
        if (out.length >= maxItems) break;
    }
    return out.length ? out : undefined;
}

/** يقصّ مصفوفة كائنات (timeline/education) إلى عدد محدود ويزيل القيم غير الكائنية. */
function scObjArray(v: unknown, maxItems = SC_TIMELINE_MAX): Record<string, unknown>[] | undefined {
    if (!Array.isArray(v)) return undefined;
    const out: Record<string, unknown>[] = [];
    for (const item of v) {
        if (isPlainRecord(item)) out.push(item);
        if (out.length >= maxItems) break;
    }
    return out.length ? out : undefined;
}

function sanitizeCandidateProfile(raw: unknown): Record<string, unknown> | undefined {
    if (!isPlainRecord(raw)) return undefined;
    const yearsRaw = raw.years_experience;
    const profile: Record<string, unknown> = {
        full_name: scStr(raw.full_name, 200),
        headline: scStr(raw.headline, SC_LONG_MAX),
        current_title: scStr(raw.current_title, 200),
        current_company: scStr(raw.current_company, 200),
        location: scStr(raw.location, 200),
        years_experience:
            typeof yearsRaw === 'number' && Number.isFinite(yearsRaw) ? yearsRaw : scStr(yearsRaw, 40),
        skills: scStrArray(raw.skills),
        languages: scStrArray(raw.languages),
        summary: scStr(raw.summary, SC_LONG_MAX),
        ai_summary: scStr(raw.ai_summary, SC_LONG_MAX),
        experience_timeline: scObjArray(raw.experience_timeline),
        education: scObjArray(raw.education),
        linkedin_url: scStr(raw.linkedin_url, 400),
    };
    for (const k of Object.keys(profile)) {
        if (profile[k] == null) delete profile[k];
    }
    return Object.keys(profile).length ? profile : undefined;
}

function sanitizeSearchCriteria(raw: unknown): Record<string, unknown> | undefined {
    if (!isPlainRecord(raw)) return undefined;
    const criteria: Record<string, unknown> = {
        position: scStr(raw.position, MAX_LEN),
        location: scStr(raw.location, MAX_LEN),
        yearsExperience: scStr(raw.yearsExperience, 40),
        ageRange: scStr(raw.ageRange, 40),
        query: scStr(raw.query, MAX_QUERY),
    };
    for (const k of Object.keys(criteria)) {
        if (criteria[k] == null) delete criteria[k];
    }
    return Object.keys(criteria).length ? criteria : undefined;
}

/**
 * POST /api/head-hunter/sourcing-context — يحفظ لقطة (بروفايل المرشح + معايير البحث)
 * عند توليد رابط مقابلة فيديو من نتائج الهيد هانتر، ويعيد معرّفاً قصيراً يُحمل في الرابط (?hh=).
 */
router.post(
    '/sourcing-context',
    conditionalRequireAuth(),
    requirePermission('headhunter.search'),
    async (req: Request, res: Response) => {
        const body = req.body ?? {};
        const candidateProfile = sanitizeCandidateProfile(body.candidateProfile);
        const searchCriteria = sanitizeSearchCriteria(body.searchCriteria);
        const campaignId = typeof body.campaignId === 'string' ? body.campaignId.trim() : '';
        // NOTE: `body.position` is deliberately NOT read. The role is taken from
        // the campaign below — see the comment at the create() call.

        if (!candidateProfile && !searchCriteria) {
            return res
                .status(400)
                .json({ ok: false, error: 'candidateProfile or searchCriteria is required' });
        }

        /*
         * 🔴 A share link must name a real RecruitmentCampaign. This is the
         * strongest fail-closed point in the whole path: no campaign ⇒ no
         * context id ⇒ the UI cannot build a link at all. Everything downstream
         * (the organization, the blueprint, the readiness gate, the pinned
         * competencies, Stage 3) hangs off it.
         */
        if (!campaignId) {
            return res.status(400).json({
                ok: false,
                code: 'CAMPAIGN_REQUIRED',
                error: 'campaignId is required — a share link must interview for a campaign',
            });
        }

        const orgId = getOrgId(req);
        /*
         * OWNERSHIP RE-VERIFICATION. The browser can name any campaign it likes;
         * `orgScopedQuery` adds the caller's SESSION organization, so a campaign
         * outside it simply does not exist here. Correct at this point precisely
         * because the caller IS authenticated — unlike the public intake, where
         * the same scoping would be the cross-tenant bug.
         */
        const campaign = await RecruitmentCampaign.findOne(
            orgScopedQuery(req, { campaignId })
        )
            .select(
                'campaignId organizationId status formBinding criteria.position criteria.position_applied_for criteria.job templateName'
            )
            .lean()
            .catch(() => null);

        if (!campaign) {
            return res.status(404).json({
                ok: false,
                code: 'CAMPAIGN_NOT_FOUND',
                error: 'Campaign not found in this organization',
            });
        }
        if (campaign.status === 'closed') {
            return res.status(409).json({
                ok: false,
                code: 'CAMPAIGN_CLOSED',
                error: 'This campaign is no longer accepting applications',
            });
        }
        /*
         * A screening-form campaign carries a `formBinding`, and the public
         * intake validates every submission against it — including `skills` and
         * `cv`, which the short video intake form does not collect. Binding a
         * video invitation to one turns this 400 into a different 400 at the
         * worst possible moment: after the candidate has filled in the form.
         * The picker filters these out; this is the server saying the same thing
         * to a client that did not.
         */
        if ((campaign as any).formBinding) {
            return res.status(409).json({
                ok: false,
                code: 'CAMPAIGN_NOT_SHAREABLE_FOR_VIDEO',
                error: 'This is a screening-form campaign and cannot host a video invitation',
            });
        }

        try {
            const contextId = crypto.randomBytes(12).toString('hex');
            const createdBy = getClerkUserId(req);
            /*
             * ⚠️ The role comes from the CAMPAIGN, and `body.position` is
             * ignored outright.
             *
             * Not merely preferred — structurally enforced. Commit 8083f02 fixed
             * a share link that advertised the candidate's CURRENT job title as
             * the role they were applying for, which the candidate then saw on
             * the form and which was recorded as what they "declared". Reading
             * the body at all would leave that defect one client bug away from
             * returning, and the Head Hunter search's own target role is no
             * better a source: it is not what the campaign hires for.
             */
            const campaignRole = campaignRoleFromCampaign(campaign as any);
            await HeadHunterSourcingContext.create({
                contextId,
                candidateProfile,
                searchCriteria,
                campaignId,
                position: campaignRole || undefined,
                organizationId: orgId,
                createdByClerkUserId: createdBy || undefined,
            });

            logAudit(req, {
                action: 'headhunter.sourcing_context_created',
                targetType: 'headhunter',
                metadata: { contextId, campaignId, position: campaignRole || null },
            });

            return res.json({ ok: true, id: contextId });
        } catch (err) {
            console.error('[head-hunter] sourcing-context create error:', err);
            return res.status(500).json({ ok: false, error: 'Internal server error' });
        }
    }
);

/**
 * GET /api/head-hunter/sourcing-context/:id — قراءة داخلية (auth + org scope).
 */
router.get(
    '/sourcing-context/:id',
    conditionalRequireAuth(),
    requirePermission('headhunter.search'),
    async (req: Request, res: Response) => {
        const id = typeof req.params.id === 'string' ? req.params.id.trim() : '';
        if (!isValidHeadHunterContextId(id)) {
            return res.status(400).json({ ok: false, error: 'Invalid id' });
        }
        try {
            const orgId = getOrgId(req);
            const ctx = await getInternalHeadHunterSourcingContext(id, orgId);
            if (!ctx) {
                return res.status(404).json({ ok: false, error: 'not_found' });
            }
            const profile = (ctx.candidateProfile || {}) as Record<string, unknown>;
            return res.json({
                ok: true,
                context: {
                    id: ctx.contextId,
                    position: ctx.position || ctx.searchCriteria?.position || null,
                    campaignId: ctx.campaignId || null,
                    searchCriteria: ctx.searchCriteria || null,
                    candidateProfile: profile,
                },
            });
        } catch (err) {
            console.error('[head-hunter] sourcing-context read error');
            return res.status(500).json({ ok: false, error: 'Internal server error' });
        }
    }
);

/**
 * POST /api/head-hunter/competency-model/warm — start the role model early.
 *
 * The model takes 76-110 seconds of LLM time, which can never sit on the search
 * request. Built only when Search is pressed, the FIRST search of a role that
 * matches no curated pack therefore shipped with no competencies at all and was
 * ranked loosely, while the same search minutes later ranked strictly — the same
 * role scoring two different ways depending on timing alone.
 *
 * The recruiter picks the role 30-90 seconds before they press Search. Starting
 * the generation at that moment usually closes the gap, and because the model is
 * now persisted this costs one LLM call per role rather than one per search.
 *
 * Deliberately best effort: it never 400s on a filter it cannot parse (unlike
 * /search, which must), never waits for the upgrade, and never reports failure
 * to the page. Warming is an optimisation; nothing may depend on it.
 */
router.post(
    '/competency-model/warm',
    conditionalRequireAuth(),
    requirePermission('headhunter.search'),
    async (req: Request, res: Response) => {
        try {
            const body = (req.body ?? {}) as Record<string, unknown>;
            const position = str(body.position, 200);
            if (!position) return res.json({ ok: true, ready: false });

            // The same derivation /search uses, minus its rejections — the cache
            // key must match exactly or the warm-up heats the wrong entry.
            const criteria: Record<string, string> = {};
            for (const key of OPTIONAL_CRITERION_KEYS) {
                try {
                    const parsed = parseOptionalCriterion(body, key);
                    if (parsed) criteria[key] = parsed;
                } catch {
                    /* an unparseable filter is simply not part of the warm key */
                }
            }
            const experience = resolveSearchExperienceFilters({
                yearsOfExperience: body.yearsOfExperience,
                ageRange: body.ageRange,
            });
            if (experience.ok) {
                for (const [k, v] of Object.entries(experience.filters.optionalCriteriaExtras)) {
                    criteria[k] = v;
                }
            }

            const model = await buildHeadHunterCompetencyModel({
                position,
                location: str(body.location, 200),
                query: str(body.query, 2000),
                criteria,
                ...roleFieldsFrom(body),
            });
            return res.json({
                ok: true,
                ready: Array.isArray(model?.competencies) && model.competencies.length > 0,
            });
        } catch {
            // Never surface a warm-up failure: the search still works without it.
            return res.json({ ok: true, ready: false });
        }
    }
);

// ============================================================================
// SEARCH HISTORY — the durable replacement for a browser's localStorage
// ============================================================================
//
// Every search here cost credits. Keeping the only copy in one browser meant a
// cleared cache, a second device or a second account silently erased paid work;
// that is how three searches vanished for the owner on 2026-09-16. Scope is the
// ORGANIZATION, matching every other tenant-owned record — the originating user
// is stored for attribution, never used to filter.

/** Newest rows kept per organization. Older ones are pruned on write. */
const MAX_HISTORY_PER_ORG = 50;
/** A payload larger than this is a bug, not a result set. Mongo's own ceiling is 16MB. */
const MAX_HISTORY_PAYLOAD_BYTES = 2 * 1024 * 1024;

type HistoryInput = Record<string, unknown>;

function str(v: unknown, max = 400): string {
    return String(v ?? '').trim().slice(0, max);
}

/**
 * The catalog picker's structured role, as the search UI already posts it.
 *
 * This route used to read only `position`, so the picker's choice was thrown away
 * server-side and the role had to be re-derived by fuzzy string matching — which put
 * "Talent Acquisition Partner" on `lawyer` and any "… Specialist" on `graduate_trainee`.
 * Both call sites derive it through this one helper: /search and the warm-up must agree
 * exactly, or the warm-up heats a different cache entry than the search reads.
 */
function roleFieldsFrom(body: Record<string, unknown>): {
    roleKey: string;
    labelKey: string;
    careerLevel: string;
    managementTrack: string;
} {
    return {
        roleKey: str(body.roleKey, 80),
        labelKey: str(body.labelKey, 120),
        careerLevel: str(body.careerLevel, 40),
        managementTrack: str(body.managementTrack, 40),
    };
}

/**
 * Shape one row from client input. Returns null when the row cannot be trusted:
 * a history entry with no position or no timestamp cannot be listed or ordered,
 * and an oversized payload is refused rather than silently truncated.
 */
function normalizeHistoryEntry(
    raw: HistoryInput,
    orgId: string,
    clerkUserId: string
): Record<string, unknown> | null {
    const position = str(raw.position, 200);
    const entryId = str(raw.id ?? raw.entryId, 100);
    const receivedAtRaw = str(raw.receivedAt, 60);
    if (!position || !entryId || !receivedAtRaw) return null;
    const receivedAt = new Date(receivedAtRaw);
    if (Number.isNaN(receivedAt.getTime())) return null;

    if (raw.payload !== undefined && raw.payload !== null) {
        try {
            if (JSON.stringify(raw.payload).length > MAX_HISTORY_PAYLOAD_BYTES) return null;
        } catch {
            return null; // circular or unserialisable — not a result set
        }
    }

    const minCandidateCount = Number(raw.minCandidateCount);
    return {
        organizationId: orgId,
        entryId,
        ...(str(raw.searchId, 120) ? { searchId: str(raw.searchId, 120) } : {}),
        position,
        location: str(raw.location, 200),
        ...(str(raw.yearsExperience, 40) ? { yearsExperience: str(raw.yearsExperience, 40) } : {}),
        ...(str(raw.ageRange, 40) ? { ageRange: str(raw.ageRange, 40) } : {}),
        ...(str(raw.query, 2000) ? { query: str(raw.query, 2000) } : {}),
        ...(Number.isFinite(minCandidateCount) && minCandidateCount > 0
            ? { minCandidateCount }
            : {}),
        ...(raw.aiCompareTop ? { aiCompareTop: true } : {}),
        ...(raw.availableEmployeesOnly ? { availableEmployeesOnly: true } : {}),
        ...(raw.arabicTranslation ? { arabicTranslation: true } : {}),
        receivedAt,
        ...(raw.payload !== undefined ? { payload: raw.payload } : {}),
        ...(clerkUserId ? { createdByClerkUserId: clerkUserId } : {}),
    };
}

/** The wire shape the page already expects, so the hook's records are unchanged. */
function toHistoryRecord(row: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {
        id: row.entryId,
        position: row.position,
        location: row.location ?? '',
        receivedAt:
            row.receivedAt instanceof Date
                ? row.receivedAt.toISOString()
                : String(row.receivedAt ?? ''),
        payload: row.payload ?? null,
    };
    for (const k of [
        'searchId',
        'yearsExperience',
        'ageRange',
        'query',
        'minCandidateCount',
        'aiCompareTop',
        'availableEmployeesOnly',
        'arabicTranslation',
    ]) {
        if (row[k] !== undefined && row[k] !== null) out[k] = row[k];
    }
    return out;
}

/**
 * May this organization take ownership of an imported history row?
 *
 * Exported and pure so the rule can be proven without booting Express. The
 * browser's legacy rows carry no organization — that concept never existed in
 * localStorage — and one person can belong to several orgs, so "import into
 * whichever org is open" would publish one tenant's candidate list to another
 * tenant's staff. The only trustworthy attribution is this org's own audit log,
 * written by /search itself and unforgeable from the browser.
 *
 * A row with no searchId cannot be attributed to anyone and is refused.
 */
export function historyImportAllowed(searchId: unknown, ownedSearchIds: Set<string>): boolean {
    const sid = typeof searchId === 'string' ? searchId.trim() : '';
    return sid.length > 0 && ownedSearchIds.has(sid);
}

/** Keep the newest MAX_HISTORY_PER_ORG rows. Best effort — never fails a write. */
async function pruneHistory(orgId: string): Promise<void> {
    try {
        const stale = await HeadHunterSearchHistory.find({ organizationId: orgId })
            .sort({ receivedAt: -1 })
            .skip(MAX_HISTORY_PER_ORG)
            .select('_id')
            .lean();
        if (stale.length) {
            await HeadHunterSearchHistory.deleteMany({ _id: { $in: stale.map((r) => r._id) } });
        }
    } catch (err) {
        console.warn('[head-hunter] history prune failed:', err instanceof Error ? err.message : err);
    }
}

/** GET /api/head-hunter/history — this organization's searches, newest first. */
router.get(
    '/history',
    conditionalRequireAuth(),
    requirePermission('headhunter.search'),
    async (req: Request, res: Response) => {
        try {
            const orgId = getOrgId(req);
            const limitRaw = Number(req.query.limit);
            const limit =
                Number.isFinite(limitRaw) && limitRaw > 0
                    ? Math.min(Math.floor(limitRaw), MAX_HISTORY_PER_ORG)
                    : MAX_HISTORY_PER_ORG;
            const rows = await HeadHunterSearchHistory.find({ organizationId: orgId })
                .sort({ receivedAt: -1 })
                .limit(limit)
                .lean();
            return res.json({ ok: true, history: rows.map(toHistoryRecord) });
        } catch (err) {
            console.error('[head-hunter] history list error');
            return res.status(500).json({ ok: false, error: 'Internal server error' });
        }
    }
);

/**
 * PUT /api/head-hunter/history — create or update one row.
 *
 * Keyed by `searchId` when there is one, because the page upserts the same
 * search repeatedly while results stream in from n8n; otherwise by `entryId`.
 * Both are scoped to the organization, so one tenant can never address another's
 * row even by guessing an id.
 */
router.put(
    '/history',
    conditionalRequireAuth(),
    requirePermission('headhunter.search'),
    async (req: Request, res: Response) => {
        try {
            const orgId = getOrgId(req);
            const doc = normalizeHistoryEntry(
                (req.body ?? {}) as HistoryInput,
                orgId,
                getClerkUserId(req)
            );
            if (!doc) {
                return res.status(400).json({ ok: false, error: 'invalid_history_entry' });
            }
            const filter = doc.searchId
                ? { organizationId: orgId, searchId: doc.searchId as string }
                : { organizationId: orgId, entryId: doc.entryId as string };
            // `entryId` is immutable once the row exists: the page holds it as the
            // record's identity, and changing it under an open list would orphan it.
            const { entryId, ...mutable } = doc;
            const saved = await HeadHunterSearchHistory.findOneAndUpdate(
                filter,
                { $set: mutable, $setOnInsert: { entryId } },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            ).lean();
            void pruneHistory(orgId);
            return res.json({ ok: true, entry: saved ? toHistoryRecord(saved) : null });
        } catch (err) {
            console.error('[head-hunter] history upsert error');
            return res.status(500).json({ ok: false, error: 'Internal server error' });
        }
    }
);

/**
 * POST /api/head-hunter/history/import — one-way lift of a browser's old history.
 *
 * Runs once per browser after the move to the server. Existing rows win: an entry
 * already on the server is never overwritten by a stale local copy, so importing
 * from a second device cannot roll results backwards.
 */
router.post(
    '/history/import',
    conditionalRequireAuth(),
    requirePermission('headhunter.search'),
    async (req: Request, res: Response) => {
        try {
            const orgId = getOrgId(req);
            const clerkUserId = getClerkUserId(req);
            const raw = Array.isArray((req.body as { entries?: unknown })?.entries)
                ? ((req.body as { entries: HistoryInput[] }).entries as HistoryInput[])
                : [];
            if (raw.length === 0) return res.json({ ok: true, imported: 0, skipped: 0 });

            /* WHOSE SEARCH IS IT? The browser's old rows carry no organization —
               that concept never existed in localStorage — and one person can
               belong to several. Importing "into whichever org is open" would
               publish one tenant's candidate list to another tenant's staff.
               So the server does not take the client's word: a row is imported
               only when THIS organization's audit log shows it actually ran that
               searchId. A row with no searchId cannot be attributed at all and is
               refused. The audit entry is written by /search itself, so it is the
               one record the browser could not have forged. */
            const ownedSearchIds = new Set<string>();
            try {
                const audits = await AuditLog.find({
                    organizationId: orgId,
                    action: 'headhunter.search',
                })
                    .select('metadata.searchId')
                    .lean();
                for (const a of audits) {
                    const sid = (a as { metadata?: { searchId?: unknown } }).metadata?.searchId;
                    if (typeof sid === 'string' && sid.trim()) ownedSearchIds.add(sid.trim());
                }
            } catch (err) {
                console.warn('[head-hunter] history import could not read the audit log');
                return res.status(503).json({ ok: false, error: 'attribution_unavailable' });
            }

            let imported = 0;
            let skipped = 0;
            let refused = 0;
            for (const item of raw.slice(0, MAX_HISTORY_PER_ORG)) {
                const doc = normalizeHistoryEntry(item, orgId, clerkUserId);
                if (!doc) {
                    skipped++;
                    continue;
                }
                if (!historyImportAllowed(doc.searchId, ownedSearchIds)) {
                    refused++;
                    continue;
                }
                const exists = await HeadHunterSearchHistory.findOne({
                    organizationId: orgId,
                    $or: [
                        { entryId: doc.entryId as string },
                        ...(doc.searchId ? [{ searchId: doc.searchId as string }] : []),
                    ],
                })
                    .select('_id')
                    .lean();
                if (exists) {
                    skipped++;
                    continue;
                }
                await HeadHunterSearchHistory.create(doc);
                imported++;
            }
            void pruneHistory(orgId);
            if (imported > 0 || refused > 0) {
                logAudit(req, {
                    action: 'headhunter.history_imported',
                    targetType: 'organization',
                    targetId: orgId,
                    // `refused` is the tenancy counter: rows this browser held that
                    // this organization never searched. A number above zero is not
                    // an error — it is the guard doing its job.
                    metadata: { imported, skipped, refused },
                });
            }
            return res.json({ ok: true, imported, skipped, refused });
        } catch (err) {
            console.error('[head-hunter] history import error');
            return res.status(500).json({ ok: false, error: 'Internal server error' });
        }
    }
);

/** DELETE /api/head-hunter/history/:entryId — remove one row from this org. */
router.delete(
    '/history/:entryId',
    conditionalRequireAuth(),
    requirePermission('headhunter.search'),
    async (req: Request, res: Response) => {
        try {
            const orgId = getOrgId(req);
            const entryId = str(req.params.entryId, 100);
            if (!entryId) return res.status(400).json({ ok: false, error: 'invalid_id' });
            const r = await HeadHunterSearchHistory.deleteOne({
                organizationId: orgId,
                entryId,
            });
            return res.json({ ok: true, removed: r.deletedCount > 0 });
        } catch (err) {
            console.error('[head-hunter] history delete error');
            return res.status(500).json({ ok: false, error: 'Internal server error' });
        }
    }
);

export default router;
