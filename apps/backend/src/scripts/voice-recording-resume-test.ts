/**
 * التسجيل الصوتي عبر الرجوع — ثلاثة أعطالٍ مقيسة في الإنتاج (٢٠٢٦-٠٩-١٢، 4929f056):
 *
 *   ١. الجلسة المستأنَفة تُغلق مرّتين وترفع تحت المفتاح نفسه بمقاطع اتصالها وحده،
 *      فكتب الإغلاقُ الثاني (٥٨ ثانية بعد الرجوع) فوق الأوّل (١٣ تبادلاً).
 *   ٢. المؤشّر `voiceRecording` كان «آخر كاتبٍ يفوز»: تبويبٌ ثانٍ بصفر إجابات
 *      (93cee148، ٨ ثوانٍ) استبدل تسجيلَ المقابلة.
 *   ٣. إغلاقان متقاربان قد يرفعان بترتيبٍ معكوس تحت المفتاح نفسه.
 *
 * والقسم الأوّل هنا هو **الحادثة نفسها** مُعادةً على مستوى الوحدة: اتصالان،
 * إغلاقان، والثاني يجب أن يحمل النصفين. النسخة الأولى من الإصلاح كانت تمرّ من
 * اختباراتٍ خضراء وهي ميّتة، لأنّ الاختبار كان يفحص الدوالّ مفردةً لا دورةَ الحياة.
 *
 * Run: npm run test:voice-recording-resume
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import {
    carriedRecordingCount,
    createVoiceRecordingBuffer,
    dropCarriedRecording,
    peekCarriedRecording,
} from '../evaalo-only-voice/voiceRecordingCarry.js';
import {
    runSerialized,
    serializedKeyCount,
    shouldReplaceVoiceRecording,
    shouldWritePersonRow,
    voiceRecordingReplaceGuard,
} from '../services/voiceRecordingService.js';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
    if (actual === expected) {
        console.log(`ok   ${name}`);
    } else {
        failures += 1;
        console.error(`FAIL ${name}: expected ${String(expected)}, got ${String(actual)}`);
    }
}

const SID = '4929f056-9a0d-44a3-bb0d-91fcadc53bee';
const BIG = 60 * 1024 * 1024;
const newBuffer = (opts: { sessionId?: string; enabled?: boolean; maxBytes?: number; resumed?: boolean } = {}) =>
    createVoiceRecordingBuffer({
        sessionId: opts.sessionId ?? SID,
        enabled: opts.enabled ?? true,
        maxBytes: opts.maxBytes ?? BIG,
        resumed: opts.resumed ?? false,
    });
const spoken = (b: { segments: { buffer: Buffer }[] }) => b.segments.map((s) => s.buffer.toString()).join('|');

// ── 1. THE PRODUCTION INCIDENT, as a lifecycle ───────────────────────────────
//
// Connection A: the candidate answers, then closes the tab. The session is parked.
const a = newBuffer();
check('a fresh connection carries nothing', a.carriedSegmentCount, 0);
a.append('agent', 'mp3', Buffer.from('q1'));
a.append('user', 'pcm', Buffer.from('a1'));
a.append('agent', 'mp3', Buffer.from('q2'));
const closeA = a.close();
check('the first close seals what was spoken', spoken(closeA), 'q1|a1|q2');
a.park();
check('and parking registers it under the session id', peekCarriedRecording(SID)?.segments.length, 3);

// Connection B: the SAME session id, resumed inside the grace window.
const b = newBuffer({ resumed: true });
check('the resumed connection inherits the carried segments', b.carriedSegmentCount, 3);
check('the registry hands them over exactly once', carriedRecordingCount(), 0);
b.append('user', 'pcm', Buffer.from('a2'));
b.append('agent', 'mp3', Buffer.from('q3'));
const closeB = b.close();
// ⚠️ This is the assertion the first fix could not make: the second upload under
// voice-recordings/<org>/<cand>/<sessionId>.mp3 must be the WHOLE conversation,
// not the 58 post-resume seconds that overwrote the first 13 exchanges in prod.
check('the second close carries BOTH halves', spoken(closeB), 'q1|a1|q2|a2|q3');
check('and the byte total continues across the resume', closeB.bytes, 10);

// A connection that is not resumed must not swallow someone else's carry.
a.park();
const fresh = newBuffer({ resumed: false });
check('a non-resumed connection inherits nothing', fresh.carriedSegmentCount, 0);
check('and leaves the parked carry untouched', peekCarriedRecording(SID)?.segments.length, 3);
check('dropping by session id releases it', dropCarriedRecording(SID), true);
check('dropping twice is a no-op', dropCarriedRecording(SID), false);
check('the registry is empty again', carriedRecordingCount(), 0);

// ── 1b. the buffer refuses what would corrupt the snapshot ───────────────────
// A TTS stream still in flight at close keeps calling append. The sealing is what
// makes that harmless: the snapshot owns its own array, so nothing that arrives
// afterwards can reach it, the carry, or the upload. (The `sealed` test inside
// `append` is defence in depth on top of that — it stops the work, and it is what
// keeps a future `park()` that re-seals from picking up a cut-off tail. It has no
// observable effect today, which is why nothing here asserts one.)
const late = newBuffer({ sessionId: 'late' });
late.append('agent', 'mp3', Buffer.from('hello'));
const closedLate = late.close();
late.append('agent', 'mp3', Buffer.from(' tail'));
check('the sealed snapshot is immune to a late chunk', spoken(late.snapshot()), 'hello');
check('and the snapshot object is stable', late.snapshot(), closedLate);
check('closing twice returns the same snapshot', late.close(), closedLate);
late.park();
check('so the carry never sees the late tail', spoken(peekCarriedRecording('late')!), 'hello');
dropCarriedRecording('late');

const capped = newBuffer({ sessionId: 'cap', maxBytes: 4 });
capped.append('user', 'pcm', Buffer.from('abc'));
capped.append('user', 'pcm', Buffer.from('de'));
check('a chunk that would cross the cap is dropped whole', spoken(capped.close()), 'abc');
const carriedCap = newBuffer({ sessionId: 'cap2', maxBytes: 4 });
carriedCap.append('user', 'pcm', Buffer.from('abc'));
carriedCap.park();
const resumedCap = newBuffer({ sessionId: 'cap2', maxBytes: 4, resumed: true });
resumedCap.append('user', 'pcm', Buffer.from('de'));
check('the cap counts the carried bytes too, so it bounds the SESSION', spoken(resumedCap.close()), 'abc');
dropCarriedRecording('cap2');

const off = newBuffer({ sessionId: 'off', enabled: false });
off.append('user', 'pcm', Buffer.from('x'));
check('a disabled buffer records nothing', off.close().segments.length, 0);
off.park();
check('and parks nothing', peekCarriedRecording('off'), undefined);

// park() seals if nobody did: the park runs in the async close path, so its
// correctness must not depend on close() having been reached first.
const unsealed = newBuffer({ sessionId: 'unsealed' });
unsealed.append('user', 'pcm', Buffer.from('answer'));
unsealed.park();
check('park seals when close was not called', spoken(peekCarriedRecording('unsealed')!), 'answer');
dropCarriedRecording('unsealed');
check('registry clean before section 2', carriedRecordingCount(), 0);

// ── 1c. the one fact the unit cannot hold: the upload is issued beside the seal ─
//
// The upload call itself lives in voiceSessionCore's close handler. It must sit in
// the SAME synchronous block as the seal — the first fix put the carry on the far
// side of two awaits and shipped dead. Asserting "no await between the two" states
// exactly that, and survives the block being moved or renamed.
const coreSrc = readFileSync(
    fileURLToPath(new URL('../evaalo-only-voice/voiceSessionCore.ts', import.meta.url)),
    'utf8'
);
const sealAt = coreSrc.indexOf('recordingBuffer.close()');
const uploadAt = coreSrc.indexOf('finalizeVoiceRecording(', sealAt);
check('the close handler seals the recording', sealAt > 0, true);
check('and issues the upload after it', uploadAt > sealAt, true);
const between = coreSrc
    .slice(sealAt, uploadAt)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
check('with no await between seal and upload', /\bawait\b/.test(between), false);
check('the upload declares whether the session is scorable', /scorable:\s*evidence\.ok/.test(coreSrc), true);
check('a forgotten session drops its carried audio', coreSrc.includes('dropCarriedRecording(sid)'), true);

// ── 2. the pointer follows the interview that will be scored ─────────────────
const OWNER = SID;
const TAB2 = '93cee148-60a4-468e-a181-85c5f36c2c49';
const REDO = 'aaaaaaaa-0000-0000-0000-000000000000';
const real = { key: 'k', sessionId: OWNER, durationSec: 380 };

check('no stored recording → write', shouldReplaceVoiceRecording(null, { sessionId: OWNER, scorable: true }), true);
check(
    'stored without a session id → write',
    shouldReplaceVoiceRecording({ key: 'k' }, { sessionId: OWNER, scorable: false }),
    true
);
check(
    'same session, second close of a resumed interview → replace with the fuller file',
    shouldReplaceVoiceRecording(real, { sessionId: OWNER, scorable: true }),
    true
);
check(
    'the 8-second second tab (zero answers) never takes the pointer',
    shouldReplaceVoiceRecording(real, { sessionId: TAB2, scorable: false }),
    false
);
check(
    'a second tab that DID answer takes it — its evaluation overwrites too',
    shouldReplaceVoiceRecording(real, { sessionId: TAB2, scorable: true }),
    true
);
check(
    'a real redo after a recruiter reset takes it',
    shouldReplaceVoiceRecording(real, { sessionId: REDO, scorable: true }),
    true
);
check(
    'a thin redo after a reset does not',
    shouldReplaceVoiceRecording(real, { sessionId: REDO, scorable: false }),
    false
);

// The Mongo filter must express the same rule, so the decision is atomic with the
// write instead of a read followed by a write.
check(
    'a scorable session writes unconditionally',
    JSON.stringify(voiceRecordingReplaceGuard({ sessionId: OWNER, scorable: true })),
    '{}'
);
const guard = voiceRecordingReplaceGuard({ sessionId: TAB2, scorable: false }) as {
    $or: Record<string, unknown>[];
};
check('a thin session writes through two doors only', guard.$or.length, 2);
check(
    'door 1: nothing stored yet',
    JSON.stringify(guard.$or[0]),
    JSON.stringify({ 'voiceRecording.sessionId': { $exists: false } })
);
check('door 2: its own earlier file', JSON.stringify(guard.$or[1]), JSON.stringify({ 'voiceRecording.sessionId': TAB2 }));
check('and never on the link owner', JSON.stringify(guard).includes('voiceInterviewLinkConsumedSessionId'), false);

// ── 2b. the person row is a fallback, not a back door ────────────────────────
//
// ⚠️ Measured in production 2026-09-12 (candidate 6aa59318), a defect THIS change
// introduced: session 9a5d0592 wrote the application pointer, then bad91a5a was
// correctly refused on the application — and fell through to the person row, so
// the two rows named different sessions. The guard had already ruled that this
// session does not own the pointer; writing it to a campaign-agnostic row
// overrules that. (The board itself was not misled: it passes the APPLICATION's
// _id, so the route's person-first lookup misses and serves the application. The
// person row is read on the legacy path and after a rollback.) The cause was one
// flag standing for two questions: "did the write land?" vs "is there an
// application?" — a landed write and a guard refusal are not the same outcome.
const person = (appResolved: boolean, appWriteThrew: boolean) =>
    shouldWritePersonRow({ appResolved, appWriteThrew, ownershipEnabled: true });
check('no application at all → the person holds it', person(false, false), true);
// One answer covers both "the write landed" and "the guard refused it": the
// application was reached and its guard decided, so the person is never touched.
// Only a THROWN write means no row points at the file and a fallback is real.
check('the application answered (landed or refused) → leave the person alone', person(true, false), false);
check('application write threw → fall back to the person', person(true, true), true);
check('resolution itself threw (no application known) → fall back', person(false, true), true);
check(
    'ownership flag off → the person is always written, as before',
    shouldWritePersonRow({ appResolved: true, appWriteThrew: false, ownershipEnabled: false }),
    true
);

// ── 3. uploads of one session run in order; sessions do not wait on each other ─
const order: string[] = [];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const first = runSerialized('rec:A', async () => {
    order.push('A1-start');
    await sleep(40);
    order.push('A1-end');
});
const second = runSerialized('rec:A', async () => {
    order.push('A2-start');
    await sleep(5);
    order.push('A2-end');
});
const other = runSerialized('rec:B', async () => {
    order.push('B1-start');
    order.push('B1-end');
});
await Promise.all([first, second, other]);
check('same key: the second close waits for the first upload', order.indexOf('A2-start') > order.indexOf('A1-end'), true);
check('and both uploads ran', order.filter((s) => s.endsWith('-end')).length, 3);
check('different key: does not wait', order.indexOf('B1-end') < order.indexOf('A1-end'), true);
await sleep(0);
check('finished chains are released', serializedKeyCount(), 0);

// A task enqueued AFTER an earlier one settled, while a later one is still running,
// must still go last. This is what the release-by-identity check buys: an
// unconditional delete would chain the newcomer on a resolved promise and let it
// upload concurrently with the task ahead of it — the very out-of-order overwrite
// runSerialized exists to prevent, and the shape production produces (two closes
// seconds apart, a third finalize arriving while ffmpeg is still running).
const q: string[] = [];
const q1 = runSerialized('rec:Q', async () => { q.push('1s'); await sleep(20); q.push('1e'); });
const q2 = runSerialized('rec:Q', async () => { q.push('2s'); await sleep(40); q.push('2e'); });
await q1;
const q3 = runSerialized('rec:Q', async () => { q.push('3s'); q.push('3e'); });
await Promise.all([q2, q3]);
check('a task enqueued after an earlier one settled still runs last', q.join(','), '1s,1e,2s,2e,3s,3e');

// A failed upload must not block a close already queued behind it. The next task is
// queued BEFORE the failure settles, so `prev` really is the rejected promise —
// without the `prev.catch` guard the chain would reject and the task never run.
const after: string[] = [];
const failing = runSerialized('rec:C', async () => {
    throw new Error('ffmpeg exploded');
});
const queuedBehind = runSerialized('rec:C', async () => {
    after.push('C2-ran');
});
await failing.catch(() => after.push('C1-failed'));
await queuedBehind;
check('a failure does not block the task queued behind it', after.join(','), 'C1-failed,C2-ran');

if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
}
console.log('\nvoice-recording-resume-test: OK');
