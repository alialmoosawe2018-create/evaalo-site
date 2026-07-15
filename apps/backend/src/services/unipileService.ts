// ============================================
// ملف: services/unipileService.ts
// الوظيفة: تكامل Unipile (Hosted Auth) — ربط حساب LinkedIn للمستخدم بزر واحد.
// ============================================
//
// النموذج: المنصّة تملك مفتاح Unipile واحداً (UNIPILE_API_KEY) في env. المستخدم
// لا يرى أي مفتاح. عند الضغط على Connect نولّد رابط مصادقة مُستضاف من Unipile،
// يسجّل المستخدم دخول LinkedIn مرة واحدة، ثم يُرسل Unipile account_id إلى
// notify_url الخاص بنا فنخزّنه لكل مؤسسة.
//
// مرجع: Unipile Hosted Auth — POST {DSN}/api/v1/hosted/accounts/link

import { callExternal } from './callExternal.js';

function dsn(): string {
    return (process.env.UNIPILE_DSN || '').trim().replace(/\/$/, '');
}

function apiKey(): string {
    return (process.env.UNIPILE_API_KEY || '').trim();
}

export function unipileConfigured(): boolean {
    return Boolean(dsn() && apiKey());
}

export interface HostedAuthLinkParams {
    /** يُعاد كـ name في إشعار Unipile — نستخدمه لربط الحساب بالمؤسسة. */
    orgId: string;
    notifyUrl: string;
    successUrl: string;
    failureUrl: string;
}

/** يولّد رابط Hosted Auth لربط LinkedIn. يرمي عند فشل الاتصال/التهيئة. */
export async function createLinkedInHostedAuthLink(
    params: HostedAuthLinkParams
): Promise<{ url: string }> {
    if (!unipileConfigured()) {
        throw new Error('UNIPILE_NOT_CONFIGURED');
    }
    const { orgId, notifyUrl, successUrl, failureUrl } = params;

    // صلاحية الرابط: ساعة واحدة
    const expiresOn = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const res = await callExternal(`${dsn()}/api/v1/hosted/accounts/link`, {
        method: 'POST',
        headers: {
            'X-API-KEY': apiKey(),
            accept: 'application/json',
        },
        body: {
            type: 'create',
            providers: ['LINKEDIN'],
            api_url: dsn(),
            expiresOn,
            name: orgId,
            notify_url: notifyUrl,
            success_redirect_url: successUrl,
            failure_redirect_url: failureUrl,
        },
        timeoutMs: 12_000,
        retries: 1,
    });

    const data = (await res.json().catch(() => ({}))) as { url?: string; object?: string };
    if (!res.ok || !data.url) {
        throw new Error(`unipile_hosted_link_failed_${res.status}`);
    }
    return { url: data.url };
}

export interface UnipileNotifyPayload {
    status?: string;
    account_id?: string;
    name?: string;
}

/** يتحقّق أن الإشعار يمثّل ربطاً ناجحاً. */
export function isCreationSuccess(payload: UnipileNotifyPayload): boolean {
    const s = (payload.status || '').toUpperCase();
    return s === 'CREATION_SUCCESS' || s === 'OK' || s === 'SUCCESS';
}

/** إرسال رسالة LinkedIn عبر Unipile (يبدأ محادثة جديدة مع ملف عبر هويته العامة). */
export async function sendLinkedInMessageViaUnipile(
    accountId: string,
    profileIdentifier: string,
    text: string
): Promise<{ ok: boolean; error?: string }> {
    if (!unipileConfigured()) return { ok: false, error: 'unipile_not_configured' };
    try {
        const res = await callExternal(`${dsn()}/api/v1/chats`, {
            method: 'POST',
            headers: {
                'X-API-KEY': apiKey(),
                accept: 'application/json',
            },
            body: {
                account_id: accountId,
                attendees_ids: [profileIdentifier],
                text,
            },
            timeoutMs: 15_000,
            retries: 1,
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            return { ok: false, error: `unipile_send_${res.status}: ${body.slice(0, 120)}` };
        }
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}
