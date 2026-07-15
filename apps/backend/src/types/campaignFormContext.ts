import type { CampaignFormBinding, EvaluationRubricItem } from '../shared/formTemplates/types.js';

/** Minimal campaign shape for public form flows (lean documents). */
export interface CampaignFormContext {
    campaignId: string;
    organizationId?: string;
    createdByClerkUserId?: string;
    status?: 'active' | 'closed';
    criteria?: Record<string, unknown>;
    formBinding?: CampaignFormBinding;
    evaluationRubric?: EvaluationRubricItem[];
    rubricVersion?: number;
    rubricSnapshotHash?: string;
    publicApplicationToken?: string;
    applicationsCloseAt?: Date | null;
    firstCandidateAt?: Date | null;
}
