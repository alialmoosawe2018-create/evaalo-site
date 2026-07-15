// ============================================
// ملف: services/integrationService.ts
// الوظيفة: إدارة تكاملات المؤسسة (LinkedIn/WhatsApp) + تشفير الأسرار.
// ============================================
//
// التشفير: AES-256-GCM مع دعم تدوير المفاتيح (key rotation).
// متغيّر البيئة INTEGRATIONS_ENC_KEYS يحمل قائمة مفاتيح بالشكل:
//   v1:<base64-32byte-key>,v2:<base64-32byte-key>
// الأول = المفتاح الحالي (يُستخدم للتشفير). البقية للقراءة فقط (فك تشفير قديم).

import crypto from 'crypto';
import OrgIntegration from '../models/OrgIntegration.js';
import type { IntegrationProvider, IntegrationStatus } from '../models/OrgIntegration.js';

const ALGO = 'aes-256-gcm';

interface KeyRing {
    currentVersion: string;
    keys: Map<string, Buffer>;
}

let cachedRing: KeyRing | null = null;

function parseKeyRing(): KeyRing {
    if (cachedRing) return cachedRing;

    const raw = (process.env.INTEGRATIONS_ENC_KEYS || '').trim();
    if (!raw) {
        throw new Error(
            'INTEGRATIONS_ENC_KEYS not configured — required to store integration secrets'
        );
    }

    const keys = new Map<string, Buffer>();
    let currentVersion = '';
    for (const entry of raw.split(',')) {
        const trimmed = entry.trim();
        if (!trimmed) continue;
        const idx = trimmed.indexOf(':');
        if (idx === -1) continue;
        const version = trimmed.slice(0, idx).trim();
        const b64 = trimmed.slice(idx + 1).trim();
        if (!version || !b64) continue;
        const key = Buffer.from(b64, 'base64');
        if (key.length !== 32) {
            throw new Error(`INTEGRATIONS_ENC_KEYS: key "${version}" must be 32 bytes (base64)`);
        }
        keys.set(version, key);
        if (!currentVersion) currentVersion = version;
    }

    if (!currentVersion || keys.size === 0) {
        throw new Error('INTEGRATIONS_ENC_KEYS: no valid keys parsed');
    }

    cachedRing = { currentVersion, keys };
    return cachedRing;
}

/** يشفّر نصاً ويُرجِع الحمولة + نسخة المفتاح المستخدم. */
export function encryptSecret(plaintext: string): { enc: string; keyVersion: string } {
    const ring = parseKeyRing();
    const key = ring.keys.get(ring.currentVersion)!;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGO, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const enc = `${iv.toString('base64')}.${authTag.toString('base64')}.${ciphertext.toString('base64')}`;
    return { enc, keyVersion: ring.currentVersion };
}

/** يفك التشفير باستخدام نسخة المفتاح المخزّنة (يدعم المفاتيح القديمة بعد التدوير). */
export function decryptSecret(enc: string, keyVersion: string): string {
    const ring = parseKeyRing();
    const key = ring.keys.get(keyVersion);
    if (!key) {
        throw new Error(`decryptSecret: unknown keyVersion "${keyVersion}"`);
    }
    const [ivB64, tagB64, dataB64] = enc.split('.');
    if (!ivB64 || !tagB64 || !dataB64) {
        throw new Error('decryptSecret: malformed payload');
    }
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const plaintext = Buffer.concat([
        decipher.update(Buffer.from(dataB64, 'base64')),
        decipher.final(),
    ]);
    return plaintext.toString('utf8');
}

export interface IntegrationStatusDto {
    provider: IntegrationProvider;
    connected: boolean;
    status: IntegrationStatus;
    meta: Record<string, unknown>;
    /** Operational health (safe to surface in account/admin UI). */
    health: {
        lastConnectedAt: string | null;
        lastMessageSentAt: string | null;
        lastErrorAt: string | null;
        lastError: string | null;
    };
}

function toIso(d: unknown): string | null {
    return d instanceof Date ? d.toISOString() : typeof d === 'string' && d ? d : null;
}

function toStatusDto(doc: {
    provider: IntegrationProvider;
    connected?: boolean;
    status?: IntegrationStatus;
    meta?: Record<string, unknown>;
    lastConnectedAt?: unknown;
    lastMessageSentAt?: unknown;
    lastErrorAt?: unknown;
    lastError?: string;
}): IntegrationStatusDto {
    return {
        provider: doc.provider,
        connected: Boolean(doc.connected),
        status: doc.status || 'disconnected',
        meta: doc.meta || {},
        health: {
            lastConnectedAt: toIso(doc.lastConnectedAt),
            lastMessageSentAt: toIso(doc.lastMessageSentAt),
            lastErrorAt: toIso(doc.lastErrorAt),
            lastError: doc.lastError || null,
        },
    };
}

/** حالة كل التكاملات للمؤسسة (بدون أسرار). */
export async function listIntegrationStatus(orgId: string): Promise<IntegrationStatusDto[]> {
    const docs = await OrgIntegration.find({ organizationId: orgId }).lean();
    return docs.map(toStatusDto);
}

export async function getIntegrationStatus(
    orgId: string,
    provider: IntegrationProvider
): Promise<IntegrationStatusDto | null> {
    const doc = await OrgIntegration.findOne({ organizationId: orgId, provider }).lean();
    return doc ? toStatusDto(doc) : null;
}

/** يخزّن/يحدّث تكاملاً (يشفّر الأسرار، يحفظ meta المقنّعة). */
export async function connectIntegration(params: {
    orgId: string;
    provider: IntegrationProvider;
    secrets: Record<string, unknown>;
    meta?: Record<string, unknown>;
    updatedBy?: string;
}): Promise<IntegrationStatusDto> {
    const { orgId, provider, secrets, meta = {}, updatedBy } = params;
    const { enc, keyVersion } = encryptSecret(JSON.stringify(secrets));
    const doc = await OrgIntegration.findOneAndUpdate(
        { organizationId: orgId, provider },
        {
            $set: {
                organizationId: orgId,
                provider,
                connected: true,
                status: 'connected' as IntegrationStatus,
                secretsEnc: enc,
                keyVersion,
                meta,
                updatedBy,
                lastConnectedAt: new Date(),
            },
            $unset: { lastError: '', lastErrorAt: '' },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    return toStatusDto(doc!);
}

/** يفصل تكاملاً (يمسح الأسرار). */
export async function disconnectIntegration(
    orgId: string,
    provider: IntegrationProvider,
    updatedBy?: string
): Promise<void> {
    await OrgIntegration.findOneAndUpdate(
        { organizationId: orgId, provider },
        {
            $set: {
                connected: false,
                status: 'disconnected' as IntegrationStatus,
                updatedBy,
            },
            $unset: { secretsEnc: '', keyVersion: '' },
        },
        { upsert: true }
    );
}

/** يسجّل نجاح آخر إرسال (Health). */
export async function recordMessageSent(
    orgId: string,
    provider: IntegrationProvider
): Promise<void> {
    await OrgIntegration.updateOne(
        { organizationId: orgId, provider },
        { $set: { lastMessageSentAt: new Date(), status: 'connected' as IntegrationStatus } }
    ).catch(() => undefined);
}

/** يسجّل آخر خطأ (Health) — لتشخيص "لا يعمل" فوراً. */
export async function recordError(
    orgId: string,
    provider: IntegrationProvider,
    error: string
): Promise<void> {
    await OrgIntegration.updateOne(
        { organizationId: orgId, provider },
        { $set: { lastError: String(error).slice(0, 500), lastErrorAt: new Date(), status: 'error' as IntegrationStatus } }
    ).catch(() => undefined);
}

/** يُرجِع الأسرار المفكوكة للاستخدام الداخلي فقط (الإرسال). null إن غير متصل. */
export async function getDecryptedSecrets(
    orgId: string,
    provider: IntegrationProvider
): Promise<Record<string, unknown> | null> {
    const doc = await OrgIntegration.findOne({ organizationId: orgId, provider }).lean();
    if (!doc || !doc.connected || !doc.secretsEnc || !doc.keyVersion) return null;
    try {
        return JSON.parse(decryptSecret(doc.secretsEnc, doc.keyVersion)) as Record<string, unknown>;
    } catch (err) {
        console.error(`[integrationService] decrypt failed for ${provider}/${orgId}:`, err);
        return null;
    }
}
