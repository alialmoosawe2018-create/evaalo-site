import mongoose from 'mongoose';
import Candidate, { type ICandidate } from '../models/Candidate.js';
import CandidateApplication, {
    generateApplicationId,
    type IApplicationSnapshot,
    type ICandidateApplication,
    type ApplicationEventType,
} from '../models/CandidateApplication.js';
import RecruitmentCampaign from '../models/RecruitmentCampaign.js';
import {
    findApplicationsForListing,
    findApplicationsPage,
    loadPeopleByIds,
} from '../repositories/candidateApplicationRepository.js';
import type { CursorPage } from '../repositories/pagination.js';
import { isApplicationOwnsCampaignStateEnabled } from '../config/applicationOwnership.js';

/** Candidate files carry `kind`; application attachments carry `type`. Both the
 *  create path and the returning-applicant update path go through here, because
 *  they had drifted: the update path recognised only `photo` and relabelled every
 *  certificate as a CV, then wrote the raw kind-shaped objects into `files`,
 *  where the schema defaulted all of them to `other`. */
export function toApplicationAttachments(
    files: Array<{
        kind?: string;
        filename?: string;
        originalName?: string;
        path?: string;
        mimeType?: string;
        size?: number;
        uploadedAt?: Date;
    }> | undefined | null
) {
    const KNOWN = new Set(['cv', 'photo', 'certificate']);
    return (files || []).map((f) => ({
        // An unrecognised kind is NOT a CV — mislabelling one shows a certificate
        // where the reviewer expects the résumé.
        type: (KNOWN.has(String(f.kind)) ? f.kind : 'other') as
            | 'cv'
            | 'photo'
            | 'certificate'
            | 'other',
        filename: f.filename,
        originalName: f.originalName,
        path: f.path,
        mimeType: f.mimeType,
        size: f.size,
        uploadedAt: f.uploadedAt || new Date(),
    }));
}

export function buildApplicationSnapshot(input: {
    full_name?: string;
    current_title?: string;
    current_company?: string;
    years_of_experience?: string;
    location?: string;
    skills?: string[];
    languages?: string[];
    position_applied_for?: string;
    headline?: string;
}): IApplicationSnapshot {
    return {
        full_name: input.full_name,
        headline: input.headline || input.current_title || input.position_applied_for,
        current_title: input.current_title || input.position_applied_for,
        current_company: input.current_company,
        years_of_experience: input.years_of_experience,
        location: input.location,
        skills: Array.isArray(input.skills) ? [...input.skills] : [],
        languages: Array.isArray(input.languages) ? [...input.languages] : [],
        position_applied_for: input.position_applied_for,
        capturedAt: new Date(),
    };
}

export async function resolveCampaignRef(
    campaignId?: string | null,
    organizationId?: string
): Promise<{ campaignRef: mongoose.Types.ObjectId | null; campaignId?: string }> {
    const slug = typeof campaignId === 'string' ? campaignId.trim() : '';
    if (!slug) return { campaignRef: null, campaignId: undefined };
    const q: Record<string, unknown> = { campaignId: slug };
    if (organizationId) q.organizationId = organizationId;
    const camp = await RecruitmentCampaign.findOne(q).select('_id campaignId').lean();
    return {
        campaignRef: camp?._id ? (camp._id as mongoose.Types.ObjectId) : null,
        campaignId: slug,
    };
}

/** Cache فقط — أعد الحساب من Applications. */
export async function refreshPersonApplicationCounters(candidateId: string): Promise<void> {
    if (!candidateId || !mongoose.Types.ObjectId.isValid(candidateId)) return;
    const apps = await CandidateApplication.find({
        candidateId,
        deletedAt: null,
    })
        .select('campaignId createdAt')
        .sort({ createdAt: -1 })
        .lean();
    await Candidate.findByIdAndUpdate(candidateId, {
        $set: {
            applicationsCount: apps.length,
            lastAppliedAt: apps[0]?.createdAt || null,
            lastCampaignId: apps[0]?.campaignId || undefined,
        },
    });
}

/** عند تغيّر Candidate.email — مزامنة emailDenorm في كل Applications. */
export async function syncEmailDenormForCandidate(
    candidateId: string,
    newEmail: string
): Promise<number> {
    const email = String(newEmail || '').trim().toLowerCase();
    if (!candidateId || !email) return 0;
    const r = await CandidateApplication.updateMany(
        { candidateId },
        { $set: { emailDenorm: email } }
    );
    return r.modifiedCount || 0;
}

export async function pushApplicationEvent(
    applicationMongoId: string | mongoose.Types.ObjectId,
    type: ApplicationEventType,
    meta?: Record<string, unknown>,
    actorId?: string
): Promise<void> {
    await CandidateApplication.findByIdAndUpdate(applicationMongoId, {
        $push: {
            timeline: {
                at: new Date(),
                type,
                ...(actorId ? { actorId } : {}),
                ...(meta ? { meta } : {}),
            },
        },
    });
}

export type UpsertApplicationInput = {
    organizationId: string;
    candidate: ICandidate;
    campaignId?: string;
    entryStage?: 'screening' | 'audio' | 'video';
    sourceType?: string;
    source?: string;
    headHunterContextId?: string;
    jobPostingId?: string;
    status?: ICandidateApplication['status'];
    evaluationContext?: ICandidateApplication['evaluationContext'];
    /** إن true: أعد استخدام Application الموجود لنفس الحملة دون إنشاء جديد. */
    reuseExisting?: boolean;
    eventType?: ApplicationEventType;
};

/**
 * ينشئ أو يعيد Application للشخص+الحملة. Dual-write: يُحدّث أيضاً campaignId على Candidate للتوافق.
 */
export async function upsertCandidateApplication(
    input: UpsertApplicationInput
): Promise<ICandidateApplication> {
    const candidateId = input.candidate._id as mongoose.Types.ObjectId;
    const email = String(input.candidate.email || '').trim().toLowerCase();
    const { campaignRef, campaignId } = await resolveCampaignRef(
        input.campaignId,
        input.organizationId
    );

    if (input.reuseExisting !== false && campaignId) {
        const existing = await CandidateApplication.findOne({
            candidateId,
            campaignId,
            deletedAt: null,
        });
        if (existing) return existing;
    }

    // بدون حملة: ابحث عن application بلا حملة لنفس الشخص
    if (!campaignId && input.reuseExisting !== false) {
        const orphan = await CandidateApplication.findOne({
            candidateId,
            $or: [{ campaignId: { $exists: false } }, { campaignId: null }, { campaignId: '' }],
            deletedAt: null,
        });
        if (orphan) return orphan;
    }

    const snapshot = buildApplicationSnapshot({
        full_name: input.candidate.full_name,
        current_title: input.candidate.current_title,
        current_company: input.candidate.current_company,
        years_of_experience: input.candidate.years_of_experience,
        location: input.candidate.location,
        skills: input.candidate.skills,
        languages: input.candidate.languages,
        position_applied_for: input.candidate.position_applied_for,
    });

    const filesAsAttachments = toApplicationAttachments(input.candidate.files);
    // Off = the application owns its own state and starts clean. On = the old
    // copy-from-person behaviour, kept only so the flag can roll back fully.
    const seedsFromPerson = !isApplicationOwnsCampaignStateEnabled();

    const app = new CandidateApplication({
        organizationId: input.organizationId,
        candidateId,
        campaignRef: campaignRef || undefined,
        campaignId: campaignId || undefined,
        applicationId: generateApplicationId(),
        emailDenorm: email,
        position_applied_for: input.candidate.position_applied_for,
        company_applied_to: input.candidate.company_applied_to,
        years_of_experience: input.candidate.years_of_experience,
        current_company: input.candidate.current_company,
        highest_education_level: input.candidate.highest_education_level,
        skills: input.candidate.skills || [],
        languages: input.candidate.languages || [],
        certifications: input.candidate.certifications,
        availability: input.candidate.availability,
        expectedSalary: input.candidate.expectedSalary,
        salaryMin: input.candidate.salaryMin,
        salaryMax: input.candidate.salaryMax,
        salaryCurrency: input.candidate.salaryCurrency,
        coverLetter: input.candidate.coverLetter,
        hearAboutUs: input.candidate.hearAboutUs,
        agreeToTerms: input.candidate.agreeToTerms,
        jobPostingId: input.jobPostingId || input.candidate.jobPostingId,
        entryStage: input.entryStage || input.candidate.entryStage || 'screening',
        sourceType: input.sourceType || input.candidate.sourceType,
        source: input.source,
        headHunterContextId: input.headHunterContextId || input.candidate.headHunterContextId,
        status: input.status || input.candidate.status || 'pending',
        evaluationContext: input.evaluationContext || input.candidate.evaluationContext,
        notes: input.candidate.notes,
        applicationSnapshot: snapshot,
        attachments: filesAsAttachments,
        files: filesAsAttachments,
        /* A new application starts unevaluated and unused. Seeding these from the
           person is how one campaign's state reached the next: the score and
           write-up of a different job, and — worse — an interview link that was
           already spent, so the candidate opened a brand-new campaign's link and
           was told the interview was complete. The stamp was older than the
           application that carried it.

           Each of these is written when THIS application's own interview runs. */
        ...(seedsFromPerson
            ? {
                  aiEvaluation: input.candidate.aiEvaluation,
                  voiceRecording: input.candidate.voiceRecording,
                  voiceInterviewLinkConsumedAt: input.candidate.voiceInterviewLinkConsumedAt,
                  voiceInterviewLinkConsumedSessionId:
                      input.candidate.voiceInterviewLinkConsumedSessionId,
                  videoInterviewLinkConsumedAt: input.candidate.videoInterviewLinkConsumedAt,
                  videoInterviewLinkConsumedSessionId:
                      input.candidate.videoInterviewLinkConsumedSessionId,
              }
            : {}),
        hiddenFromStages: input.candidate.hiddenFromStages,
        hiddenFromViews: input.candidate.hiddenFromViews,
        timeline: [
            {
                at: new Date(),
                type: input.eventType || 'applied',
                meta: campaignId ? { campaignId } : undefined,
            },
        ],
    });

    await app.save();

    // Dual-write توافق: أبقِ campaignId على Candidate للمسارات القديمة.
    if (campaignId) {
        await Candidate.findByIdAndUpdate(candidateId, {
            $set: { campaignId },
        }).catch(() => undefined);
    }

    await refreshPersonApplicationCounters(String(candidateId));
    return app;
}

/**
 * صف قائمة Stage: شكل يشبه Candidate القديم مع _id = Application MongoId و candidateId + applicationId.
 */
export function applicationToStageListRow(
    app: Record<string, unknown>,
    person: Record<string, unknown> | null | undefined
): Record<string, unknown> {
    const p = person || {};
    const snap =
        app.applicationSnapshot && typeof app.applicationSnapshot === 'object'
            ? (app.applicationSnapshot as Record<string, unknown>)
            : {};
    return {
        ...p,
        ...app,
        _id: app._id,
        id: app._id,
        candidateId: app.candidateId || p._id,
        applicationId: app.applicationId,
        campaignId: app.campaignId || p.campaignId,
        full_name: p.full_name || snap.full_name,
        email: p.email || app.emailDenorm,
        phone: p.phone,
        location: p.location ?? snap.location,
        linkedin: p.linkedin,
        gender: p.gender,
        // التقييمات من Application تتغلب على أي بقايا على الشخص
        writtenInterviewEvaluation: app.writtenInterviewEvaluation,
        voiceInterviewEvaluation: app.voiceInterviewEvaluation,
        videoInterviewEvaluation: app.videoInterviewEvaluation,
        // Surfaced so the board can show what was already decided and not ask twice.
        hiringOutcome: app.hiringOutcome,
        voiceRecording: app.voiceRecording,
        files: app.attachments || app.files || p.files,
        entryStage: app.entryStage || p.entryStage,
        sourceType: app.sourceType || p.sourceType,
        status: app.status || p.status,
        organizationId: app.organizationId || p.organizationId,
        createdAt: app.createdAt || p.createdAt,
        updatedAt: app.updatedAt || p.updatedAt,
        __rowKind: 'application',
    };
}

export async function findApplicationForCallback(opts: {
    applicationId?: string;
    candidateId?: string;
    campaignId?: string;
}): Promise<ICandidateApplication | null> {
    const appId = opts.applicationId?.trim();
    if (appId) {
        const byPublic = await CandidateApplication.findOne({
            applicationId: appId,
            deletedAt: null,
        });
        if (byPublic) return byPublic;
        if (mongoose.Types.ObjectId.isValid(appId)) {
            const byMongo = await CandidateApplication.findOne({
                _id: appId,
                deletedAt: null,
            });
            if (byMongo) return byMongo;
        }
    }
    if (opts.candidateId && mongoose.Types.ObjectId.isValid(opts.candidateId)) {
        const q: Record<string, unknown> = {
            candidateId: opts.candidateId,
            deletedAt: null,
        };
        if (opts.campaignId?.trim()) q.campaignId = opts.campaignId.trim();
        const list = await CandidateApplication.find(q).sort({ createdAt: -1 }).limit(2);
        if (list.length === 1) return list[0];
        if (list.length > 1 && opts.campaignId) return list[0];
        if (list.length === 1) return list[0];
        // مرشح واحد بدون حملة واضحة وبتقديم واحد فقط
        if (!opts.campaignId) {
            const all = await CandidateApplication.find({
                candidateId: opts.candidateId,
                deletedAt: null,
            }).limit(2);
            if (all.length === 1) return all[0];
        }
    }
    return null;
}

/** Map lean application rows to stage rows, batch-loading their person docs. */
async function mapAppsToStageRows(
    apps: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
    if (!apps.length) return [];
    const personIds = [...new Set(apps.map((a) => String(a.candidateId)))];
    const byId = await loadPeopleByIds(personIds);
    return apps.map((a) => applicationToStageListRow(a, byId.get(String(a.candidateId))));
}

/**
 * Full org-scoped stage-row listing (unpaginated) — legacy behavior.
 * Mongo IO lives in candidateApplicationRepository (Service → Repository → Mongo).
 */
export async function listApplicationsAsStageRows(opts: {
    organizationId: string;
    campaignId?: string;
    extraFilter?: Record<string, unknown>;
}): Promise<Record<string, unknown>[]> {
    const apps = await findApplicationsForListing(opts);
    return mapAppsToStageRows(apps);
}

/** Cursor-paginated stage-row listing — org-scoped, stable order. */
export async function listApplicationsAsStageRowsPage(opts: {
    organizationId: string;
    campaignId?: string;
    extraFilter?: Record<string, unknown>;
    limit?: number;
    cursor?: string | null;
}): Promise<CursorPage<Record<string, unknown>>> {
    const { apps, nextCursor, hasMore } = await findApplicationsPage(opts);
    const rows = await mapAppsToStageRows(apps);
    return { rows, nextCursor, hasMore };
}
