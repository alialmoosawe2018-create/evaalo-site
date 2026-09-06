// ============================================
// File: services/applicationJobContext.ts
// Purpose: The one answer to "which job is this interview about?".
//
// `Candidate.position_applied_for` is written when a person first applies and
// never again — the update whitelist in routes/candidates.ts carries the name,
// the phone and the current company, but not this. So for anyone who applies a
// second time, every reader of that field learns the OLD job: the agent asks
// about it, the candidate answers, and the answers are scored against it.
// Measured across all records: 0 of 85 single-application people are affected,
// 5 of 8 returning applicants are.
//
// The application owns the job it was filed for, so that is what this reads.
//
// And within the application, the CAMPAIGN's role outranks the title the
// applicant typed. `position_applied_for` is what they said about THEMSELVES,
// which is often a different job from the one being filled: measured on
// production, 4 of 6 recent applications disagreed with their campaign — one of
// them "Mud Engineer" against a campaign hiring a Senior HR Specialist. Since
// this value is what the agent asks about and what the scorer is told the
// interview was for, reading their wording meant interviewing and grading
// against a job nobody was hiring for, while the rubric came from the campaign
// all along. Their own words remain on the application and on the profile.
//
// The failure mode is deliberate. When the flag is on this NEVER falls back to
// the person: a caller that cannot resolve an application gets empty fields and
// shows a blank, which is visible. Falling back would restore the silent wrong
// answer this exists to remove.
// ============================================

import { findApplicationForCallback } from './candidateApplicationService.js';
import { isApplicationOwnsCampaignStateEnabled } from '../config/applicationOwnership.js';
import { loadCampaignRoles } from './campaignRole.js';

export { isApplicationOwnsCampaignStateEnabled };

export type ApplicationJobContext = {
    position_applied_for?: string;
    company_applied_to?: string;
    campaignId?: string;
    applicationId?: string;
    /** The campaign's job posting, used to pick the interview question bank. */
    jobPostingId?: string;
};

function clean(value: unknown): string | undefined {
    const s = typeof value === 'string' ? value.trim() : '';
    return s.length > 0 ? s : undefined;
}

/**
 * Resolve the job context from the application.
 *
 * Returns `null` for one reason only — the flag is off — which tells the caller
 * to keep its legacy path unchanged. When the flag is on it always returns an
 * object, even if no application was found, so no caller can slip back to
 * reading the person.
 */
export async function resolveApplicationJobContext(opts: {
    applicationId?: string;
    candidateId?: string;
    campaignId?: string;
}): Promise<ApplicationJobContext | null> {
    if (!isApplicationOwnsCampaignStateEnabled()) return null;

    try {
        const app = await findApplicationForCallback(opts);
        if (!app) return {};
        const snap = app.applicationSnapshot;
        const campaignId = clean(app.campaignId);
        // A campaign that names no role leaves the applicant's own title in place,
        // as does a lookup failure — this must never blank out the job.
        const campaignRole = campaignId
            ? (await loadCampaignRoles([campaignId])).get(campaignId)
            : undefined;
        return {
            position_applied_for:
                clean(campaignRole) ??
                clean(app.position_applied_for) ??
                clean(snap?.position_applied_for),
            company_applied_to: clean(app.company_applied_to),
            campaignId: clean(app.campaignId),
            applicationId: clean(app.applicationId),
            jobPostingId: clean(app.jobPostingId),
        };
    } catch (err: any) {
        // An empty context degrades to the link's own position, which is still
        // this campaign's. Reading the person here would not.
        console.warn(`[JOB CONTEXT] lookup failed: ${err?.message || err}`);
        return {};
    }
}
