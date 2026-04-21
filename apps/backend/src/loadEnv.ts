/**
 * تحميل .env أولاً قبل أي ملف آخر
 * يُستورد كأول سطر في server.ts لضمان تحميل المتغيرات قبل الخدمات
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { Agent, setGlobalDispatcher } from 'undici';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

/**
 * Node's global fetch (undici) uses a short default connect timeout (~10s).
 * LiveKit Twirp to *.livekit.cloud can fail with UND_ERR_CONNECT_TIMEOUT on VPNs or slow routes.
 *
 * When LIVEKIT_URL is set, default connect timeout is 30s unless overridden.
 * Set LIVEKIT_FETCH_CONNECT_TIMEOUT_MS=0 (or "off") to keep Node defaults.
 */
(function configureLivekitGlobalFetch(): void {
    const hasUrl = !!(process.env.LIVEKIT_URL || '').trim();
    const raw = (process.env.LIVEKIT_FETCH_CONNECT_TIMEOUT_MS || '').trim().toLowerCase();
    if (raw === '0' || raw === 'off' || raw === 'false') {
        return;
    }

    let connectMs: number | null = null;
    if (raw !== '') {
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 1000) {
            connectMs = Math.min(Math.floor(n), 120000);
        }
    } else if (hasUrl) {
        connectMs = 30000;
    }
    if (connectMs == null) {
        return;
    }

    setGlobalDispatcher(
        new Agent({
            connectTimeout: connectMs,
            headersTimeout: Math.max(connectMs, 60_000),
            bodyTimeout: 120_000,
        }),
    );
})();
