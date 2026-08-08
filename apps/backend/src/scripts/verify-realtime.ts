// ============================================
// scripts/verify-realtime.ts
// Live check of the Phase 3 Redis transport against the configured REDIS_URL.
// Proves: TLS connection to the provider + pub/sub round-trip on a tenant channel,
// using the SAME redisClient module the server + relay + gateway use.
//
// Run (in an env where REDIS_URL is set — use the rediss:// TLS URL):
//   REDIS_URL="rediss://…" npx tsx src/scripts/verify-realtime.ts
//
// Does NOT touch Mongo, Clerk, or app data. Cleans up after itself.
// ============================================

import dotenv from 'dotenv';
import {
    initRealtimeRedis,
    isRealtimeEnabled,
    getPublisher,
    getSubscriber,
    orgChannel,
    closeRealtimeRedis,
} from '../realtime/redisClient.js';

dotenv.config();

async function main(): Promise<void> {
    initRealtimeRedis();
    if (!isRealtimeEnabled()) {
        console.error('❌ REDIS_URL not set — nothing to verify. Set REDIS_URL and retry.');
        process.exit(1);
    }

    const pub = getPublisher();
    const sub = getSubscriber();
    if (!pub || !sub) {
        console.error('❌ redis connections not available');
        process.exit(1);
    }

    const channel = orgChannel('__verify__');

    const received = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error('timeout waiting for message (10s)')),
            10_000,
        );
        sub.on('message', (ch: string, msg: string) => {
            if (ch === channel) {
                clearTimeout(timer);
                resolve(msg);
            }
        });
    });

    await sub.subscribe(channel);
    const payload = JSON.stringify({ type: 'VerifyPing', seq: 1, at: Date.now() });
    const t0 = Date.now();
    await pub.publish(channel, payload);

    const msg = await received;
    const latencyMs = Date.now() - t0;

    console.log(`✅ Redis pub/sub round-trip OK on ${channel} (${latencyMs}ms)`);
    console.log(`   received: ${msg}`);

    await sub.unsubscribe(channel);
    await closeRealtimeRedis();
    console.log('✅ realtime transport verified — TLS connection + tenant-channel pub/sub working');
    process.exit(0);
}

main().catch(async (err) => {
    console.error('❌ realtime verification failed:', (err as Error)?.message || err);
    await closeRealtimeRedis().catch(() => undefined);
    process.exit(1);
});
