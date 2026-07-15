/**
 * مسارات تجربة استقبال Evaalo.
 * POST /prepare | /start | /end — غرف LiveKit منفصلة عن مقابلات الفيديو، و dispatch إلى evaalo-reception-agent.
 *
 * فصل البيانات عن الجلسة (مهم):
 * - بيانات النموذج (firstName/lastName/email/company) لا تُحقن في LiveKit metadata ولا في leadSig.
 * - تُحفظ فقط في MongoDB عبر ReceptionLead — fire-and-forget داخل /start (لا يُبلوك الردّ).
 * - الجلسة تُنشأ على أساس visitorId وحده، فيمكن للواجهة تحضيرها فور تحميل صفحة /demo
 *   (قبل تعبئة النموذج)؛ /start يعيد استخدام نفس الجلسة بدون استبدال للغرفة.
 */

import express from 'express';
import {
    createLiveKitRoom,
    createUserToken,
    deleteLiveKitRoom,
    dispatchAgentToRoom,
    getLiveKitCredentials,
} from '../services/livekitService.js';
import ReceptionLead from '../models/ReceptionLead.js';

const router = express.Router();

const SCOPE = 'reception' as const;
const RECEPTION_AGENT_NAME = 'evaalo-reception-agent';

type ReceptionSessionRow = {
    roomName: string;
    token: string;
    sessionId: string;
    visitorId: string;
    createdAt: number;
};

type LeadFields = {
    firstName: string;
    lastName: string;
    email: string;
    company: string;
};

/** مفتاح = visitorId */
const activeReceptionSessions = new Map<string, ReceptionSessionRow>();

const ACTIVE_SESSION_TTL_MS = 5 * 60 * 1000;
const REUSE_WINDOW_MS = 2 * 60 * 1000;

/** يمنع استدعاء ensure متزامن لنفس visitorId (prepare + start أو نقر مزدوج) — كان يسبب غرف/dispatch مزدوج وتعطيل الأفاتار */
const ensureChainByVisitor = new Map<string, Promise<unknown>>();

async function runSerializedPerVisitor<T>(visitorId: string, fn: () => Promise<T>): Promise<T> {
    const prev = ensureChainByVisitor.get(visitorId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    ensureChainByVisitor.set(visitorId, next.then(() => undefined, () => undefined));
    return next;
}

function normalizeLeadFromBody(body: unknown): LeadFields {
    const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const pick = (camel: string, snake: string, max: number): string => {
        const v = b[camel] ?? b[snake];
        if (typeof v !== 'string') return '';
        return v.trim().slice(0, max);
    };
    return {
        firstName: pick('firstName', 'visitor_first_name', 80),
        lastName: pick('lastName', 'visitor_last_name', 80),
        email: pick('email', 'visitor_email', 160),
        company: pick('company', 'visitor_company', 200),
    };
}

/**
 * Metadata الجلسة — لا تحتوي إطلاقاً على بيانات الزائر الشخصية.
 * الوكيل (worker.py) يقرأ visitor_id / session_id / demo_mode فقط؛ الترحيب يبقى عاماً.
 */
function buildReceptionMetadata(visitorId: string, sessionId: string): Record<string, string> {
    return {
        visitor_id: visitorId,
        session_id: sessionId,
        demo_mode: 'reception',
    };
}

function validateStartLead(lead: LeadFields): string | null {
    if (!lead.firstName) return 'firstName is required';
    if (!lead.lastName) return 'lastName is required';
    if (!lead.email) return 'email is required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) return 'valid email is required';
    return null;
}

function sanitizeVisitorId(raw: unknown): string {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s || s.length > 220) return '';
    const cleaned = s.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
    return cleaned || '';
}

function cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [, row] of activeReceptionSessions.entries()) {
        if (now - row.createdAt > ACTIVE_SESSION_TTL_MS) {
            activeReceptionSessions.delete(row.visitorId);
            deleteLiveKitRoom(row.roomName, SCOPE).catch((err: unknown) => {
                console.warn(
                    `⚠️ receptionDemo cleanup: failed to delete room ${row.roomName}:`,
                    (err as Error)?.message || err
                );
            });
        }
    }
}

function findRowBySessionId(sessionId: string): ReceptionSessionRow | undefined {
    for (const row of activeReceptionSessions.values()) {
        if (row.sessionId === sessionId) return row;
    }
    return undefined;
}

/**
 * Ensure-or-reuse للجلسة على مستوى visitorId فقط.
 * لا يأخذ lead — البيانات الشخصية لا تشارك في إنشاء/مطابقة الغرفة.
 * النتيجة: prewarm + start يستخدمان نفس الغرفة (لا استبدال).
 */
async function ensureReceptionLiveKitSession(visitorId: string): Promise<{
    sessionId: string;
    roomName: string;
    token: string;
    reused: boolean;
}> {
    return runSerializedPerVisitor(visitorId, () => ensureReceptionLiveKitSessionCore(visitorId));
}

async function ensureReceptionLiveKitSessionCore(visitorId: string): Promise<{
    sessionId: string;
    roomName: string;
    token: string;
    reused: boolean;
}> {
    const { url, apiKey, apiSecret } = getLiveKitCredentials(SCOPE);
    if (!url || !apiKey || !apiSecret) {
        throw new Error(
            'Missing LiveKit credentials for reception (LIVEKIT_RECEPTION_* or LIVEKIT_* in .env)'
        );
    }

    cleanupExpiredSessions();

    const existing = activeReceptionSessions.get(visitorId);
    if (existing && Date.now() - existing.createdAt < REUSE_WINDOW_MS) {
        return {
            sessionId: existing.sessionId,
            roomName: existing.roomName,
            token: existing.token,
            reused: true,
        };
    }

    if (existing) {
        activeReceptionSessions.delete(visitorId);
        await deleteLiveKitRoom(existing.roomName, SCOPE).catch((err: unknown) => {
            console.warn(
                '⚠️ receptionDemo: replacing expired session, delete old room:',
                (err as Error)?.message || err
            );
        });
    }

    const sessionId = `reception-demo-${visitorId}-${Date.now()}`;
    const roomName = await createLiveKitRoom(visitorId, SCOPE);

    const metadata = buildReceptionMetadata(visitorId, sessionId);

    const token = await createUserToken(roomName, `guest-${visitorId}`, metadata, SCOPE);
    if (typeof token !== 'string') {
        throw new Error('Invalid LiveKit token');
    }

    await dispatchAgentToRoom(roomName, metadata, RECEPTION_AGENT_NAME, SCOPE);

    activeReceptionSessions.set(visitorId, {
        roomName,
        token,
        sessionId,
        visitorId,
        createdAt: Date.now(),
    });

    return { sessionId, roomName, token, reused: false };
}

/**
 * يحفظ بيانات الزائر في Mongo بشكل fire-and-forget دون أن يُبلوك الـ response.
 * يُستخدم في /start بعد التحقق من صحة الحقول (firstName/lastName/email).
 */
function persistReceptionLead(
    visitorId: string,
    sessionId: string,
    lead: LeadFields,
    extra: { userAgent?: string; locale?: string }
): void {
    void (async () => {
        try {
            const existing = await ReceptionLead.findOne({ visitorId }).exec();
            if (existing) {
                existing.sessionId = sessionId;
                existing.firstName = lead.firstName;
                existing.lastName = lead.lastName;
                existing.email = lead.email.toLowerCase();
                existing.company = lead.company || existing.company;
                existing.lastSeenAt = new Date();
                existing.attempts = (existing.attempts ?? 1) + 1;
                if (extra.userAgent) existing.userAgent = extra.userAgent;
                if (extra.locale) existing.locale = extra.locale;
                await existing.save();
                return;
            }
            await ReceptionLead.create({
                visitorId,
                sessionId,
                firstName: lead.firstName,
                lastName: lead.lastName,
                email: lead.email.toLowerCase(),
                company: lead.company || undefined,
                userAgent: extra.userAgent,
                locale: extra.locale,
            });
        } catch (e: unknown) {
            console.warn(
                '⚠️ receptionDemo: failed to persist lead (non-fatal):',
                (e as Error)?.message || e
            );
        }
    })();
}

/** POST /api/reception-demo/prepare — لا يحتاج بيانات النموذج. visitorId فقط. */
router.post('/prepare', async (req, res) => {
    try {
        const visitorId = sanitizeVisitorId(req.body?.visitorId);
        if (!visitorId) {
            return res.status(400).json({
                success: false,
                message: 'visitorId is required',
            });
        }

        const { url } = getLiveKitCredentials(SCOPE);
        if (!url) {
            return res.status(503).json({
                success: false,
                message: 'LiveKit URL not configured',
            });
        }

        const out = await ensureReceptionLiveKitSession(visitorId);

        return res.status(200).json({
            success: true,
            sessionId: out.sessionId,
            visitorId,
            livekit: {
                roomName: out.roomName,
                url,
                token: out.token,
            },
            reused: out.reused,
        });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('❌ reception-demo/prepare:', msg);
        return res.status(500).json({
            success: false,
            message: 'Failed to prepare reception demo',
            error: msg,
        });
    }
});

/**
 * POST /api/reception-demo/start
 * - يتحقق من بيانات النموذج، لكن لا يحقنها في metadata.
 * - يستعيد الجلسة المحضّرة (نفس الغرفة).
 * - يحفظ الـ lead في Mongo (fire-and-forget) — لا يُبلوك الردّ.
 */
router.post('/start', async (req, res) => {
    try {
        const visitorId = sanitizeVisitorId(req.body?.visitorId);
        if (!visitorId) {
            return res.status(400).json({
                success: false,
                message: 'visitorId is required',
            });
        }

        const { url } = getLiveKitCredentials(SCOPE);
        if (!url) {
            return res.status(503).json({
                success: false,
                message: 'LiveKit URL not configured',
            });
        }

        const lead = normalizeLeadFromBody(req.body);
        const startErr = validateStartLead(lead);
        if (startErr) {
            return res.status(400).json({
                success: false,
                message: startErr,
            });
        }

        const out = await ensureReceptionLiveKitSession(visitorId);

        persistReceptionLead(visitorId, out.sessionId, lead, {
            userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
            locale:
                typeof req.headers['accept-language'] === 'string'
                    ? req.headers['accept-language'].split(',')[0]?.trim()
                    : undefined,
        });

        return res.status(200).json({
            success: true,
            sessionId: out.sessionId,
            visitorId,
            livekit: {
                roomName: out.roomName,
                url,
                token: out.token,
            },
        });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('❌ reception-demo/start:', msg);
        return res.status(500).json({
            success: false,
            message: 'Failed to start reception demo',
            error: msg,
        });
    }
});

/** POST /api/reception-demo/end */
router.post('/end', async (req, res) => {
    try {
        const sessionId =
            typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : '';
        const visitorId = sanitizeVisitorId(req.body?.visitorId);

        cleanupExpiredSessions();

        let row: ReceptionSessionRow | undefined;
        if (sessionId) {
            row = findRowBySessionId(sessionId);
        }
        if (!row && visitorId) {
            row = activeReceptionSessions.get(visitorId);
        }

        if (!row) {
            return res.status(200).json({
                success: true,
                message: 'No active reception session (already ended)',
            });
        }

        activeReceptionSessions.delete(row.visitorId);

        try {
            await deleteLiveKitRoom(row.roomName, SCOPE);
        } catch (e: unknown) {
            console.warn('⚠️ reception-demo/end delete room:', (e as Error)?.message || e);
        }

        return res.status(200).json({
            success: true,
            message: 'Reception demo ended',
            sessionId: row.sessionId,
        });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('❌ reception-demo/end:', msg);
        return res.status(500).json({
            success: false,
            message: msg,
        });
    }
});

export default router;
