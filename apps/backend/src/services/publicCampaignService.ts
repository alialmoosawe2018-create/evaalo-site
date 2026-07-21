import RecruitmentCampaign from '../models/RecruitmentCampaign.js';
import { resolveLegacyFormBinding, toPublicFormConfig } from './formTemplateService.js';
import type { CampaignFormBinding } from '../shared/formTemplates/types.js';
import type { CampaignFormContext } from '../types/campaignFormContext.js';

export class PublicCampaignNotFoundError extends Error {
    readonly statusCode = 404;
    constructor() {
        super('Campaign not found');
        this.name = 'PublicCampaignNotFoundError';
    }
}

export class PublicCampaignClosedError extends Error {
    readonly statusCode = 410;
    constructor(message = 'This campaign is no longer accepting applications') {
        super(message);
        this.name = 'PublicCampaignClosedError';
    }
}

export function resolveCampaignFormBinding(campaign: CampaignFormContext): CampaignFormBinding {
    if (campaign.formBinding && typeof campaign.formBinding === 'object') {
        return campaign.formBinding as CampaignFormBinding;
    }
    return resolveLegacyFormBinding();
}

/**
 * Form binding for POST /api/candidates.
 * Public voice/video screening sends only name/email/phone — do not fall back to the
 * legacy full application template when the campaign has no stored formBinding.
 */
export function resolveCampaignFormBindingForCandidateSubmit(
    campaign: CampaignFormContext,
    options: { sourceType?: string } = {}
): CampaignFormBinding | null {
    if (campaign.formBinding && typeof campaign.formBinding === 'object') {
        return campaign.formBinding as CampaignFormBinding;
    }
    const src = (options.sourceType || '').trim().toLowerCase();
    if (src === 'public_screening') {
        return null;
    }
    return resolveLegacyFormBinding();
}

export function assertCampaignAcceptsApplications(campaign: CampaignFormContext): void {
    if (campaign.status === 'closed') {
        throw new PublicCampaignClosedError();
    }
    if (campaign.applicationsCloseAt && campaign.applicationsCloseAt.getTime() < Date.now()) {
        throw new PublicCampaignClosedError('Application deadline has passed');
    }
}

export async function findCampaignByPublicToken(pubToken: string) {
    const token = pubToken.trim();
    if (!token.startsWith('pub_')) return null;
    return RecruitmentCampaign.findOne({ publicApplicationToken: token }).lean();
}

export async function findCampaignByInternalId(campaignId: string) {
    return RecruitmentCampaign.findOne({ campaignId: campaignId.trim() }).lean();
}

export async function getPublicFormConfigByToken(pubToken: string) {
    const campaign = await findCampaignByPublicToken(pubToken);
    if (!campaign) throw new PublicCampaignNotFoundError();
    assertCampaignAcceptsApplications(campaign as CampaignFormContext);
    const binding = resolveCampaignFormBinding(campaign as CampaignFormContext);
    const criteria = (campaign.criteria || {}) as Record<string, unknown>;
    const positionTitle =
        (typeof criteria.position === 'string' && criteria.position.trim()) ||
        (typeof criteria.job === 'string' && criteria.job.trim()) ||
        'Open Position';
    return {
        publicCampaignId: campaign.publicApplicationToken!,
        positionTitle,
        status: campaign.status === 'closed' ? 'closed' as const : 'active' as const,
        form: toPublicFormConfig(binding),
    };
}

export async function markFirstCandidateIfNeeded(campaignId: string): Promise<void> {
    await RecruitmentCampaign.updateOne(
        { campaignId, firstCandidateAt: null },
        { $set: { firstCandidateAt: new Date() } }
    );
}

export function isCampaignSchemaLocked(campaign: Pick<CampaignFormContext, 'firstCandidateAt'>): boolean {
    return Boolean(campaign.firstCandidateAt);
}
