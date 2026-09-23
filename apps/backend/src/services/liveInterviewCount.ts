/**
 * How many interviews are live on the site right now.
 *
 * The owner's rule since launch (2026-09-23): nothing is deployed while an
 * interview is running. The VPS deployer (`ops/deploy.sh`) reads this number
 * from `/api/health` and postpones the container swap for as long as it is
 * above zero; the local `scripts/check-live-interviews.mjs` reads the same
 * number before a push to `master` (the frontend) or an agent deploy.
 *
 * What counts, and why each one does:
 *   - voice, live — an open voice WebSocket; the swap SIGKILLs it mid-sentence.
 *   - voice, PARKED — a candidate who dropped out inside the 10-minute resume
 *     window. The parked session lives only in this process's memory, so a swap
 *     erases it and the returning candidate is told the link was already used.
 *   - video, live — a session still `active` whose page beat in the last 90 s.
 *     The page beats every 20 s; a tab abandoned without `/end` stays `active`
 *     in the database, and the time window is what stops it counting forever.
 *
 * `/health` is the container's liveness probe and must never wait on Mongo, so
 * the video count is refreshed in the background and read from a cache.
 */
import mongoose from 'mongoose';
import VideoInterviewSession from '../models/VideoInterviewSession.js';
import { countLiveSessions } from '../evaalo-only-voice/sessionStore.js';
import { parkedSessionCount } from '../evaalo-only-voice/voiceSessionResume.js';

export const VIDEO_LIVE_WINDOW_MS = 90_000;
const REFRESH_MS = 15_000;
/** A cached count older than this is not reported — "unknown" beats "stale". */
const MAX_VIDEO_COUNT_AGE_MS = 3 * REFRESH_MS;

/** Video sessions on a live call right now. */
export async function countLiveVideoInterviews(now = Date.now()): Promise<number> {
    const cutoff = new Date(now - VIDEO_LIVE_WINDOW_MS);
    return VideoInterviewSession.countDocuments({
        status: 'active',
        $or: [
            { lastActivityAt: { $gte: cutoff } },
            // started, and has not reached its first heartbeat yet
            { lastActivityAt: null, startedAt: { $gte: cutoff } },
        ],
    })
        // Site-wide ON PURPOSE: the deploy rule is about the whole site, and only
        // a number leaves this function — no tenant's data is read.
        .setOptions({ skipTenantGuard: true })
        .maxTimeMS(2000);
}

let videoCount: number | null = null;
let videoCountAt = 0;
let refreshing = false;
let timer: NodeJS.Timeout | undefined;

async function refreshVideoCount(): Promise<void> {
    if (refreshing || mongoose.connection.readyState !== 1) return;
    refreshing = true;
    try {
        videoCount = await countLiveVideoInterviews();
        videoCountAt = Date.now();
    } catch {
        /* keep the last value; its age decides whether it is still reported */
    } finally {
        refreshing = false;
    }
}

/** Idempotent. Started by the first `/health` call, so nothing runs at import. */
export function startLiveInterviewCounter(): void {
    if (timer) return;
    void refreshVideoCount();
    timer = setInterval(() => void refreshVideoCount(), REFRESH_MS);
    timer.unref?.();
}

export type LiveInterviewSnapshot = {
    activeVoiceInterviews: number;
    parkedVoiceInterviews: number;
    /** null = not known yet (no fresh count) — it does not add to the total. */
    activeVideoInterviews: number | null;
    /** What the deployer gates on. */
    activeInterviews: number;
};

export function liveInterviewSnapshot(now = Date.now()): LiveInterviewSnapshot {
    let voice = 0;
    let parked = 0;
    try {
        voice = countLiveSessions();
    } catch {
        /* a counter must never fail the health check */
    }
    try {
        parked = parkedSessionCount();
    } catch {
        /* same */
    }
    const video = videoCount !== null && now - videoCountAt <= MAX_VIDEO_COUNT_AGE_MS ? videoCount : null;
    return {
        activeVoiceInterviews: voice,
        parkedVoiceInterviews: parked,
        activeVideoInterviews: video,
        activeInterviews: voice + parked + (video ?? 0),
    };
}

/** For tests: forget the cached count and stop the timer. */
export function resetLiveInterviewCounterForTests(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
    videoCount = null;
    videoCountAt = 0;
    refreshing = false;
}

/** For tests: run one refresh now and wait for it. */
export async function refreshLiveInterviewCountNow(): Promise<void> {
    await refreshVideoCount();
}
