#!/usr/bin/env node
/**
 * Is an interview running on the site right now?
 *
 * The owner's rule since launch (2026-09-23): nothing is deployed while an
 * interview is live — not the backend, not the frontend (every push to `master`
 * rebuilds Cloudflare Pages), not the video agent. This asks production.
 *
 *   exit 0 — nobody is being interviewed (or production cannot be reached: an
 *            API that does not answer is interviewing nobody — a warning is printed)
 *   exit 1 — at least one interview is live; do not deploy
 *
 * Used by the `pre-push` hook (scripts/git-hooks/pre-push) and by
 * `npm run deploy:backend`. Run it by hand before `lk agent deploy`.
 *
 * ⚠️ The count lives at /api/health. The bare /health only answers "OK".
 */
const URL_ = process.env.EVAALO_HEALTH_URL || 'https://api.evaalo.com/api/health';

async function main() {
    let body;
    try {
        const res = await fetch(URL_, { signal: AbortSignal.timeout(8000) });
        body = await res.json();
    } catch (err) {
        console.warn(`⚠️  could not read ${URL_} (${err?.message || err}) — treating the site as idle.`);
        return 0;
    }
    // `activeInterviews` = voice live + voice parked + video live. A backend from
    // before that field existed reports voice only.
    const total = Number.isFinite(body?.activeInterviews)
        ? body.activeInterviews
        : Number.isFinite(body?.activeVoiceInterviews)
          ? body.activeVoiceInterviews
          : null;
    if (total === null) {
        console.warn(`⚠️  ${URL_} carried no interview count — treating the site as idle.`);
        return 0;
    }
    if (total > 0) {
        const parts = [
            `voice ${body.activeVoiceInterviews ?? '?'}`,
            `parked voice ${body.parkedVoiceInterviews ?? '?'}`,
            `video ${body.activeVideoInterviews ?? '?'}`,
        ].join(', ');
        console.error(`⛔ ${total} interview(s) live on the site right now (${parts}).`);
        console.error('   The owner\'s rule: no deploy while an interview is running. Wait for it to finish, then retry.');
        return 1;
    }
    console.log('✓ no interview is live on the site');
    return 0;
}

// Not process.exit(): on Windows, exiting while fetch's socket is still closing
// aborts Node (`UV_HANDLE_CLOSING`, exit 127) — which the pre-push hook would
// read as "interview live" and refuse every push. Let the loop drain instead.
process.exitCode = await main();
