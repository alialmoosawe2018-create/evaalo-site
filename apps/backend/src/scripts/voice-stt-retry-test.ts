/**
 * Regression for the outage of 2026-09-08 13:23:45 → 13:25:16.
 *
 * DNS stopped resolving two Speechmatics hosts — `mp.speechmatics.com` (the JWT
 * endpoint, failing inside createSpeechmaticsJWT) and `eu2.rt.speechmatics.com`
 * (the realtime stream). Eleven `getaddrinfo ENOTFOUND` in ninety seconds.
 *
 * Without a token there is no speech recognition at all: the candidate speaks
 * and nothing is heard. One failed attempt ended the STT path with no retry, and
 * the only thing the candidate was told was the raw `err.message` — the string
 * "fetch failed". So عقيل راضي opened the interview SEVEN times in four minutes
 * (4de95de8, 49e74ee1, e1cb0e3d, a8c7967a, ffeca5e3, 7fdf4e5d, d857ef9b), every
 * one scored "insufficient evidence", and never learned the fault was not his.
 *
 * Run: npm run test:voice-stt-retry
 */
import { isTransientSttError } from '../services/sttRouterService.js';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
    if (actual === expected) {
        console.log(`ok   ${name}`);
    } else {
        failures += 1;
        console.error(`FAIL ${name}: expected ${String(expected)}, got ${String(actual)}`);
    }
}

// ── the exact error from the outage ──────────────────────────────────────────
//
// Node wraps it: a TypeError "fetch failed" whose `cause` carries the real code.
// Classifying only on `message` would miss it, which is why `cause` is read too.
const realOutageError = Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('getaddrinfo ENOTFOUND mp.speechmatics.com'), {
        code: 'ENOTFOUND',
    }),
});
check('the real outage error is transient', isTransientSttError(realOutageError), true);

const realtimeHostError = Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('getaddrinfo ENOTFOUND eu2.rt.speechmatics.com'), {
        code: 'ENOTFOUND',
    }),
});
check('the realtime-host failure too', isTransientSttError(realtimeHostError), true);

console.log('\n— other network faults worth retrying —');
for (const [label, err] of [
    ['ECONNRESET', Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })],
    ['ETIMEDOUT', Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' })],
    ['EAI_AGAIN (dns temp fail)', Object.assign(new Error('getaddrinfo EAI_AGAIN'), { code: 'EAI_AGAIN' })],
    ['ECONNREFUSED', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })],
    ['bare fetch failed', new TypeError('fetch failed')],
    ['upstream 503', new Error('Request failed with status 503')],
] as const) {
    check(`transient: ${label}`, isTransientSttError(err), true);
}

// ⚠️ Retrying a misconfiguration only lengthens the candidate's silence for no
// possible gain — the key will not become valid on the third attempt.
console.log('\n— configuration faults must NOT be retried —');
for (const [label, err] of [
    ['missing key', new Error('Speechmatics API key is not configured')],
    ['bad key', new Error('Unauthorized: invalid API key')],
    ['401', new Error('Request failed with status 401')],
    ['403', new Error('403 Forbidden')],
] as const) {
    check(`not transient: ${label}`, isTransientSttError(err), false);
}

// ── ⚠️ DELIBERATE INVERSION 2026-09-09 — do NOT "restore" this ───────────────
//
// This assertion used to read `false`: anything unrecognised was treated as a
// configuration fault. That put every unknown error on the harshest branch —
// the candidate told to "contact the employer", and the Deepgram failover
// skipped. It fired on a real session (b307fb8f) for an error whose whole text
// was "Error".
//
// The costs are not symmetric. Treating a permanent fault as transient costs
// ~6s of retry plus one failover attempt, both safe and bounded. Treating a
// transient fault as permanent ends a person's interview. So the unknown case
// belongs on the recoverable path, and only a RECOGNISED configuration fault
// hard-fails (asserted above).
console.log('\n— unknown errors take the recoverable path —');
check('an unrelated error IS retried now', isTransientSttError(new Error('something odd happened')), true);
check('a bare "Error" with no detail is retried', isTransientSttError(new Error('Error')), true);
check('undefined is not an error at all', isTransientSttError(undefined), false);
check('null is not an error at all', isTransientSttError(null), false);

// A misconfiguration whose text happens to mention the network must still be
// treated as configuration: the key check is evaluated first, deliberately.
check(
    'an auth failure mentioning the network stays non-transient',
    isTransientSttError(new Error('network error: unauthorized invalid api key')),
    false
);

// ── the failover decision ────────────────────────────────────────────────────
//
// Retrying absorbs a short blip; عقيل's outage lasted ninety seconds, longer
// than any sane backoff. The real answer is the second provider — Deepgram is
// already in this file and is NEVER reached, because the Speechmatics branch
// returns unconditionally while its key is present.
//
// Failover fires on transient faults only. A bad Speechmatics key is a
// configuration fault that must stay visible; papering over it with another
// provider would hide it indefinitely.
console.log('\n— which failures should fail over to the second provider —');
const shouldFailOver = (err: unknown) => isTransientSttError(err);
check('DNS outage → fail over', shouldFailOver(realOutageError), true);
check('connection reset → fail over', shouldFailOver(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })), true);
check('bad key → do NOT fail over (stays visible)', shouldFailOver(new Error('Unauthorized: invalid API key')), false);
check('missing key → do NOT fail over', shouldFailOver(new Error('Speechmatics API key is not configured')), false);

if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
}
console.log('\nvoice-stt-retry-test: OK');
