/**
 * تزامن جيل نتائج STT مع أدوار الحوار: أي رفع يلغي نتائج "قيد الطبع" من دور سابق
 * (جملة أُرسلت للـ LLM، أو بدأ الإيجنت بالكلام).
 */
const tokenBySession = new Map<string, number>();

export function getSttPurgeToken(sessionId: string): number {
  return tokenBySession.get(sessionId) ?? 0;
}

/** يُستدعى عند: إتمام جملة المستخدم للـ LLM، وعند startSpeaking (الإيجنت يتكلم) */
export function bumpSttPurgeToken(sessionId: string): number {
  const n = (tokenBySession.get(sessionId) ?? 0) + 1;
  tokenBySession.set(sessionId, n);
  return n;
}

export function clearSttPurgeToken(sessionId: string): void {
  tokenBySession.delete(sessionId);
}
