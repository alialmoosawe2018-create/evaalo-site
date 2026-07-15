/**
 * هجرة Candidate → CandidateApplication (Many-to-Many foundation).
 *
 * تشغيل:
 *   DRY_RUN=true npm run migrate:candidate-applications
 *   npm run migrate:candidate-applications
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import Candidate from '../models/Candidate.js';
import CandidateApplication, { generateApplicationId } from '../models/CandidateApplication.js';
import RecruitmentCampaign from '../models/RecruitmentCampaign.js';
import {
    buildApplicationSnapshot,
    resolveCampaignRef,
    refreshPersonApplicationCounters,
} from '../services/candidateApplicationService.js';

dotenv.config();

const DRY_RUN = String(process.env.DRY_RUN || 'false').toLowerCase() === 'true';

function hasRealEval(ev: unknown): boolean {
    if (!ev || typeof ev !== 'object') return false;
    const o = ev as Record<string, unknown>;
    const score = o.overall_score;
    const rec = o.recommendation;
    const hasScore = score !== undefined && score !== null && String(score).trim() !== '';
    const hasRec = typeof rec === 'string' && rec.trim().length > 0;
    return hasScore || hasRec;
}

type EvalFlags = {
    written: boolean;
    voice: boolean;
    video: boolean;
    voiceRecording: boolean;
    voiceLink: boolean;
    videoLink: boolean;
    hasCampaign: boolean;
    campaignResolved: boolean;
};

async function main() {
    await connectDatabase();
    const candidates = await Candidate.find({}).lean();
    const [existingApps, campaignCount] = await Promise.all([
        CandidateApplication.countDocuments({ deletedAt: null }),
        RecruitmentCampaign.countDocuments({}),
    ]);

    let created = 0;
    let skippedExisting = 0;
    let skippedNoEmail = 0;
    let errors = 0;
    let missingCampaignRef = 0;
    let withCampaignSlug = 0;
    let evalWritten = 0;
    let evalVoice = 0;
    let evalVideo = 0;
    let withVoiceRecording = 0;
    let withVoiceLink = 0;
    let withVideoLink = 0;
    const campaignSlugSet = new Set<string>();
    const orgSet = new Set<string>();
    const sampleWouldCreate: Array<Record<string, unknown>> = [];

    console.log(
        `[migrate:candidate-applications] candidates=${candidates.length} existingApps=${existingApps} campaigns=${campaignCount} dryRun=${DRY_RUN}`
    );

    for (const c of candidates) {
        try {
            const candidateId = c._id as mongoose.Types.ObjectId;
            if (c.organizationId) orgSet.add(String(c.organizationId));

            const existingCount = await CandidateApplication.countDocuments({
                candidateId,
                deletedAt: null,
            });
            if (existingCount > 0) {
                skippedExisting += 1;
                continue;
            }

            const email = String(c.email || '').trim().toLowerCase();
            if (!email) {
                console.warn(`skip ${candidateId}: no email`);
                skippedNoEmail += 1;
                continue;
            }

            const { campaignRef, campaignId } = await resolveCampaignRef(
                c.campaignId,
                c.organizationId
            );

            const flags: EvalFlags = {
                written: Boolean(
                    c.writtenInterviewEvaluation?.overall_score != null ||
                        c.writtenInterviewEvaluation?.recommendation
                ),
                voice: Boolean(
                    c.voiceInterviewEvaluation?.overall_score != null ||
                        c.voiceInterviewEvaluation?.recommendation
                ),
                video: Boolean(
                    c.videoInterviewEvaluation?.overall_score != null ||
                        c.videoInterviewEvaluation?.recommendation
                ),
                voiceRecording: Boolean(c.voiceRecording?.key),
                voiceLink: Boolean(c.voiceInterviewLinkConsumedAt),
                videoLink: Boolean(c.videoInterviewLinkConsumedAt),
                hasCampaign: Boolean(campaignId),
                campaignResolved: Boolean(campaignRef),
            };
            if (flags.written) evalWritten += 1;
            if (flags.voice) evalVoice += 1;
            if (flags.video) evalVideo += 1;
            if (flags.voiceRecording) withVoiceRecording += 1;
            if (flags.voiceLink) withVoiceLink += 1;
            if (flags.videoLink) withVideoLink += 1;
            if (campaignId) {
                withCampaignSlug += 1;
                campaignSlugSet.add(campaignId);
            }
            if (campaignId && !campaignRef) missingCampaignRef += 1;

            const filesAsAttachments = (c.files || []).map((f) => ({
                type: (f.kind === 'photo' ? 'photo' : 'cv') as 'cv' | 'photo',
                filename: f.filename,
                originalName: f.originalName,
                path: f.path,
                mimeType: f.mimeType,
                size: f.size,
                uploadedAt: f.uploadedAt || new Date(),
            }));

            const doc = {
                organizationId: c.organizationId,
                candidateId,
                campaignRef: campaignRef || undefined,
                campaignId: campaignId || undefined,
                applicationId: generateApplicationId(),
                emailDenorm: email,
                position_applied_for: c.position_applied_for,
                company_applied_to: c.company_applied_to,
                years_of_experience: c.years_of_experience,
                current_company: c.current_company,
                highest_education_level: c.highest_education_level,
                skills: c.skills || [],
                languages: c.languages || [],
                certifications: c.certifications,
                availability: c.availability,
                expectedSalary: c.expectedSalary,
                salaryMin: c.salaryMin,
                salaryMax: c.salaryMax,
                salaryCurrency: c.salaryCurrency,
                coverLetter: c.coverLetter,
                hearAboutUs: c.hearAboutUs,
                agreeToTerms: c.agreeToTerms,
                jobPostingId: c.jobPostingId,
                entryStage: c.entryStage || 'screening',
                sourceType: c.sourceType,
                headHunterContextId: c.headHunterContextId,
                status: c.status || 'pending',
                evaluationContext: c.evaluationContext,
                notes: c.notes,
                applicationSnapshot: buildApplicationSnapshot({
                    full_name: c.full_name,
                    current_title: (c as { current_title?: string }).current_title,
                    current_company: c.current_company,
                    years_of_experience: c.years_of_experience,
                    location: c.location,
                    skills: c.skills,
                    languages: c.languages,
                    position_applied_for: c.position_applied_for,
                }),
                attachments: filesAsAttachments,
                files: filesAsAttachments,
                // لا تنسخ هياكل تقييم فارغة (defaults mongoose بدون score/recommendation)
                ...(hasRealEval(c.writtenInterviewEvaluation)
                    ? { writtenInterviewEvaluation: c.writtenInterviewEvaluation }
                    : {}),
                ...(hasRealEval(c.voiceInterviewEvaluation)
                    ? { voiceInterviewEvaluation: c.voiceInterviewEvaluation }
                    : {}),
                ...(hasRealEval(c.videoInterviewEvaluation)
                    ? { videoInterviewEvaluation: c.videoInterviewEvaluation }
                    : {}),
                aiEvaluation: c.aiEvaluation,
                voiceRecording: c.voiceRecording,
                voiceInterviewLinkConsumedAt: c.voiceInterviewLinkConsumedAt,
                voiceInterviewLinkConsumedSessionId: c.voiceInterviewLinkConsumedSessionId,
                videoInterviewLinkConsumedAt: c.videoInterviewLinkConsumedAt,
                videoInterviewLinkConsumedSessionId: c.videoInterviewLinkConsumedSessionId,
                hiddenFromStages: c.hiddenFromStages,
                hiddenFromViews: c.hiddenFromViews,
                timeline: [
                    {
                        at: c.createdAt || new Date(),
                        type: 'migrated' as const,
                        meta: { from: 'candidate_legacy' },
                    },
                ],
            };

            if (DRY_RUN) {
                if (sampleWouldCreate.length < 10) {
                    sampleWouldCreate.push({
                        email,
                        full_name: c.full_name,
                        campaignId: campaignId || null,
                        campaignRef: campaignRef ? String(campaignRef) : null,
                        ...flags,
                        files: filesAsAttachments.length,
                    });
                }
                created += 1;
                continue;
            }

            await CandidateApplication.create(doc);
            await refreshPersonApplicationCounters(String(candidateId));
            created += 1;
        } catch (err: unknown) {
            errors += 1;
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`error ${c._id}: ${msg}`);
        }
    }

    const report = {
        ok: true,
        dryRun: DRY_RUN,
        inventory: {
            candidates: candidates.length,
            existingApplications: existingApps,
            recruitmentCampaigns: campaignCount,
            organizations: orgSet.size,
            uniqueCampaignSlugsOnCandidates: campaignSlugSet.size,
        },
        wouldCreateOrCreated: created,
        skipped: {
            alreadyHasApplication: skippedExisting,
            noEmail: skippedNoEmail,
            total: skippedExisting + skippedNoEmail,
        },
        risks: {
            missingCampaignRef,
            note:
                missingCampaignRef > 0
                    ? 'Applications keep campaignId string but campaignRef is null (orphan slug or deleted campaign).'
                    : 'All campaign slugs resolved to RecruitmentCampaign ObjectId when present.',
        },
        evalsToCopy: {
            written: evalWritten,
            voice: evalVoice,
            video: evalVideo,
            voiceRecording: withVoiceRecording,
            voiceLinkConsumed: withVoiceLink,
            videoLinkConsumed: withVideoLink,
            withCampaignSlug,
        },
        expectedApplicationsAfter: existingApps + (DRY_RUN ? created : created),
        sampleWouldCreate: DRY_RUN ? sampleWouldCreate : undefined,
        errors,
    };

    console.log(JSON.stringify(report, null, 2));
    await mongoose.disconnect();
}

main().catch(async (e) => {
    console.error(e);
    try {
        await mongoose.disconnect();
    } catch {
        /* ignore */
    }
    process.exit(1);
});
