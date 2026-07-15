// ============================================
// ملف: services/callExternal.ts
// الوظيفة: غلاف fetch موحّد مع timeout + إعادة محاولات محدودة (backoff).
// ============================================
//
// قاعدة المخاطرة: نعيد المحاولة فقط على أخطاء الشبكة و 5xx — لا نعيد على 4xx
// (طلب غير صالح / صلاحيات / كردنشل خاطئة) لأن الإعادة لن تُصلحها.

export interface CallExternalOptions {
    method?: string;
    headers?: Record<string, string>;
    /** سيُحوَّل إلى JSON تلقائياً ما لم يكن string أو FormData. */
    body?: unknown;
    /** مهلة كل محاولة بالميلي ثانية (افتراضي 15000). */
    timeoutMs?: number;
    /** عدد المحاولات الإضافية بعد المحاولة الأولى (افتراضي 2). */
    retries?: number;
    /** تأخير أساسي للـ backoff بالميلي ثانية (افتراضي 400). */
    backoffBaseMs?: number;
}

export class ExternalCallError extends Error {
    status: number;
    body: string;
    constructor(message: string, status: number, body = '') {
        super(message);
        this.name = 'ExternalCallError';
        this.status = status;
        this.body = body;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
    return status >= 500 && status <= 599;
}

type SerializedBody = string | FormData | undefined;

function serializeBody(body: unknown, headers: Record<string, string>): SerializedBody {
    if (body === undefined || body === null) return undefined;
    if (typeof body === 'string') return body;
    // FormData تمرّ كما هي
    if (typeof FormData !== 'undefined' && body instanceof FormData) return body;
    if (!('content-type' in headers) && !('Content-Type' in headers)) {
        headers['Content-Type'] = 'application/json';
    }
    return JSON.stringify(body);
}

/**
 * نداء HTTP خارجي موثوق: timeout لكل محاولة + إعادة محاولات على الشبكة/5xx فقط.
 * يُرجِع كائن fetch Response عند نجاح الاتصال (status أي). يرمي ExternalCallError
 * عند فشل الشبكة/المهلة بعد استنفاد المحاولات.
 */
export async function callExternal(url: string, options: CallExternalOptions = {}): Promise<Response> {
    const {
        method = 'GET',
        headers = {},
        body,
        timeoutMs = 15_000,
        retries = 2,
        backoffBaseMs = 400,
    } = options;

    const finalHeaders: Record<string, string> = { ...headers };
    const finalBody = serializeBody(body, finalHeaders);

    let lastErr: unknown = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, {
                method,
                headers: finalHeaders,
                body: finalBody,
                signal: controller.signal,
            });
            clearTimeout(timer);

            // أخطاء 5xx قابلة للإعادة؛ 4xx لا تُعاد ونُرجعها للمتصل ليقرأها.
            if (isRetryableStatus(res.status) && attempt < retries) {
                lastErr = new ExternalCallError(`upstream_${res.status}`, res.status);
                await sleep(backoffBaseMs * 2 ** attempt);
                continue;
            }
            return res;
        } catch (err) {
            clearTimeout(timer);
            lastErr = err;
            // أخطاء الشبكة/المهلة قابلة للإعادة
            if (attempt < retries) {
                await sleep(backoffBaseMs * 2 ** attempt);
                continue;
            }
        }
    }

    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new ExternalCallError(`external_call_failed: ${msg}`, 0);
}

/** نسخة مريحة تُرجِع JSON مع رمي خطأ على ردود غير ناجحة. */
export async function callExternalJson<T = unknown>(
    url: string,
    options: CallExternalOptions = {}
): Promise<T> {
    const res = await callExternal(url, options);
    const text = await res.text().catch(() => '');
    if (!res.ok) {
        throw new ExternalCallError(`http_${res.status}`, res.status, text.slice(0, 500));
    }
    if (!text) return undefined as unknown as T;
    try {
        return JSON.parse(text) as T;
    } catch {
        return text as unknown as T;
    }
}
