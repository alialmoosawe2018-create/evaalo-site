/**
 * Realtime Redis client (Phase 3).
 *
 * Two dedicated connections: a PUBLISHER (used by the event relay) and a
 * SUBSCRIBER (used by the WS gateway) — ioredis requires a connection in
 * subscriber mode to be separate from one issuing normal commands.
 *
 * Reads the connection string from `process.env.REDIS_URL` ONLY (never a literal).
 * When it is absent the whole realtime layer NO-OPs: the server still boots and
 * domain events still persist to the outbox (replayable later). Use a `rediss://`
 * URL for TLS providers such as Upstash.
 */

import { Redis } from 'ioredis';

let publisher: Redis | null = null;
let subscriber: Redis | null = null;
let enabled = false;

export function isRealtimeEnabled(): boolean {
    return enabled;
}

/** Channel a given org's business events are published on. */
export function orgChannel(organizationId: string): string {
    return `org:${organizationId}:events`;
}

/** Initialize the publisher + subscriber. Safe no-op when REDIS_URL is unset. */
export function initRealtimeRedis(): void {
    const url = process.env.REDIS_URL?.trim();
    if (!url) {
        console.warn(
            '[realtime] REDIS_URL not set — realtime disabled. Events still persist to the outbox.',
        );
        enabled = false;
        return;
    }

    // maxRetriesPerRequest:null keeps pub/sub connections resilient to blips.
    const opts = { maxRetriesPerRequest: null as null, lazyConnect: false };
    publisher = new Redis(url, opts);
    subscriber = new Redis(url, opts);

    for (const [name, conn] of [
        ['publisher', publisher],
        ['subscriber', subscriber],
    ] as const) {
        conn.on('error', (err: Error) =>
            console.warn(`[realtime] redis ${name} error:`, err?.message || err),
        );
        conn.on('connect', () => console.log(`[realtime] redis ${name} connected`));
    }

    enabled = true;
    console.log('[realtime] redis initialized (publisher + subscriber)');
}

export function getPublisher(): Redis | null {
    return publisher;
}

export function getSubscriber(): Redis | null {
    return subscriber;
}

export async function closeRealtimeRedis(): Promise<void> {
    await Promise.allSettled([publisher?.quit(), subscriber?.quit()]);
    publisher = null;
    subscriber = null;
    enabled = false;
}
