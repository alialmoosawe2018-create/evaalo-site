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

console.log('\n— and it must not guess —');
check('an unrelated error is not retried', isTransientSttError(new Error('something odd happened')), false);
check('undefined is not retried', isTransientSttError(undefined), false);
check('null is not retried', isTransientSttError(null), false);

// A misconfiguration whose text happens to mention the network must still be
// treated as configuration: the key check is evaluated first, deliberately.
check(
    'an auth failure mentioning the network stays non-transient',
    isTransientSttError(new Error('network error: unauthorized invalid api key')),
    false
);

if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
}
console.log('\nvoice-stt-retry-test: OK');
