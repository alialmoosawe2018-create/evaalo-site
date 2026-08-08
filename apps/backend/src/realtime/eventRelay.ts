/**
 * Event relay (Phase 3) — the transport half of the domain-event bus.
 *
 * Subscribes to the in-process domain-event stream (driven by the outbox sweep +
 * dispatch) and forwards each event to its org's Redis channel. The WS gateway
 * fans it out to that org's browsers.
 *
 * Delivery model: this live publish is best-effort. Durability is the outbox —
 * a dropped publish is recovered when the client reconnects and the gateway
 * replays `seq > lastAckedSeq` from `domain_event_outbox`. Money never depends
 * on this path.
 */

import { onDomainEvent } from '../services/domainEventService.js';
import { getPublisher, isRealtimeEnabled, orgChannel } from './redisClient.js';

let started = false;

export function startEventRelay(): void {
    if (started) return;
    if (!isRealtimeEnabled()) {
        console.warn('[realtime] event relay not started (realtime disabled).');
        return;
    }

    onDomainEvent((evt) => {
        const pub = getPublisher();
        if (!pub) return;
        // Fire-and-forget: a failed publish leaves the event replayable via the outbox.
        void pub
            .publish(orgChannel(evt.organizationId), JSON.stringify(evt))
            .catch((err: Error) =>
                console.warn('[realtime] publish failed (event stays replayable):', err?.message || err),
            );
    });

    started = true;
    console.log('[realtime] event relay started → Redis pub/sub');
}
