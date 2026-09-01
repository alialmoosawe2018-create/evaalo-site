/**
 * Video-interview agent keep-warm heartbeat.
 *
 * LiveKit Cloud spins the interview worker container down when idle, so the FIRST
 * interview after a quiet stretch (or right after an agent redeploy) pays a ~20s
 * cold-start: LiveKit boots a fresh worker (container schedule + plugin preload)
 * before it can accept the dispatch. Measured live: a /prepare dispatch at T+0 was
 * only picked up at T+22s because no warm worker was registered. The candidate
 * clicks Start and waits on a blank/late avatar.
 *
 * The frontend already prewarms at /prepare, but that only helps if a worker is
 * warm to receive the dispatch. This heartbeat keeps one warm: it periodically
 * dispatches a throwaway "warmup" room. The agent recognizes it (metadata
 * warmup="1" / room name contains "warmup") and returns immediately — no Beyond
 * Presence avatar, no ElevenLabs, no OpenAI — so the ping is ~free. The room is
 * torn down right after.
 *
 * Overlap-guarded; never throws into the event loop. Disable with
 * AGENT_KEEP_WARM=false; tune cadence with AGENT_KEEP_WARM_INTERVAL_MS (min 60s).
 */

import { createLiveKitRoom, dispatchAgentToRoom, deleteLiveKitRoom } from './livekitService.js';

const DEFAULT_INTERVAL_MS = 4 * 60 * 1000; // 4 min — under LiveKit's idle-scaledown window
const MIN_INTERVAL_MS = 60 * 1000;
const KICKOFF_DELAY_MS = 15 * 1000; // warm a post-deploy container before the first candidate
const TEARDOWN_DELAY_MS = 6 * 1000; // give the worker time to accept + register the ping job

let started = false;
let running = false;

function isEnabled(): boolean {
    if (String(process.env.AGENT_KEEP_WARM || '').trim().toLowerCase() === 'false') return false;
    return !!(
        process.env.LIVEKIT_URL &&
        process.env.LIVEKIT_API_KEY &&
        process.env.LIVEKIT_API_SECRET
    );
}

function intervalMs(): number {
    const raw = Number(process.env.AGENT_KEEP_WARM_INTERVAL_MS);
    return Number.isFinite(raw) && raw >= MIN_INTERVAL_MS ? raw : DEFAULT_INTERVAL_MS;
}

async function pingOnce(): Promise<void> {
    const sessionId = `warmup-keepalive-${Date.now()}`;
    let roomName: string | null = null;
    try {
        // createLiveKitRoom prefixes with "room-" → "room-warmup-keepalive-<ts>".
        roomName = await createLiveKitRoom(sessionId);
        await dispatchAgentToRoom(roomName, { warmup: '1', session_id: sessionId });
    } finally {
        if (roomName) {
            const rn = roomName;
            const t = setTimeout(() => {
                void deleteLiveKitRoom(rn).catch(() => undefined);
            }, TEARDOWN_DELAY_MS);
            t.unref?.();
        }
    }
}

export function startAgentKeepWarm(): void {
    if (started) return;
    if (!isEnabled()) {
        console.log('🔥 Agent keep-warm disabled (AGENT_KEEP_WARM=false or LiveKit creds missing)');
        return;
    }
    started = true;

    const tick = () => {
        if (running) return;
        running = true;
        void pingOnce()
            .catch((e) => console.warn(`⚠️ [keep-warm] ${e?.message || e}`))
            .finally(() => {
                running = false;
            });
    };

    const ms = intervalMs();
    const timer = setInterval(tick, ms);
    timer.unref?.();

    const kickoff = setTimeout(tick, KICKOFF_DELAY_MS);
    kickoff.unref?.();

    console.log(`🔥 Agent keep-warm started (every ${Math.round(ms / 1000)}s)`);
}
