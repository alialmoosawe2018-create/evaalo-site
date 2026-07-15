// ============================================
// ملف: routes/interviewBlueprints.ts
// الوظيفة: مسار تشخيصي فقط (QA) لفحص Blueprint المولّد لحملة.
//          لا يوجد generate/patch/lock يدوي في MVP — التوليد تلقائي عبر ensureBlueprint.
// ============================================

import express, { Request, Response } from 'express';
import { getLockedBlueprintForCampaign } from '../services/expertise/ensureBlueprint.js';

const router = express.Router();

/**
 * GET /api/interview-blueprints/:campaignId
 * يرجع الـBlueprint المقفل + ملخّص الProfile للحملة (للتشخيص/الـQA).
 */
router.get('/:campaignId', async (req: Request, res: Response) => {
    try {
        const campaignId = (req.params.campaignId || '').trim();
        if (!campaignId) {
            return res.status(400).json({ success: false, message: 'campaignId is required' });
        }
        const bundle = await getLockedBlueprintForCampaign(campaignId);
        if (!bundle) {
            return res.status(404).json({
                success: false,
                message: 'No locked blueprint found for this campaign',
            });
        }
        const { blueprint, profile } = bundle;
        return res.json({
            success: true,
            data: {
                blueprint: {
                    blueprintId: blueprint.blueprintId,
                    version: blueprint.version,
                    campaignId: blueprint.campaignId,
                    profileId: blueprint.profileId,
                    status: blueprint.status,
                    language: blueprint.language,
                    anchorQuestions: blueprint.anchorQuestions,
                    competencies: blueprint.competencies,
                    generationSource: blueprint.generationSource,
                    knowledgeDepth: blueprint.knowledgeDepth,
                    lockedAt: blueprint.lockedAt,
                },
                profile: profile
                    ? {
                          profileId: profile.profileId,
                          version: profile.version,
                          jobTitle: profile.jobTitle,
                          domain: profile.domain,
                          specialization: profile.specialization,
                          seniority: profile.seniority,
                          environment: profile.environment,
                          domainPackKey: profile.domainPackKey,
                          knowledgeDepth: profile.knowledgeDepth,
                          terminology: profile.terminology,
                          roleSummary: profile.roleSummary,
                          expertisePrompt: profile.expertisePrompt,
                          domainGuidance: profile.domainGuidance,
                          requiredSkills: profile.requiredSkills,
                          toolsAndSystems: profile.toolsAndSystems,
                          generationSource: profile.generationSource,
                      }
                    : null,
            },
        });
    } catch (error: any) {
        console.error('❌ GET /interview-blueprints error:', error?.message || error);
        return res.status(500).json({
            success: false,
            message: 'Failed to load interview blueprint',
            error: error?.message,
        });
    }
});

export default router;
