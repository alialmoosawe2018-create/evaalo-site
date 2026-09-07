/**
 * تزامن جيل نتائج STT مع أدوار الحوار: أي رفع يلغي نتائج "قيد الطبع" من دور سابق
 * (جملة أُرسلت للـ LLM، أو بدأ الإيجنت بالكلام).
 *
 * ولماذا يُسجَّل **سبب** الرفع لا مجرّد رقمه:
 *
 * النسخ يعمل بالدفعات لا بالتدفّق — تُغلق الدفعة بعد ~1150 مللي من الصمت ثمّ
 * تُرسَل للنسخ وتعود بعد رحلة شبكة. فحين يقف المرشّح ليفكّر ثمّ يُكمل، تُغلق
 * الدفعة الأولى وتعود، ويُسلَّح مؤقّت الدور عليها، بينما تتمّته ما زالت في
 * الدفعة الثانية. تنتهي النافذة، يُرسَل الدور، يُرفع الرمز — ثمّ تعود الدفعة
 * الثانية فتُرمى.
 *
 * حدث ذلك في الجلسة 6afff73c عند «انا افضل انه»: قالت إنّها تفضّل العمل وحدها،
 * وسُجّل صوتها، ونُسخ نصّها بنجاح، ثمّ رُمي. لم تكن مقاطعة — أنهت جملتها والنظام
 * فقد ذيلها، فحكم المُقيّم على شظيّة من جواب قيل كاملاً.
 *
 * والرمي نفسه صحيح حين يكون سببه أنّ الإيجنت بدأ الكلام: ما يصل بعدها قد يكون
 * صدى صوته هو. أمّا حين يكون السبب إرسال دور، فالصوت صوت المرشّح ويستحقّ أن
 * يدخل السجلّ ولو فات أوان تغيير الردّ. عدّاد واحد لا يفرّق بين الحالتين — لذا
 * صار معه سبب.
 */
export type SttPurgeReason = 'turn_dispatched' | 'agent_speaking' | 'listen_started';

const tokenBySession = new Map<string, number>();
const reasonBySession = new Map<string, SttPurgeReason>();

export function getSttPurgeToken(sessionId: string): number {
  return tokenBySession.get(sessionId) ?? 0;
}

/** سبب آخر رفع — لتقرير مصير دفعة عادت متأخّرة. */
export function getSttPurgeReason(sessionId: string): SttPurgeReason | undefined {
  return reasonBySession.get(sessionId);
}

/** يُستدعى عند: إتمام جملة المستخدم للـ LLM، وعند startSpeaking (الإيجنت يتكلم) */
export function bumpSttPurgeToken(sessionId: string, reason: SttPurgeReason): number {
  const n = (tokenBySession.get(sessionId) ?? 0) + 1;
  tokenBySession.set(sessionId, n);
  reasonBySession.set(sessionId, reason);
  return n;
}

export function clearSttPurgeToken(sessionId: string): void {
  tokenBySession.delete(sessionId);
  reasonBySession.delete(sessionId);
}

/**
 * هل تستحقّ دفعةٌ عادت متأخّرة أن تُحفظ في السجلّ؟
 *
 * نعم إن كان الرفع **الوحيد** الذي فاتها هو إرسال الدور — أي أنّ الرمز تقدّم خطوة
 * واحدة فقط ولم يبدأ الإيجنت الكلام بعد. تجاوزُ خطوتين يعني أنّ الإيجنت تكلّم في
 * الأثناء، فما وصل قد يكون صدىً لا كلام مرشّح.
 */
export function shouldKeepLateBatch(
  sessionId: string,
  tokenAtBatchStart: number,
): boolean {
  const current = getSttPurgeToken(sessionId);
  if (current - tokenAtBatchStart !== 1) return false;
  return getSttPurgeReason(sessionId) === 'turn_dispatched';
}
