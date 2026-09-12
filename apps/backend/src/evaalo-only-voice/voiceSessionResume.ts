/**
 * نافذة الرجوع — الجلسة المتوقَّفة تُركَن لا تُمحى.
 *
 * السياق: منذ 0ae9eb8 (٢٠٢٦-٠٩-٠٩) لا يُقفل الرابط إلّا إذا أنهى الخادمُ
 * المقابلة، لأنّ مرشّحاً ضغط End عند إجابته الرابعة واستُهلك رابطه في تسع مِلّي
 * ثوانٍ ثمّ رُفض حين عاد بعد ثمانٍ. لكنّ الثمن ظهر في ٢٠٢٦-٠٩-١٢: الرابط يبقى
 * مفتوحاً بعد إغلاق المرشّح، والتقييم يُنتَج، فإعادةُ الفتح تُجري مقابلةً ثانية
 * من الصفر وتقييمُها **يستبدل** الأوّل عبر `mergeEval`. إعادةٌ متعمَّدة بلا أثر.
 *
 * الحلّ الوسط (خيار ج، بقرار المالك): يُقفل الرابط عند أيّ إغلاق بعد
 * `evidence.ok` — لكن بمهلة رجوع. داخلها لا تبدأ مقابلة جديدة، بل يُستأنف
 * **نفس** الشيء: التاريخ والحالة والعدّادات كما تُركت، بلا تحيّة ثانية.
 *
 * ما يعيش هنا: سجلٌّ في الذاكرة بمفتاح الطلب (أو المرشّح والحملة). القفل نفسه
 * في قاعدة البيانات (`voiceInterviewLinkConsumedAt` + `voiceInterviewResumableUntil`)
 * كي تراه الواجهة وخوادم أخرى؛ أمّا الجلسة الحيّة فلا يمكن أن تعيش إلّا في
 * ذاكرة العملية التي بدأتها. فإعادةُ تشغيل الخادم داخل النافذة تُضيّع الاستئناف
 * لا النصّ: النصّ أُرسل عند الإغلاق كما كان دائماً، والرابط يبقى مقفلاً حتى
 * يفتحه المُوظِّف بالزرّ — وهو التدهور المقصود.
 */

export type ParkedVoiceSession = {
  key: string;
  sessionId: string;
  candidateId: string;
  parkedAt: number;
  expiresAt: number;
  timer: NodeJS.Timeout;
};

const parked = new Map<string, ParkedVoiceSession>();

/**
 * موعد الانتهاء الأصليّ لكلّ مفتاح — **يعيش بعد المطالبة**.
 *
 * ⚠️ مقيس في أوّل جلسة على الإنتاج (4929f056، ٢٠٢٦-٠٩-١٢): إغلاقٌ 08:08:55
 * ⇒ ركنٌ حتى 08:18:55؛ رجوعٌ 08:09:07 (المطالبة تحذف المدخل)؛ إغلاقٌ ثانٍ
 * 08:10:22 ⇒ ركنٌ **حتى 08:20:22**. أي أنّ «موعداً واحداً لا يُمدَّد» كان صحيحاً
 * فقط ما دام المدخل مركوناً، وبطل بأوّل رجوع — فصار التسلسل ممكناً بلا حدّ.
 * (قاعدة البيانات بقيت على 08:18:55 لأنّ أوّل كاتب يفوز؛ السجلّ هنا هو الذي
 * انحرف.) الموعد الآن يُحفظ هنا ولا يُمحى إلّا بانتهائه أو بإنهاء الخادم.
 */
const deadlines = new Map<string, number>();

/** يُنسى الموعد — حين يُنهي الخادمُ المقابلة (لا يبقى ما يُستأنف). */
export function forgetDeadline(key: string): void {
  deadlines.delete(key);
}

/** المهلة بالثواني. `VOICE_RESUME_GRACE_SECONDS`، الافتراضي عشر دقائق. */
export function resumeGraceMs(): number {
  const raw = Number(process.env.VOICE_RESUME_GRACE_SECONDS);
  const seconds = Number.isFinite(raw) && raw > 0 ? raw : 600;
  return seconds * 1000;
}

/**
 * مفتاح الركن. الطلب أوّلاً — هو ما يملك حالة الحملة — ثمّ المرشّح والحملة
 * للمسار القديم. مرشّحٌ بلا طلب ولا حملة (وضع الاختبار) لا يُركَن.
 */
export function resumeKey(scope: {
  applicationId?: string | null;
  candidateId?: string | null;
  campaignId?: string | null;
}): string | null {
  const app = String(scope.applicationId ?? '').trim();
  if (app) return `app:${app}`;
  const cand = String(scope.candidateId ?? '').trim();
  if (!cand) return null;
  const camp = String(scope.campaignId ?? '').trim();
  return camp ? `cand:${cand}:${camp}` : `cand:${cand}`;
}

/**
 * يركن الجلسة. مهلةٌ واحدة لا تُمدَّد: لو ركِن المفتاح نفسه مرّةً ثانية داخل
 * النافذة (انقطع ثمّ عاد ثمّ انقطع)، يبقى موعدُ الانتهاء الأصليّ — وإلّا لسلسل
 * المرشّح الانقطاعات بلا حدّ.
 *
 * `onExpire` يُستدعى مرّةً واحدة حين تنتهي المهلة بلا رجوع، ليمحو المتصلُ ما
 * يملكه من ذاكرة (التاريخ والحالة) — هذا الملفّ لا يعرفهما ولا يجب أن يعرفهما.
 */
export function parkSession(input: {
  key: string;
  sessionId: string;
  candidateId: string;
  onExpire: (sessionId: string) => void;
  now?: number;
  graceMs?: number;
}): ParkedVoiceSession | null {
  const now = input.now ?? Date.now();
  const existing = parked.get(input.key);
  if (existing) clearTimeout(existing.timer);

  // الموعد الأصليّ إن وُجد — سواء كان المدخل ما زال مركوناً أو طولب به ثمّ عاد.
  const expiresAt = deadlines.get(input.key) ?? now + (input.graceMs ?? resumeGraceMs());
  deadlines.set(input.key, expiresAt);

  // بلغنا الموعد أو تجاوزناه: لا ركن. المتصل يمحو الجلسة كأنّها انتهت.
  if (expiresAt <= now) {
    parked.delete(input.key);
    deadlines.delete(input.key);
    return null;
  }

  const delay = expiresAt - now;
  const timer = setTimeout(() => {
    const current = parked.get(input.key);
    if (current?.sessionId !== input.sessionId) return; // claimed or replaced meanwhile
    parked.delete(input.key);
    deadlines.delete(input.key);
    try {
      input.onExpire(input.sessionId);
    } catch {
      /* expiry cleanup must never throw into the event loop */
    }
  }, delay);
  timer.unref?.();

  const entry: ParkedVoiceSession = {
    key: input.key,
    sessionId: input.sessionId,
    candidateId: input.candidateId,
    parkedAt: existing?.parkedAt ?? now,
    expiresAt,
    timer,
  };
  parked.set(input.key, entry);
  return entry;
}

/**
 * يطالب بالجلسة المركونة ويُخرجها من السجلّ. مطالبةٌ واحدة تنجح: مقبسان يفتحان
 * الرابط نفسه في اللحظة نفسها لا يستأنفان الجلسة نفسها معاً.
 */
export function claimParkedSession(key: string, now = Date.now()): ParkedVoiceSession | null {
  const entry = parked.get(key);
  if (!entry) return null;
  parked.delete(key);
  clearTimeout(entry.timer);
  if (entry.expiresAt <= now) return null;
  return entry;
}

/** يُسقط الركن بلا استدعاء `onExpire` — للتنظيف الصريح. */
export function dropParkedSession(key: string): boolean {
  const entry = parked.get(key);
  if (!entry) return false;
  clearTimeout(entry.timer);
  parked.delete(key);
  deadlines.delete(key);
  return true;
}

/** للفحص والاختبار. */
export function peekParkedSession(key: string): ParkedVoiceSession | undefined {
  return parked.get(key);
}

export function parkedSessionCount(): number {
  return parked.size;
}
