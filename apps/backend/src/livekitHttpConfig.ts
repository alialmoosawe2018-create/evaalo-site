/**
 * Shared LiveKit HTTP (Twirp) settings and retry helpers for the Node backend.
 * Shape matches livekit-server-sdk ClientOptions (requestTimeout in seconds).
 */
export function getLivekitTwirpClientOptions(): { requestTimeout?: number } | undefined {
    const sec = Number(process.env.LIVEKIT_TWIRP_TIMEOUT_SEC);
    if (Number.isFinite(sec) && sec >= 5 && sec <= 600) {
        return { requestTimeout: sec };
    }
    return undefined;
}

/** Walk fetch/undici error.cause chain for transient network codes */
export function isRetryableLivekitNetworkError(err: unknown): boolean {
    let cur: unknown = err;
    for (let depth = 0; depth < 8 && cur != null; depth++) {
        const c = cur as { code?: string; cause?: unknown };
        const code = c.code;
        if (
            code === 'UND_ERR_CONNECT_TIMEOUT' ||
            code === 'UND_ERR_HEADERS_TIMEOUT' ||
            code === 'UND_ERR_BODY_TIMEOUT' ||
            code === 'ECONNRESET' ||
            code === 'ETIMEDOUT' ||
            code === 'ECONNREFUSED'
        ) {
            return true;
        }
        cur = c.cause;
    }
    return false;
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withLiveKitNetworkRetries<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const attempts = Math.max(1, Math.min(6, Number(process.env.LIVEKIT_HTTP_RETRIES) || 3));
    const baseMs = Math.max(300, Number(process.env.LIVEKIT_HTTP_RETRY_BASE_MS) || 1500);
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (e) {
            last = e;
            const retry = isRetryableLivekitNetworkError(e) && i < attempts - 1;
            if (!retry) {
                throw e;
            }
            const wait = baseMs * (i + 1);
            console.warn(
                `⚠️ ${label}: transient network error (attempt ${i + 1}/${attempts}), retry in ${wait}ms`,
                (e as Error)?.message
            );
            await sleep(wait);
        }
    }
    throw last;
}
