import type { CampaignCompareStage } from './campaignCompareCallbackAuth.js';

export const STAGE1_DECISION_ACTIONS = [
    'Proceed to Voice Interview',
    'Keep as Backup',
    'Proceed with condition',
    'Human Review',
    'Do Not Progress',
] as const;

export const STAGE2_DECISION_ACTIONS = [
    'Proceed to Video Interview',
    'Keep as Backup',
    'Proceed with condition',
    'Human Review',
    'Do Not Progress',
] as const;

export const STAGE3_DECISION_ACTIONS = [
    'Prioritize for Hiring Decision',
    'Keep as Alternative',
    'Proceed with condition',
    'Human Review Required',
    'Do Not Prioritize',
] as const;

const BY_STAGE: Record<CampaignCompareStage, readonly string[]> = {
    stage1: STAGE1_DECISION_ACTIONS,
    stage2: STAGE2_DECISION_ACTIONS,
    stage3: STAGE3_DECISION_ACTIONS,
};

export function sanitizeDecisionAction(
    stage: CampaignCompareStage,
    raw: unknown
): string | undefined {
    const s = String(raw ?? '').trim();
    if (!s) return undefined;
    const allowed = BY_STAGE[stage];
    if (allowed.includes(s)) return s;
    return undefined;
}

export function sanitizeDataQuality(raw: unknown): 'High' | 'Medium' | 'Low' | undefined {
    const s = String(raw ?? '').trim();
    if (s === 'High' || s === 'Medium' || s === 'Low') return s;
    return undefined;
}
