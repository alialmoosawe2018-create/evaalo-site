/**
 * يطابق منطق backend: الرابط مستهلَك إذا وُجد consumedAt —
 * **إلّا داخل نافذة الرجوع.** الإغلاق من المرشّح يقفل الرابط ويفتح نافذةً
 * (voiceInterviewResumableUntil) يُستأنف فيها نفس الجلسة لا جلسة جديدة. ما دامت
 * في المستقبل نُظهر المقابلة ونترك القرار للخادم: يربط المقبس بالجلسة المركونة،
 * أو يرفض بـ4001 إن كانت قد ضاعت (إعادة تشغيل)، فتظهر شاشة «الرابط مستخدَم».
 */
export function isVoiceInterviewLinkConsumed(candidate, now = Date.now()) {
    if (!candidate?.voiceInterviewLinkConsumedAt) return false;
    const until = candidate?.voiceInterviewResumableUntil
        ? new Date(candidate.voiceInterviewResumableUntil).getTime()
        : 0;
    return !(Number.isFinite(until) && until > now);
}

export function isVideoInterviewLinkConsumed(candidate) {
    return Boolean(candidate?.videoInterviewLinkConsumedAt);
}

export const INTERVIEW_LINK_ALREADY_USED = 'INTERVIEW_LINK_ALREADY_USED';
