import { fillI18nTemplate } from './i18nTemplate.js';
import { resolveCompanyFromMeta } from './screeningCampaigns.js';

/** Hiring / advertising company shown in share messages. */
export function resolveShareAdvertisingCompany(candidate, campaignGroup, metaByCampaignId) {
    const fromGroup = (campaignGroup?.company || '').trim();
    if (fromGroup) return fromGroup;
    const campId = candidate?.campaignId;
    if (campId && metaByCampaignId?.[campId]) {
        const fromMeta = resolveCompanyFromMeta(metaByCampaignId[campId]);
        if (fromMeta) return fromMeta;
    }
    return (
        candidate?.company_applied_to ||
        candidate?.companyAppliedTo ||
        ''
    ).trim();
}

/** Suffix for navigator share text, e.g. " — Acme Corp". Empty when no company. */
export function buildShareCompanyPart(t, company) {
    const trimmed = (company || '').trim();
    if (!trimmed) return '';
    return fillI18nTemplate(t('shareInterview_companyPart'), { company: trimmed });
}

/** Optional multiline block for clipboard share bodies. Empty when no company. */
export function buildShareCompanyLine(t, company) {
    const trimmed = (company || '').trim();
    if (!trimmed) return '';
    return fillI18nTemplate(t('shareInterview_companyLine'), { company: trimmed });
}
