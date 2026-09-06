import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
import Candidate from '../models/Candidate.js';
import CandidateApplication from '../models/CandidateApplication.js';
import { upsertCandidateApplication } from '../services/candidateApplicationService.js';
import {
    PublicCampaignClosedError,
    PublicCampaignNotFoundError,
    findCampaignByPublicToken,
    getPublicFormConfigByToken,
    markFirstCandidateIfNeeded,
    resolveCampaignFormBinding,
    assertCampaignAcceptsApplications,
} from '../services/publicCampaignService.js';
import {
    buildSubmissionInputFromRequest,
    mergeValidatedIntoCandidateData,
    validateApplicationSubmission,
} from '../services/applicationSubmitValidation.js';
import {
    enqueueStage1EvaluationOutbox,
    dispatchStage1EvaluationOutbox,
    normalizeStage1RubricSnapshotHash,
} from '../services/stage1EvaluationOutboxService.js';
import { normalizeStage1EvaluationLanguage } from '../services/stage1EvaluationLanguage.js';
import { assertStageOutboundSecurityForTrigger, StageCallbackConfigurationError } from '../services/stageCallbackAuth.js';
import { extractHoneypotFields, isHoneypotTriggered } from '../constants/n8nStage1.js';
import { CERTIFICATES_MAX_FILES } from '../shared/formTemplates/index.js';
import type { CampaignFormContext } from '../types/campaignFormContext.js';
import { resolveApplicationJobContext } from '../services/applicationJobContext.js';

const router = Router();

const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({
    dest: uploadsDir,
    limits: { fileSize: 6 * 1024 * 1024 },
});

/**
 * GET /api/public/interview-candidate?candidateId=&campaignId=
 *
 * Public (unauthenticated) DISPLAY lookup for the interview page. Returns ONLY
 * the candidate's name + applied position, and ONLY when the (candidateId +
 * campaignId) pair matches a real campaign–candidate association. That pair is
 * the capability — both ids live in the shared interview link. It is NOT
 * org-scoped, so the candidate (no session) and any recruiter can load their
 * display name. No email/phone/scores/PII are ever returned.
 */
router.get('/interview-candidate', async (req: Request, res: Response) => {
    try {
        const candidateId = String(req.query.candidateId || '').trim();
        const campaignId = String(req.query.campaignId || '').trim();
        if (!campaignId) {
            return res.status(400).json({ success: false, error: 'Missing campaignId' });
        }
        if (!mongoose.Types.ObjectId.isValid(candidateId) || candidateId.length !== 24) {
            return res.status(400).json({ success: false, error: 'Invalid candidateId' });
        }

        const safe = (
            person: {
                _id: unknown;
                full_name?: string;
                position_applied_for?: string;
                entryStage?: string;
                voiceInterviewLinkConsumedAt?: Date | null;
                videoInterviewLinkConsumedAt?: Date | null;
            },
            applicationId?: string,
            // The person's copy of the job is the one they FIRST applied for and
            // is never updated, so this page would name the wrong role to a
            // returning applicant. `undefined` means the flag is off.
            positionFromApplication?: string,
        ) => ({
            success: true,
            data: {
                candidateId: String(person._id),
                applicationId: applicationId || undefined,
                full_name: person.full_name || '',
                position_applied_for:
                    positionFromApplication ?? (person.position_applied_for || ''),
                entryStage: person.entryStage,
                // Consumed timestamps keep the single-use link block working on the
                // candidate page. Not PII — safe to expose to the link holder.
                voiceInterviewLinkConsumedAt: person.voiceInterviewLinkConsumedAt ?? null,
                videoInterviewLinkConsumedAt: person.videoInterviewLinkConsumedAt ?? null,
            },
        });

        /** The campaign's own job title, or undefined while the flag is off. */
        const positionFor = async (opts: { applicationId?: string; candidateId?: string }) => {
            const job = await resolveApplicationJobContext({ ...opts, campaignId });
            return job ? job.position_applied_for || '' : undefined;
        };

        // 1) candidateId is a Candidate _id belonging to this campaign.
        const person = await Candidate.findOne({ _id: candidateId, campaignId }).lean();
        if (person) {
            const position = await positionFor({ candidateId });
            return res.json(safe(person as Record<string, unknown> as never, undefined, position));
        }

        // 2) candidateId is a CandidateApplication _id for this campaign → resolve person.
        const app = await CandidateApplication.findOne({
            _id: candidateId,
            campaignId,
            deletedAt: null,
        }).lean();
        if (app) {
            const p = await Candidate.findById((app as { candidateId?: unknown }).candidateId).lean();
            if (p) {
                const position = await positionFor({ applicationId: candidateId });
                return res.json(
                    safe(p as Record<string, unknown> as never, candidateId, position),
                );
            }
        }

        return res.status(404).json({ success: false, error: 'Candidate not found' });
    } catch (error) {
        console.error(
            'Error in public interview-candidate lookup:',
            error instanceof Error ? error.message : error,
        );
        return res.status(500).json({ success: false, error: 'Failed to load candidate' });
    }
});

/** GET /api/public/campaigns/:pubToken/form-config */
router.get('/campaigns/:pubToken/form-config', async (req: Request, res: Response) => {
    try {
        const config = await getPublicFormConfigByToken(req.params.pubToken);
        res.json({ success: true, ...config });
    } catch (e) {
        if (e instanceof PublicCampaignNotFoundError) {
            return res.status(404).json({ success: false, error: 'Not found' });
        }
        if (e instanceof PublicCampaignClosedError) {
            return res.status(410).json({ success: false, error: e.message, code: 'CAMPAIGN_CLOSED' });
        }
        console.error('form-config error:', e);
        res.status(500).json({ success: false, error: 'Failed to load form configuration' });
    }
});

/** POST /api/public/campaigns/:pubToken/apply */
router.post(
    '/campaigns/:pubToken/apply',
    upload.fields([
        { name: 'cv', maxCount: 1 },
        { name: 'photo', maxCount: 1 },
        { name: 'certificates', maxCount: CERTIFICATES_MAX_FILES },
    ]),
    async (req: Request, res: Response) => {
        try {
            if (mongoose.connection.readyState !== 1) {
                return res.status(503).json({ success: false, error: 'Database not connected' });
            }

            const campaign = await findCampaignByPublicToken(req.params.pubToken);
            if (!campaign) {
                return res.status(404).json({ success: false, error: 'Not found' });
            }
            const campaignCtx = campaign as CampaignFormContext;
            try {
                assertCampaignAcceptsApplications(campaignCtx);
            } catch (e) {
                if (e instanceof PublicCampaignClosedError) {
                    return res.status(410).json({ success: false, error: e.message, code: 'CAMPAIGN_CLOSED' });
                }
                throw e;
            }

            const body = { ...(req.body || {}) } as Record<string, unknown>;
            const honeypot = extractHoneypotFields(body);
            if (isHoneypotTriggered(honeypot)) {
                return res.status(201).json({ success: true, message: 'Application submitted successfully' });
            }

            const binding = resolveCampaignFormBinding(campaignCtx);
            const snapshot = binding.snapshot;
            const uploads = req.files as Record<string, Express.Multer.File[]> | undefined;
            const submissionInput = buildSubmissionInputFromRequest(body, {
                cv: uploads?.cv?.[0],
                photo: uploads?.photo?.[0],
                certificates: uploads?.certificates ?? [],
            });

            const validation = validateApplicationSubmission(snapshot, submissionInput);
            if (!validation.ok) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation failed',
                    code: 'APPLICATION_VALIDATION_FAILED',
                    details: validation.errors,
                });
            }

            const candidateData = mergeValidatedIntoCandidateData(validation.normalized, snapshot);
            candidateData.campaignId = campaign.campaignId;

            if (uploads?.cv?.[0]) {
                const f = uploads.cv[0];
                candidateData.files = [
                    {
                        kind: 'cv',
                        filename: f.filename,
                        originalName: f.originalname,
                        path: f.path,
                        mimeType: f.mimetype,
                        size: f.size,
                        uploadedAt: new Date(),
                    },
                ];
            }
            if (uploads?.photo?.[0]) {
                const f = uploads.photo[0];
                const files = Array.isArray(candidateData.files) ? candidateData.files : [];
                files.push({
                    kind: 'photo',
                    filename: f.filename,
                    originalName: f.originalname,
                    path: f.path,
                    mimeType: f.mimetype,
                    size: f.size,
                    uploadedAt: new Date(),
                });
                candidateData.files = files;
            }
            if (uploads?.certificates?.length) {
                const files = Array.isArray(candidateData.files) ? candidateData.files : [];
                for (const f of uploads.certificates.slice(0, CERTIFICATES_MAX_FILES)) {
                    files.push({
                        kind: 'certificate',
                        filename: f.filename,
                        originalName: f.originalname,
                        path: f.path,
                        mimeType: f.mimetype,
                        size: f.size,
                        uploadedAt: new Date(),
                    });
                }
                candidateData.files = files;
            }

            delete candidateData.agreeToTerms;
            delete candidateData.certificates;

            const emailNorm = String(candidateData.email || '').trim().toLowerCase();
            const existing = emailNorm
                ? await Candidate.findOne({
                      organizationId: campaign.organizationId,
                      email: emailNorm,
                  })
                : null;
            if (existing) {
                const existingApp = await CandidateApplication.findOne({
                    candidateId: existing._id,
                    campaignId: campaign.campaignId,
                    deletedAt: null,
                }).lean();
                if (existingApp) {
                    return res.status(400).json({
                        success: false,
                        error: 'Already applied to this campaign',
                        code: 'APPLICATION_EXISTS',
                        message: 'This email is already registered for this campaign',
                        applicationId: existingApp.applicationId,
                    });
                }
            }

            const n8nConfigured = Boolean(process.env.N8N_WEBHOOK_URL?.trim());
            if (n8nConfigured) {
                try {
                    assertStageOutboundSecurityForTrigger();
                } catch (e) {
                    if (e instanceof StageCallbackConfigurationError) {
                        return res.status(503).json({
                            success: false,
                            error: 'Stage callback security is not configured',
                        });
                    }
                    throw e;
                }
            }

            const evaluationLanguage = normalizeStage1EvaluationLanguage(
                body.evaluationLanguage ?? body.language
            );

            const evaluationContext = {
                formSchemaVersion: binding.schemaVersion,
                formSchemaHash: binding.schemaHash,
                rubricVersion: campaign.rubricVersion ?? 1,
                rubricSnapshotHash: normalizeStage1RubricSnapshotHash(
                    campaign.rubricSnapshotHash ?? ''
                ),
                evaluationLanguage,
            };

            let candidate;
            if (existing) {
                await Candidate.findByIdAndUpdate(existing._id, {
                    $set: {
                        campaignId: campaign.campaignId,
                        // Refresh the evaluation context so this (new) application's
                        // rubric hash + language reach the Stage 1 evaluator — sendToN8N
                        // reads evaluationLanguage from the candidate doc.
                        evaluationContext,
                        ...(candidateData.full_name ? { full_name: candidateData.full_name } : {}),
                        ...(candidateData.phone ? { phone: candidateData.phone } : {}),
                        ...(candidateData.location ? { location: candidateData.location } : {}),
                    },
                });
                candidate = await Candidate.findById(existing._id);
                if (!candidate) {
                    return res.status(500).json({ success: false, error: 'Failed to load candidate' });
                }
            } else {
                candidate = new Candidate({
                    ...candidateData,
                    organizationId: campaign.organizationId,
                    createdByClerkUserId: campaign.createdByClerkUserId,
                    status: n8nConfigured ? 'pending_evaluation' : 'pending',
                    evaluationContext,
                });
                await candidate.save();
            }

            const application = await upsertCandidateApplication({
                organizationId: String(campaign.organizationId),
                candidate,
                campaignId: campaign.campaignId,
                entryStage: candidate.entryStage,
                sourceType: candidate.sourceType,
                status: n8nConfigured ? 'pending_evaluation' : 'pending',
                evaluationContext,
                reuseExisting: true,
                eventType: 'applied',
            });

            await markFirstCandidateIfNeeded(campaign.campaignId);

            // Enqueue Stage 1 evaluation for BOTH new and returning candidates. A
            // returning candidate applying to a different campaign has a different
            // rubric snapshot, so it must be re-evaluated against the new criteria;
            // the outbox idempotency key is (candidateId + rubricSnapshotHash), so a
            // re-submission to the same campaign/rubric is deduped (no double charge).
            if (n8nConfigured) {
                try {
                    const candidateObj = candidate.toObject();
                    const { outboxId, shouldDispatch } = await enqueueStage1EvaluationOutbox({
                        candidateId: String(candidateObj._id?.toString?.() || candidateObj._id),
                        campaignId: campaign.campaignId,
                        organizationId:
                            typeof campaign.organizationId === 'string'
                                ? campaign.organizationId
                                : undefined,
                        rubricSnapshotHash: normalizeStage1RubricSnapshotHash(
                            campaign.rubricSnapshotHash ?? ''
                        ),
                        formSchemaHash: binding.schemaHash,
                    });
                    if (shouldDispatch) {
                        dispatchStage1EvaluationOutbox(outboxId);
                    }
                } catch (err) {
                    console.error('Failed to enqueue Stage 1 evaluation outbox (non-blocking):', err);
                }
            }

            res.status(201).json({
                success: true,
                message: existing
                    ? 'Application created for existing candidate'
                    : 'Application submitted successfully',
                data: {
                    id: candidate._id,
                    candidateId: candidate._id,
                    applicationId: application.applicationId,
                    campaignId: campaign.campaignId,
                },
            });
        } catch (e) {
            console.error('public apply error:', e);
            res.status(500).json({ success: false, error: 'Failed to submit application' });
        }
    }
);

export default router;
