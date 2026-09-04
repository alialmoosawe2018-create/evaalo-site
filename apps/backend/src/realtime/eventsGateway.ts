/**
 * Business-events WS gateway (Phase 3) — the `/ws/events` endpoint.
 *
 * Unlike the media sockets, this path AUTHENTICATES at handshake: it verifies a
 * Clerk session token (query `?token=`) and derives the organizationId from the
 * claims. Each socket is subscribed ONLY to its own `org:{orgId}:events` Redis
 * channel — that is the tenant fan-out boundary.
 *
 * Durable at-least-once: the client passes its last-acked `seq` (query `?since=`
 * on connect, or a `{type:'replay',since}` message). The gateway replays
 * `seq > since` from the outbox, then resumes the live Redis stream. Live and
 * replayed events can overlap; the client dedupes by `seq`/`outboxId`.
 */

import type { IncomingMessage } from 'node:http';
import { WebSocket } from 'ws';
import { verifyToken } from '@clerk/express';
import DomainEventOutbox from '../models/DomainEventOutbox.js';
import { getSubscriber, isRealtimeEnabled, orgChannel } from './redisClient.js';

type SocketCtx = {
    ws: WebSocket;
    organizationId: string;
    userId: string;
    lastAckedSeq: number;
};

/** channel → sockets currently subscribed to it (for demux + ref-counted (un)subscribe). */
const channelSockets = new Map<string, Set<SocketCtx>>();
let subscriberWired = false;

/** Wire the shared subscriber's message handler once (demux to local sockets). */
function wireSubscriberOnce(): void {
    if (subscriberWired) return;
    const sub = getSubscriber();
    if (!sub) return;
    sub.on('message', (channel: string, message: string) => {
        const set = channelSockets.get(channel);
        if (!set) return;
        for (const ctx of set) sendRaw(ctx, message);
    });
    subscriberWired = true;
}

function sendRaw(ctx: SocketCtx, message: string): void {
    if (ctx.ws.readyState === WebSocket.OPEN) ctx.ws.send(message);
}

async function subscribeOrg(ctx: SocketCtx): Promise<void> {
    const ch = orgChannel(ctx.organizationId);
    let set = channelSockets.get(ch);
    if (!set) {
        set = new Set();
        channelSockets.set(ch, set);
        const sub = getSubscriber();
        if (sub) await sub.subscribe(ch);
    }
    set.add(ctx);
}

async function unsubscribeOrg(ctx: SocketCtx): Promise<void> {
    const ch = orgChannel(ctx.organizationId);
    const set = channelSockets.get(ch);
    if (!set) return;
    set.delete(ctx);
    if (set.size === 0) {
        channelSockets.delete(ch);
        const sub = getSubscriber();
        if (sub) await sub.unsubscribe(ch);
    }
}

/** Verify a Clerk session token off the raw upgrade request (no Express req available). */
async function verifyWsToken(
    token: string,
): Promise<{ organizationId: string; userId: string } | null> {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey || !token) return null;
    try {
        const claims = (await verifyToken(token, { secretKey })) as Record<string, unknown> & {
            sub?: string;
            o?: { id?: string };
            org_id?: string;
            orgId?: string;
        };
        const userId = String(claims.sub || '');
        const organizationId = String(claims.org_id || claims.orgId || claims.o?.id || '');
        if (!userId || !organizationId) {
            // A valid token with no active organization: the socket is org-scoped, so
            // it cannot be served. Worth distinguishing from a bad token below.
            console.warn(
                `[realtime] ws token rejected: ${userId ? 'no organization claim' : 'no subject'}`,
            );
            return null;
        }
        return { organizationId, userId };
    } catch (err) {
        // This used to swallow the reason and close 4401 silently, which made a
        // browser-side "WebSocket connection failed" impossible to diagnose from the
        // server: expired, wrong instance, malformed and clock-skew all looked the
        // same. Log the reason only — never the token, which is a live credential.
        console.warn('[realtime] ws token rejected:', (err as Error)?.message || String(err));
        return null;
    }
}

/** Replay outbox events with seq strictly greater than the client's cursor. */
async function replaySince(ctx: SocketCtx, sinceSeq: number): Promise<void> {
    const rows = await DomainEventOutbox.find({
        organizationId: ctx.organizationId,
        seq: { $gt: sinceSeq },
    })
        .sort({ seq: 1 })
        .limit(500)
        .lean();

    for (const r of rows) {
        sendRaw(
            ctx,
            JSON.stringify({
                outboxId: String(r._id),
                organizationId: r.organizationId,
                type: r.type,
                schemaVersion: r.schemaVersion ?? 1,
                seq: r.seq,
                payload: r.payload || {},
                occurredAt: r.occurredAt,
                replay: true,
            }),
        );
        if (r.seq > ctx.lastAckedSeq) ctx.lastAckedSeq = r.seq;
    }
}

/** Entry point wired into the single WSS `connection` handler for `/ws/events`. */
export async function handleEventsWsConnection(
    ws: WebSocket,
    req: IncomingMessage,
): Promise<void> {
    if (!isRealtimeEnabled()) {
        ws.close(1013, 'realtime_unavailable');
        return;
    }

    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token') || '';
    const sinceRaw = url.searchParams.get('since');
    const since = sinceRaw != null && sinceRaw !== '' ? Number(sinceRaw) : NaN;

    const auth = await verifyWsToken(token);
    if (!auth) {
        ws.close(4401, 'unauthorized');
        return;
    }

    wireSubscriberOnce();
    const ctx: SocketCtx = {
        ws,
        organizationId: auth.organizationId,
        userId: auth.userId,
        lastAckedSeq: Number.isFinite(since) ? since : -1,
    };
    await subscribeOrg(ctx);

    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ready', organizationId: auth.organizationId }));
    }

    // Replay any events missed while disconnected, before the live stream.
    if (Number.isFinite(since) && since >= 0) {
        await replaySince(ctx, since).catch((err) =>
            console.warn('[realtime] replay failed:', (err as Error)?.message || err),
        );
    }

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(String(data)) as { type?: string; seq?: number; since?: number };
            if (msg.type === 'ack' && typeof msg.seq === 'number') {
                if (msg.seq > ctx.lastAckedSeq) ctx.lastAckedSeq = msg.seq;
            } else if (msg.type === 'replay' && typeof msg.since === 'number') {
                void replaySince(ctx, msg.since);
            }
        } catch {
            /* ignore malformed client message */
        }
    });

    ws.on('close', () => {
        void unsubscribeOrg(ctx);
    });
    ws.on('error', () => {
        void unsubscribeOrg(ctx);
    });
}
