import Candidate from '../models/Candidate.js';
import CandidateApplication from '../models/CandidateApplication.js';
import { findApplicationForCallback } from './candidateApplicationService.js';
import { emitDomainEventBestEffort } from './domainEventService.js';
import { DEFAULT_ORG_ID } from '../config/multiTenant.js';

export const INTERVIEW_LINK_ALREADY_USED = 'INTERVIEW_LINK_ALREADY_USED';

export type ConversationEntry = { role?: string; content?: string };

export function isInterviewTestCandidateId(candidateId?: string | null): boolean {
    if (!candidateId) return false;
    return candidateId.startsWith('test-') || candidateId === '507f1f77bcf86cd799439011';
}

/** جلسة فعلية: رسالة user واحدة على الأقل بمحتوى غير فارغ. */
export function hasMeaningfulConversation(history?: ConversationEntry[] | null): boolean {
    if (!history?.length) return false;
    return history.some(
        (m) =>
            m?.role === 'user' &&
            String(m.content ?? '').trim().length > 0
    );
}

type LinkFields = {
    voiceInterviewLinkConsumedAt?: Date | null;
    videoInterviewLinkConsumedAt?: Date | null;
};

export type InterviewLinkScope = {
    /** MongoId للشخص (Candidate) */
    candidateId: string;
    /** applicationId العام أو MongoId للـ Application */
    applicationId?: string | null;
    campaignId?: string | null;
};

export function isVoiceLinkConsumed(doc: LinkFields | null | undefined): boolean {
    return Boolean(doc?.voiceInterviewLinkConsumedAt);
}

export function isVideoLinkConsumed(doc: LinkFields | null | undefined): boolean {
    return Boolean(doc?.videoInterviewLinkConsumedAt);
}

/**
 * Tell the HR boards that a link's availability flipped.
 *
 * Consumption is recorded when the session closes — well before the evaluation
 * callback — and a thin or failed session produces no evaluation event at all.
 * Without this signal a board keeps rendering stale link state until a manual
 * page reload, which reads to HR as a dead "reopen link" control.
 */
function emitLinkAccessChanged(input: {
    organizationId?: string | null;
    candidateId: string;
    stage: 'voice' | 'video';
    consumed: boolean;
    scope?: Omit<InterviewLinkScope, 'candidateId'>;
    sessionId?: string;
}): void {
    const suffix = input.consumed ? `consumed:${input.sessionId || 'unknown'}` : `reopened:${Date.now()}`;
    void emitDomainEventBestEffort({
        organizationId: input.organizationId || DEFAULT_ORG_ID,
        type: 'InterviewLinkAccessChanged',
        idempotencyKey: `link-access:${input.stage}:${input.candidateId}:${suffix}`,
        payload: {
            candidateId: input.candidateId,
            stage: input.stage,
            consumed: input.consumed,
            applicationId: input.scope?.applicationId || null,
            campaignId: input.scope?.campaignId || null,
        },
    });
}

async function resolveScopedApplication(scope: InterviewLinkScope) {
    return findApplicationForCallback({
        applicationId: scope.applicationId || undefined,
        candidateId: scope.candidateId,
        campaignId: scope.campaignId || undefined,
    });
}

/** يفضّل حالة Application إن وُجد؛ وإلا يقع على Candidate (توافق). */
export async function isVoiceLinkConsumedById(
    candidateId: string,
    scope?: Omit<InterviewLinkScope, 'candidateId'>
): Promise<boolean> {
    if (isInterviewTestCandidateId(candidateId)) return false;
    const app = await resolveScopedApplication({ candidateId, ...scope });
    if (app) return isVoiceLinkConsumed(app);
    const c = await Candidate.findById(candidateId)
        .select('voiceInterviewLinkConsumedAt')
        .lean();
    return isVoiceLinkConsumed(c);
}

export async function isVideoLinkConsumedById(
    candidateId: string,
    scope?: Omit<InterviewLinkScope, 'candidateId'>
): Promise<boolean> {
    if (isInterviewTestCandidateId(candidateId)) return false;
    const app = await resolveScopedApplication({ candidateId, ...scope });
    if (app) return isVideoLinkConsumed(app);
    const c = await Candidate.findById(candidateId)
        .select('videoInterviewLinkConsumedAt')
        .lean();
    return isVideoLinkConsumed(c);
}

export async function markVoiceLinkConsumed(
    candidateId: string,
    sessionId?: string,
    scope?: Omit<InterviewLinkScope, 'candidateId'>
): Promise<boolean> {
    if (isInterviewTestCandidateId(candidateId)) return false;
    const now = new Date();
    const update: Record<string, unknown> = { voiceInterviewLinkConsumedAt: now };
    if (sessionId) update.voiceInterviewLinkConsumedSessionId = sessionId;

    const notConsumed = {
        $or: [
            { voiceInterviewLinkConsumedAt: null },
            { voiceInterviewLinkConsumedAt: { $exists: false } },
        ],
    };

    const app = await resolveScopedApplication({ candidateId, ...scope });
    let appOk = false;
    if (app) {
        const updated = await CandidateApplication.findOneAndUpdate(
            { _id: app._id, ...notConsumed },
            { $set: update },
            { new: true }
        );
        appOk = Boolean(updated);
    }

    // Dual-write توافق: لا يحرق رابط حملة أخرى إذا كان Application موجوداً — ما زال يحدّث الشخص للتوافق القديم
    const personResult = await Candidate.findOneAndUpdate(
        { _id: candidateId, ...notConsumed },
        { $set: update },
        { new: true }
    );

    const changed = appOk || Boolean(personResult);
    if (changed) {
        emitLinkAccessChanged({
            organizationId: personResult?.organizationId,
            candidateId,
            stage: 'voice',
            consumed: true,
            scope,
            sessionId,
        });
    }
    return changed;
}

export async function markVideoLinkConsumed(
    candidateId: string,
    sessionId?: string,
    scope?: Omit<InterviewLinkScope, 'candidateId'>
): Promise<boolean> {
    if (isInterviewTestCandidateId(candidateId)) return false;
    const now = new Date();
    const update: Record<string, unknown> = { videoInterviewLinkConsumedAt: now };
    if (sessionId) update.videoInterviewLinkConsumedSessionId = sessionId;

    const notConsumed = {
        $or: [
            { videoInterviewLinkConsumedAt: null },
            { videoInterviewLinkConsumedAt: { $exists: false } },
        ],
    };

    const app = await resolveScopedApplication({ candidateId, ...scope });
    let appOk = false;
    if (app) {
        const updated = await CandidateApplication.findOneAndUpdate(
            { _id: app._id, ...notConsumed },
            { $set: update },
            { new: true }
        );
        appOk = Boolean(updated);
    }

    const personResult = await Candidate.findOneAndUpdate(
        { _id: candidateId, ...notConsumed },
        { $set: update },
        { new: true }
    );

    const changed = appOk || Boolean(personResult);
    if (changed) {
        emitLinkAccessChanged({
            organizationId: personResult?.organizationId,
            candidateId,
            stage: 'video',
            consumed: true,
            scope,
            sessionId,
        });
    }
    return changed;
}

export async function clearVoiceLinkAccess(
    candidateId: string,
    scope?: Omit<InterviewLinkScope, 'candidateId'>
): Promise<boolean> {
    const unset = {
        voiceInterviewLinkConsumedAt: null,
        voiceInterviewLinkConsumedSessionId: '',
    };
    const app = await resolveScopedApplication({ candidateId, ...scope });
    let ok = false;
    if (app) {
        const r = await CandidateApplication.findByIdAndUpdate(
            app._id,
            { $set: unset },
            { new: true }
        );
        ok = Boolean(r);
    }
    const person = await Candidate.findByIdAndUpdate(candidateId, { $set: unset }, { new: true });
    const changed = ok || Boolean(person);
    if (changed) {
        emitLinkAccessChanged({
            organizationId: person?.organizationId,
            candidateId,
            stage: 'voice',
            consumed: false,
            scope,
        });
    }
    return changed;
}

export async function clearVideoLinkAccess(
    candidateId: string,
    scope?: Omit<InterviewLinkScope, 'candidateId'>
): Promise<boolean> {
    const unset = {
        videoInterviewLinkConsumedAt: null,
        videoInterviewLinkConsumedSessionId: '',
    };
    const app = await resolveScopedApplication({ candidateId, ...scope });
    let ok = false;
    if (app) {
        const r = await CandidateApplication.findByIdAndUpdate(
            app._id,
            { $set: unset },
            { new: true }
        );
        ok = Boolean(r);
    }
    const person = await Candidate.findByIdAndUpdate(candidateId, { $set: unset }, { new: true });
    const changed = ok || Boolean(person);
    if (changed) {
        emitLinkAccessChanged({
            organizationId: person?.organizationId,
            candidateId,
            stage: 'video',
            consumed: false,
            scope,
        });
    }
    return changed;
}
