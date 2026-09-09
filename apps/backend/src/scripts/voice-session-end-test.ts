/**
 * Regression for the End button that consumed a link nobody meant to give up.
 *
 * 2026-09-09, session 4e0aca31 (candidate 6aa055ea, execution 1771):
 *
 *   10:50:46.437  End pressed → ws.close() with no code
 *   10:50:46.446  voiceInterviewLinkConsumedAt stamped — nine milliseconds later
 *   10:51:22      scored 41 / Reject, on four answers, phase 1
 *   10:50:54      he reopened and was refused with 4001
 *
 * The eight seconds between the lock and the retry are the evidence he did not
 * intend to finish. Over the preserved logs (2026-09-08→09) there were fifteen
 * session starts and exactly ONE `[SESSION CLOSE]` — نور الهدى's 96608883 — so
 * fourteen sessions were being treated as completed interviews while the server
 * had never ended any of them.
 *
 * Run: npm run test:voice-session-end
 */
import {
    completesInterview,
    endedBeforeEnglishPhase,
    type VoiceSessionEndCause,
} from '../evaalo-only-voice/voiceSessionEnd.js';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
    if (actual === expected) {
        console.log(`ok   ${name}`);
    } else {
        failures += 1;
        console.error(`FAIL ${name}: expected ${String(expected)}, got ${String(actual)}`);
    }
}

// ── which endings may lock the link ─────────────────────────────────────────
//
// ⚠️ The costs are not symmetric. Leaving a link open for someone who really
// did finish costs one extra attempt. Locking it on someone who was cut off
// costs them the interview entirely, with no way back — which is exactly what
// happened to 4e0aca31 and, before him, to عقيل راضي.
console.log('— only a server-ended interview may consume the link —');
check('a natural conclusion locks', completesInterview('interview_complete'), true);
check('the hard time cap locks', completesInterview('max_duration'), true);

console.log('\n— everything else leaves the link usable —');
for (const cause of [
    'client',            // the End button, a closed tab, a dropped network — indistinguishable
    'idle_timeout',      // long silence. May simply be a microphone that died.
    'credits_exhausted', // we cut the session, not the candidate
    'server_refused',    // billing denied / capacity / oversized frame
    'link_consumed',     // already locked; must never re-stamp
] as VoiceSessionEndCause[]) {
    check(`does NOT lock: ${cause}`, completesInterview(cause), false);
}

// ── which endings must be reported as incomplete rather than as a number ────
//
// `phase < 3` zeroes the English prior upstream, so such a run forfeits 15 of
// 100 points by construction: all-Intermediate is 34, all-Good about 60, and
// Hire is unreachable. That number is not comparable with a finished interview.
console.log('\n— reporting: incomplete vs a score —');
check(
    'the real case: client closed in phase 1',
    endedBeforeEnglishPhase({ completedByServer: false, phaseReached: 1 }),
    true
);
check(
    'client closed in phase 2 as well',
    endedBeforeEnglishPhase({ completedByServer: false, phaseReached: 2 }),
    true
);
// Reaching the English phase and then closing is a different thing: the
// candidate gave what the interview asked for.
check(
    'client closed in phase 3 still scores',
    endedBeforeEnglishPhase({ completedByServer: false, phaseReached: 3 }),
    false
);
check(
    'the server ended it in phase 1 — a short but complete interview',
    endedBeforeEnglishPhase({ completedByServer: true, phaseReached: 1 }),
    false
);
check(
    'the server ended it at the time cap',
    endedBeforeEnglishPhase({ completedByServer: true, phaseReached: 2 }),
    false
);

// An unknown phase must not silently flip a candidate to "incomplete": absent
// evidence is not evidence. Fall through to the existing coverage gate instead.
console.log('\n— an unknown phase changes nothing —');
for (const phase of [null, undefined, NaN] as unknown as Array<number | null>) {
    check(
        `phase ${String(phase)} → score as before`,
        endedBeforeEnglishPhase({ completedByServer: false, phaseReached: phase }),
        false
    );
}

// ── the two rules are independent, and both must hold for 4e0aca31 ──────────
console.log('\n— session 4e0aca31, end to end —');
const cause: VoiceSessionEndCause = 'client';
const completedByServer = completesInterview(cause);
check('the link stays usable, so he can come back', completedByServer, false);
check(
    'and his report says incomplete, not 41 / Reject',
    endedBeforeEnglishPhase({ completedByServer, phaseReached: 1 }),
    true
);

// نور الهدى (96608883) is the one session the server ended: she must be
// unaffected by both changes.
console.log('\n— session 96608883, the one the server ended —');
const herCause: VoiceSessionEndCause = 'interview_complete';
check('her link is consumed as before', completesInterview(herCause), true);
check(
    'and she keeps her score',
    endedBeforeEnglishPhase({ completedByServer: true, phaseReached: 3 }),
    false
);

if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
}
console.log('\nvoice-session-end-test: OK');
