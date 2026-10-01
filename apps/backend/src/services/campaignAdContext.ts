// ============================================
// services/campaignAdContext.ts
// May a campaign's stored job ad steer an interview?
//
// Until 2026-10-01 no campaign kept its ad (the create route dropped it), so every
// reader below has only ever run WITHOUT one:
//   - the voice interviewer's role context      (evaalo-only-voice/voiceSessionCore.ts)
//   - the video agent's role_context            (routes/videoInterview.ts, /prepare and /start)
//   - the competency blueprint generator        (services/expertise/ensureBlueprint.ts) —
//     the ad joins the text that picks the domain pack and the LLM prompt, and voice and
//     video interviews are scored on the competencies it produces.
// The ad is model-written: it adds responsibilities and benefits nobody approved. Letting
// it in would change interviews and what they are scored on, untested. So a stored ad is
// for showing and publishing only, until CAMPAIGN_AD_AS_INTERVIEW_CONTEXT=true is chosen
// after a test. Every reader goes through this function (test:campaign-ad-context).
// ============================================

export function campaignAdForInterviewContext(stored: unknown): string | undefined {
    if (process.env.CAMPAIGN_AD_AS_INTERVIEW_CONTEXT !== 'true') return undefined;
    return typeof stored === 'string' && stored.trim() ? stored : undefined;
}
