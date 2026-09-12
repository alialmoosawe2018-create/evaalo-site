/**
 * نافذة الرجوع بعد إغلاقٍ من المرشّح — خيار (ج).
 *
 * الخلفية: منذ 0ae9eb8 لا يُقفل الرابط إلّا إذا أنهى الخادمُ المقابلة، فبقي
 * مفتوحاً بعد إغلاق المرشّح، وإعادةُ الفتح تُجري مقابلةً ثانية من الصفر يستبدل
 * تقييمُها الأوّل عبر mergeEval. الحلّ: قفلٌ عند أيّ إغلاق بعد دليلٍ كافٍ، مع
 * نافذةٍ يُستأنف فيها **الشيء نفسه** — لا جلسة جديدة.
 *
 * ثلاثة أشياء تُثبَّت هنا:
 *   ١. السجلّ في الذاكرة: ركنٌ، مطالبةٌ واحدة تنجح، موعدٌ ثابت لا يُمدَّد، وانتهاءٌ
 *      يستدعي التنظيف مرّةً واحدة.
 *   ٢. مسند الخادم `isVoiceLinkResumable`: مقفلٌ + نافذةٌ في المستقبل ⇒ يجوز.
 *   ٣. مفتاح الركن: الطلب أوّلاً، ثمّ المرشّح والحملة، ولا مفتاح بلا مرشّح.
 *
 * Run: npm run test:voice-session-resume
 */
import {
    claimParkedSession,
    dropParkedSession,
    parkSession,
    parkedSessionCount,
    peekParkedSession,
    resumeGraceMs,
    resumeKey,
} from '../evaalo-only-voice/voiceSessionResume.js';
import { isVoiceLinkResumable } from '../services/interviewLinkAccess.js';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
    if (actual === expected) {
        console.log(`ok   ${name}`);
    } else {
        failures += 1;
        console.error(`FAIL ${name}: expected ${String(expected)}, got ${String(actual)}`);
    }
}

const T0 = 1_000_000;
const GRACE = 10_000;

// ── 1. the registry ──────────────────────────────────────────────────────────
let expired: string[] = [];
const onExpire = (sid: string) => expired.push(sid);

const first = parkSession({ key: 'app:A', sessionId: 's1', candidateId: 'c1', onExpire, now: T0, graceMs: GRACE });
check('parking records the fixed deadline', first.expiresAt, T0 + GRACE);
check('and it is visible', peekParkedSession('app:A')?.sessionId, 's1');

// A second park of the same key inside the window (disconnect, return, disconnect)
// keeps the ORIGINAL deadline — otherwise the window could be chained forever.
const again = parkSession({ key: 'app:A', sessionId: 's1', candidateId: 'c1', onExpire, now: T0 + 4_000, graceMs: GRACE });
check('re-parking does not extend the deadline', again.expiresAt, T0 + GRACE);
check('and keeps the original parkedAt', again.parkedAt, T0);

// Claiming inside the window returns the session and removes it — exactly once.
const claimed = claimParkedSession('app:A', T0 + 5_000);
check('a claim inside the window returns the parked session', claimed?.sessionId, 's1');
check('and a second claim finds nothing', claimParkedSession('app:A', T0 + 5_000), null);
check('the registry is empty after the claim', parkedSessionCount(), 0);

// Claiming after the deadline returns null (and clears the entry).
parkSession({ key: 'app:B', sessionId: 's2', candidateId: 'c2', onExpire, now: T0, graceMs: GRACE });
check('a claim after the deadline returns null', claimParkedSession('app:B', T0 + GRACE + 1), null);
check('and the stale entry is gone', peekParkedSession('app:B'), undefined);

// Explicit drop never fires onExpire.
parkSession({ key: 'app:C', sessionId: 's3', candidateId: 'c3', onExpire, now: T0, graceMs: GRACE });
check('drop removes the entry', dropParkedSession('app:C'), true);
check('dropping twice is a no-op', dropParkedSession('app:C'), false);

// The real timer path: a tiny grace, then expiry calls onExpire once with the id.
expired = [];
parkSession({ key: 'app:D', sessionId: 's4', candidateId: 'c4', onExpire, graceMs: 30 });
await new Promise((r) => setTimeout(r, 80));
check('expiry fires onExpire exactly once', expired.length, 1);
check('with the parked session id', expired[0], 's4');
check('and the entry is gone afterwards', peekParkedSession('app:D'), undefined);

// A claim that races the timer wins: the timer must not fire for a claimed session.
expired = [];
parkSession({ key: 'app:E', sessionId: 's5', candidateId: 'c5', onExpire, graceMs: 30 });
check('claim before expiry succeeds', claimParkedSession('app:E')?.sessionId, 's5');
await new Promise((r) => setTimeout(r, 80));
check('and the cancelled timer never fires', expired.length, 0);

// ── 2. the default window ────────────────────────────────────────────────────
const saved = process.env.VOICE_RESUME_GRACE_SECONDS;
delete process.env.VOICE_RESUME_GRACE_SECONDS;
check('default grace is ten minutes', resumeGraceMs(), 600_000);
process.env.VOICE_RESUME_GRACE_SECONDS = '120';
check('the env knob is honoured', resumeGraceMs(), 120_000);
process.env.VOICE_RESUME_GRACE_SECONDS = 'nonsense';
check('garbage falls back to the default', resumeGraceMs(), 600_000);
if (saved === undefined) delete process.env.VOICE_RESUME_GRACE_SECONDS;
else process.env.VOICE_RESUME_GRACE_SECONDS = saved;

// ── 3. the server-side predicate ─────────────────────────────────────────────
const now = Date.now();
check('an open link is not "resumable" — it is simply open', isVoiceLinkResumable({ voiceInterviewLinkConsumedAt: null }, now), false);
check(
    'locked with a window in the future: resumable',
    isVoiceLinkResumable({ voiceInterviewLinkConsumedAt: new Date(now - 1000), voiceInterviewResumableUntil: new Date(now + 60_000) }, now),
    true
);
check(
    'locked with the window in the past: not resumable',
    isVoiceLinkResumable({ voiceInterviewLinkConsumedAt: new Date(now - 1000), voiceInterviewResumableUntil: new Date(now - 1) }, now),
    false
);
check(
    'locked by the server (no window at all): not resumable',
    isVoiceLinkResumable({ voiceInterviewLinkConsumedAt: new Date(now - 1000), voiceInterviewResumableUntil: null }, now),
    false
);

// ── 4. the resume key ────────────────────────────────────────────────────────
check('the application owns the key when present', resumeKey({ applicationId: 'app1', candidateId: 'c', campaignId: 'k' }), 'app:app1');
check('otherwise candidate + campaign', resumeKey({ candidateId: 'c', campaignId: 'k' }), 'cand:c:k');
check('candidate alone on the legacy path', resumeKey({ candidateId: 'c' }), 'cand:c');
check('no candidate, no key (voice test)', resumeKey({ campaignId: 'k' }), null);
check('blank ids count as absent', resumeKey({ applicationId: '  ', candidateId: 'c' }), 'cand:c');

if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
}
console.log('\nvoice-session-resume-test: OK');
