/**
 * Regression for last-word truncation (prod session 1c541410: "...خلينا" cut).
 *
 * Two causes, two guards:
 *   1. The shorter punctuation silence window was applied even when the tail was
 *      an unfinalized partial — Speechmatics adds "." mid-sentence, so the window
 *      shrank and the turn was sent mid-thought. Now the short window applies
 *      only to a FINAL tail ending in punctuation.
 *   2. When the silence timer fired while the tail was still an unfinalized
 *      partial, the turn was sent before the delayed final arrived (Speechmatics
 *      lags up to ~1.35s). Now we grant one short grace for the final to land.
 *
 * Run: npx tsx src/scripts/voice-turn-endpoint-test.ts
 */
import {
    LIVE_SPEECH_POLL_MS,
    resolveTurnSilenceMs,
    shouldGraceBeforeSend,
    shouldHoldForLiveSpeech,
    tailLooksIncomplete,
} from '../evaalo-only-voice/voiceTimingEnv.js';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
    if (actual === expected) {
        console.log(`ok   ${name}`);
    } else {
        failures += 1;
        console.error(`FAIL ${name}: expected ${String(expected)}, got ${String(actual)}`);
    }
}

const SHORT = 1050;
const LONG = 1300;
const EXTRA = 700;
const sil = (tailIsFinal: boolean, endsWithPunctuation: boolean, text?: string) =>
    resolveTurnSilenceMs({
        tailIsFinal,
        endsWithPunctuation,
        punctuationMs: SHORT,
        defaultMs: LONG,
        text,
        incompleteTailExtraMs: EXTRA,
    });

// --- silence window gating ---------------------------------------------------
check('final tail + punctuation → short window', sil(true, true), SHORT);
check('final tail + no punctuation → long window', sil(true, false), LONG);
// The fix: an unfinalized partial must NOT trigger the short window even if it
// carries a premature ".".
check('partial tail + punctuation → long window (fix)', sil(false, true), LONG);
check('partial tail + no punctuation → long window', sil(false, false), LONG);

// --- one-time grace before sending ------------------------------------------
check('not graced yet → grace once', shouldGraceBeforeSend(false), true);
check('already graced → send now', shouldGraceBeforeSend(true), false);

// --- incomplete tails (prod session 788a5d4a) --------------------------------
// A truncated word: "كم" is the start of "كأخصائي" — the turn was sent mid-word.
check('truncated arabic word is incomplete', tailLooksIncomplete('اني ما اشتغلت كم'), true);
check('dangling connector is incomplete', tailLooksIncomplete('اقدر اعالج الموضوع في'), true);
check('dangling english connector is incomplete', tailLooksIncomplete('I handled it and'), true);
check('complete sentence is not incomplete', tailLooksIncomplete('اشتغلت كموظف موارد بشرية.'), false);
check('standalone short answer is not incomplete', tailLooksIncomplete('لا'), false);

// An incomplete tail must extend the window even when the STT appended a ".".
check('incomplete tail + punctuation → extended', sil(true, true, 'الموضوع في.'), LONG + EXTRA);
check('incomplete tail + no punctuation → extended', sil(true, false, 'اني ما اشتغلت كم'), LONG + EXTRA);
// Short answers must not take the fast path: a 3-word reply is usually unfinished.
check('short reply + punctuation → long window', sil(true, true, 'ما اشتغلت هناك.'), LONG);
// ── تغيّر مقصود: النقطة وحدها لم تعد تُقصّر النافذة ────────────────────────────
//
// كانت جملةٌ كاملة تنتهي بنقطة تأخذ النافذة القصيرة. لكن Speechmatics يُدخل «.»
// عند كل تردّد، فالنافذة كانت تنكمش في اللحظة التي يحتاج فيها المتحدّث المتردّد
// وقتاً أطول لا أقصر. علامة الاستفهام والتعجّب نبرتان مقصودتان لا يخترعهما الـ STT،
// فتبقيان مؤهّلتين للمسار السريع.
//
// الكلفة: ‎+250ms على كل دور ينتهي بنقطة. والمقابل: لا يُبتر كلام المرشح.
check(
    'جملة كاملة + نقطة → النافذة الافتراضية (كانت قصيرة)',
    sil(true, true, 'اشتغلت كموظف موارد بشرية في شركة انشاءات.'),
    LONG
);
check(
    'جملة كاملة + علامة استفهام → النافذة القصيرة',
    sil(true, true, 'شنو المطلوب مني بالضبط بهالدور؟'),
    SHORT
);

// ── من جلسة الإنتاج fc989f10 (سجّاد، مهندس سوائل حفر) ────────────────────────
//
// اشتكى أن الوكيل يقطعه. نفس المتحدّث ونفس الجلسة، وحمايتان مختلفتان: «my» كانت
// في قائمة الكلمات المعلّقة و«i» لم تكن، وفحص الكلمة المبتورة كان بنطاق يونيكود
// عربي بحت. فنجا عند «…you know, my.» وقُطع عند «…academic journey, I.».
const SAJJAD_MY = 'Thank you for this opportunity. Really ? As you know, my.';
const SAJJAD_I =
    'Thank you for this opportunity. As you know, my. recently graduated from University of Technology with degree in Petroleum engineering. And throughout my academic journey, I.';
check('ذيل «my.» ممتد (كان يعمل)', sil(true, true, SAJJAD_MY), LONG + EXTRA);
check('ذيل «I.» ممتد الآن (كان 1050)', sil(true, true, SAJJAD_I), LONG + EXTRA);
check('حرف لاتيني مبتور يُرصد', tailLooksIncomplete('and then I'), true);
check('ضمير إنجليزي معلّق يُرصد', tailLooksIncomplete('the biggest challenge was that we'), true);
check('حشو إنجليزي يُرصد', tailLooksIncomplete('I think, uh'), true);
// ولا تُعامَل الكلمات القائمة بذاتها كمبتورة.
check('«ok» ليست مبتورة', tailLooksIncomplete('ok'), false);
check('«yes» ليست مبتورة', tailLooksIncomplete('yes'), false);
check('«no» ليست مبتورة', tailLooksIncomplete('no'), false);

// ── الحبس الصوتي: من مقابلة فاطمة (الجلسة 6afff73c) ──────────────────────────
//
// عشر إجابات من إحدى وعشرين انقطعت، وثمانٍ منها على **كلمة معنى** لا أداة:
// «بعملية» «ومذكورة» «الرأي» «مستوى» «ذات» «patients» — فلم تُنقذها قائمة الأدوات
// المعلّقة ولن تُنقذها أيّ توسعة لها، إذ لا تعرف لغةٌ مكتوبة أنّ «مستوى» نهاية فكرة
// أم وسطها. أمّا «في» و«the» فكانتا في القائمة ونجتا بـ 2000ms مقابل 1700ms.
// المتصفّح يرسل قطعاً من ‎256ms (4096 عيّنة على 16kHz)، فالنافذة تحتمل قطعةً هادئة.
const CHUNK_MS = 256;
const HOLD_WINDOW = 600;
const MAX_HOLD = 2000;
check('النافذة تحتمل قطعةً صامتة واحدة', HOLD_WINDOW > CHUNK_MS * 2, true);
check('ولا تحتمل قطعتين — كي لا تُطيل الصمت بلا داعٍ', HOLD_WINDOW < CHUNK_MS * 3, true);
const holding = (msSinceLoudAudio: number, heldMs = 0) =>
    shouldHoldForLiveSpeech({
        msSinceLoudAudio,
        heldMs,
        liveSpeechHoldWindowMs: HOLD_WINDOW,
        liveSpeechMaxHoldMs: MAX_HOLD,
    });

check('صوتٌ وصل للتوّ → احبس الدور', holding(80), true);
check('صوتٌ على حافّة النافذة → احبس', holding(HOLD_WINDOW), true);
check('صمتٌ تجاوز النافذة → أرسل', holding(HOLD_WINDOW + 1), false);
check('لم يصدر صوتٌ قطّ → أرسل', holding(Infinity), false);
check('يتكلّم لكنّ السقف بلغ → أرسل رغم ذلك', holding(80, MAX_HOLD), false);
check('يتكلّم وتحت السقف → احبس', holding(80, MAX_HOLD - LIVE_SPEECH_POLL_MS), true);

// ── إعادة تمثيل القطع نفسه ────────────────────────────────────────────────────
//
// النصّ متأخّر عن الصوت: Speechmatics يتأخّر حتى 1.35s، فمن استأنف كلامه قبل 200ms
// لم يصل منه حرف بعد ويبدو للمؤقّت صامتاً. الحبس جسرٌ يعبر تلك الفجوة وحدها.
const FINAL_GRACE = 400;
const STT_LAG = 1350;

function simulateTurn(opts: {
    tail: string;
    /** متى استأنف المرشّح الكلام (null = أنهى جوابه فعلاً) */
    resumeAtMs: number | null;
    /** كم استمرّ الكلام المستأنف */
    speaksForMs: number;
    /** ضجيجٌ عالٍ لا كلام: يتجاوز عتبة الشدّة ولا ينتج عنه نصّ أبداً */
    noiseOnly?: boolean;
    hold: boolean;
}): { outcome: 'cut' | 'survived'; dispatchAtMs: number } {
    let t = sil(true, false, opts.tail) + FINAL_GRACE;
    const textArrivesAt =
        opts.resumeAtMs === null || opts.noiseOnly ? Infinity : opts.resumeAtMs + STT_LAG;
    let held = 0;
    if (opts.hold) {
        while (t < textArrivesAt) {
            const loud =
                opts.resumeAtMs !== null &&
                t >= opts.resumeAtMs &&
                t <= opts.resumeAtMs + opts.speaksForMs;
            if (!holding(loud ? 0 : Infinity, held)) break;
            const step = Math.min(LIVE_SPEECH_POLL_MS, MAX_HOLD - held);
            held += step;
            t += step;
        }
    }
    return { outcome: t >= textArrivesAt ? 'survived' : 'cut', dispatchAtMs: t };
}

// الدور 4: «…من اجل البدء بعملية» — استأنفت بعد 1500ms، وكانت تُرسَل عند 1700ms.
const T4 = { tail: 'من اجل البدء بعملية', resumeAtMs: 1500, speaksForMs: 4000 };
check('الدور 4 كان يُقطع قبل الحبس', simulateTurn({ ...T4, hold: false }).outcome, 'cut');
check('الدور 4 ينجو بالحبس', simulateTurn({ ...T4, hold: true }).outcome, 'survived');

// الدور 22: «…ومستوى الإجادة بها متوسط على مستوى» — وقفةٌ أطول.
const T22 = { tail: 'ومستوى الإجادة بها متوسط على مستوى', resumeAtMs: 1650, speaksForMs: 3000 };
check('الدور 22 كان يُقطع', simulateTurn({ ...T22, hold: false }).outcome, 'cut');
check('الدور 22 ينجو', simulateTurn({ ...T22, hold: true }).outcome, 'survived');

// الدور 40 (إنجليزي): «…just depend on the manual of the 2» — «2» ليست في القائمة.
const T40 = { tail: 'just depend on the manual of the 2', resumeAtMs: 1550, speaksForMs: 3000 };
check('الدور 40 كان يُقطع', simulateTurn({ ...T40, hold: false }).outcome, 'cut');
check('الدور 40 ينجو', simulateTurn({ ...T40, hold: true }).outcome, 'survived');

// ── والثمن، وهو الشرط الذي يجعل هذا مقبولاً في مسار حيّ ───────────────────────
//
// من أنهى جوابه لا يدفع مللي ثانية واحدة: لا صوت ⇒ لا حبس ⇒ نفس لحظة الإرسال.
const doneTail = 'اشتغلت كموظف موارد بشرية في شركة انشاءات.';
const withoutHold = simulateTurn({ tail: doneTail, resumeAtMs: null, speaksForMs: 0, hold: false });
const withHold = simulateTurn({ tail: doneTail, resumeAtMs: null, speaksForMs: 0, hold: true });
check('من أنهى جوابه: لا تأخير إطلاقاً', withHold.dispatchAtMs, withoutHold.dispatchAtMs);
check('ولا يزال يُرسَل عند 1700ms', withHold.dispatchAtMs, LONG + FINAL_GRACE);

// وسعلةٌ عابرة لا تحبس الدور: الصوت انقطع قبل لحظة الإرسال.
const cough = simulateTurn({ tail: doneTail, resumeAtMs: 1000, speaksForMs: 120, hold: true });
check('سعلةٌ عابرة لا تؤخّر الإرسال', cough.dispatchAtMs, LONG + FINAL_GRACE);

// وضجيجٌ متّصل لا يحبس بلا نهاية: السقف يُنهيه.
const noisy = simulateTurn({
    tail: doneTail,
    resumeAtMs: 0,
    speaksForMs: 60000,
    noiseOnly: true,
    hold: true,
});
check('غرفةٌ ضاجّة: الحبس محدود بالسقف', noisy.dispatchAtMs, LONG + FINAL_GRACE + MAX_HOLD);
check('وأسوأ تأخير ممكن ثانيتان', noisy.dispatchAtMs - (LONG + FINAL_GRACE), MAX_HOLD);

if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
}
console.log('\nvoice-turn-endpoint-test: OK');
