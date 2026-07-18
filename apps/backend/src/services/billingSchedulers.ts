/**
 * Background billing jobs (single-process schedulers).
 *
 *   - Video stale-lock sweep: force-ends + settles abandoned video sessions whose
 *     lock expired (browser closed / crash), releasing reserved credits.
 *   - Compare-email timeout sweep: refunds compare-report charges stuck past their
 *     deadline (n8n never called back), independent of the user's browser.
 *   - Reservation expiry sweep: marks stale usage reservations expired (they stop
 *     counting toward headroom via expiresAt anyway; this cleans the rows).
 *
 * Guards against overlapping runs and never throws into the event loop.
 */

import { sweepStaleVideoLocks } from './videoBillingService.js';
import { sweepStaleCompareEmails } from './compareEmailBilling.js';
import { expireStaleReservations } from './usageReservationService.js';
import { sweepStalledVideoEvaluations } from './videoEvaluationHealthService.js';

const VIDEO_SWEEP_INTERVAL_MS = 60 * 1000; // 1 min
const COMPARE_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const RESERVATION_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const VIDEO_EVAL_HEALTH_INTERVAL_MS = 5 * 60 * 1000; // 5 min

let started = false;

function runGuarded(name: string, fn: () => Promise<void>): () => void {
    let running = false;
    return () => {
        if (running) return;
        running = true;
        void fn()
            .catch((e) => console.warn(`⚠️ [scheduler:${name}] ${e?.message || e}`))
            .finally(() => {
                running = false;
            });
    };
}

export function startBillingSchedulers(): void {
    if (started) return;
    started = true;

    const videoTick = runGuarded('video-sweep', sweepStaleVideoLocks);
    const compareTick = runGuarded('compare-sweep', sweepStaleCompareEmails);
    const reservationTick = runGuarded('reservation-sweep', async () => {
        await expireStaleReservations();
    });
    const videoEvalHealthTick = runGuarded('video-eval-health', sweepStalledVideoEvaluations);

    const videoTimer = setInterval(videoTick, VIDEO_SWEEP_INTERVAL_MS);
    const compareTimer = setInterval(compareTick, COMPARE_SWEEP_INTERVAL_MS);
    const reservationTimer = setInterval(reservationTick, RESERVATION_SWEEP_INTERVAL_MS);
    const videoEvalHealthTimer = setInterval(videoEvalHealthTick, VIDEO_EVAL_HEALTH_INTERVAL_MS);

    // Don't keep the process alive solely for these timers.
    videoTimer.unref?.();
    compareTimer.unref?.();
    reservationTimer.unref?.();
    videoEvalHealthTimer.unref?.();

    console.log(
        `🩺 Billing schedulers started (video sweep ${VIDEO_SWEEP_INTERVAL_MS / 1000}s, compare sweep ${COMPARE_SWEEP_INTERVAL_MS / 1000}s, reservation sweep ${RESERVATION_SWEEP_INTERVAL_MS / 1000}s, video-eval health ${VIDEO_EVAL_HEALTH_INTERVAL_MS / 1000}s)`,
    );
}
