/** يطابق منطق backend: الرابط م consumed إذا وُجد consumedAt. */
export function isVoiceInterviewLinkConsumed(candidate) {
    return Boolean(candidate?.voiceInterviewLinkConsumedAt);
}

export function isVideoInterviewLinkConsumed(candidate) {
    return Boolean(candidate?.videoInterviewLinkConsumedAt);
}

export const INTERVIEW_LINK_ALREADY_USED = 'INTERVIEW_LINK_ALREADY_USED';
