/**
 * Dev-only: move legacy shared org_default data into dev_org_<userId>.
 * Preserves per-user isolation — does not run in production.
 */

import type { Model } from 'mongoose';
import {
    DEFAULT_ORG_ID,
    SYSTEM_ACTOR_ID,
    devOrgIdForUser,
    isDevOrgIsolationEnabled,
} from '../config/multiTenant.js';
import Candidate from '../models/Candidate.js';
import RecruitmentCampaign from '../models/RecruitmentCampaign.js';
import VideoInterviewSession from '../models/VideoInterviewSession.js';
import InterviewBlueprint from '../models/InterviewBlueprint.js';
import JobExpertiseProfile from '../models/JobExpertiseProfile.js';
import CampaignCompareRequest from '../models/CampaignCompareRequest.js';
import HeadHunterSourcingContext from '../models/HeadHunterSourcingContext.js';
import HeadHunterContactReveal from '../models/HeadHunterContactReveal.js';
import CreditBalance from '../models/CreditBalance.js';
import OrgPlanState from '../models/OrgPlanState.js';
import CreditLedger from '../models/CreditLedger.js';
import UsageReservation from '../models/UsageReservation.js';
import Stage1EvaluationOutbox from '../models/Stage1EvaluationOutbox.js';
import OrgIntegration from '../models/OrgIntegration.js';

export interface DevOrgMigrationResult {
    ok: boolean;
    targetOrgId: string;
    skipped: boolean;
    reason?: string;
    collections: Array<{ collection: string; matched: number; modified: number }>;
    totalModified: number;
}

function canRunDevOrgMigration(): boolean {
    return process.env.NODE_ENV !== 'production' && isDevOrgIsolationEnabled();
}

/** Documents created before per-user dev orgs (system actor or missing creator). */
function legacyCreatorFilter(userId: string, creatorField = 'createdByClerkUserId') {
    return {
        $or: [
            { [creatorField]: userId },
            { [creatorField]: SYSTEM_ACTOR_ID },
            { [creatorField]: { $exists: false } },
            { [creatorField]: null },
            { [creatorField]: '' },
        ],
    };
}

async function migrateSimpleCollection(
    model: Model<any>,
    collection: string,
    targetOrgId: string,
    userId: string,
    creatorField = 'createdByClerkUserId'
): Promise<{ collection: string; matched: number; modified: number }> {
    const filter = {
        organizationId: DEFAULT_ORG_ID,
        ...legacyCreatorFilter(userId, creatorField),
    };
    const matched = await model.countDocuments(filter);
    if (matched === 0) {
        return { collection, matched: 0, modified: 0 };
    }

    const result = await model.updateMany(filter, {
        $set: {
            organizationId: targetOrgId,
            ...(creatorField
                ? {
                      [creatorField]: userId,
                  }
                : {}),
        },
    });

    return {
        collection,
        matched,
        modified: result.modifiedCount ?? 0,
    };
}

/** Unique per org — only move if target org has no row yet. */
async function migrateUniqueOrgRow(
    model: Model<any>,
    collection: string,
    targetOrgId: string
): Promise<{ collection: string; matched: number; modified: number }> {
    const existingTarget = await model.countDocuments({ organizationId: targetOrgId });
    if (existingTarget > 0) {
        return { collection, matched: 0, modified: 0 };
    }

    const source = await model.findOne({ organizationId: DEFAULT_ORG_ID }).lean();
    if (!source) {
        return { collection, matched: 0, modified: 0 };
    }

    const result = await model.updateOne(
        { organizationId: DEFAULT_ORG_ID },
        { $set: { organizationId: targetOrgId } }
    );

    return {
        collection,
        matched: 1,
        modified: result.modifiedCount ?? 0,
    };
}

async function migrateCompareRequests(
    targetOrgId: string,
    userId: string
): Promise<{ collection: string; matched: number; modified: number }> {
    const filter = {
        organizationId: DEFAULT_ORG_ID,
        $or: [
            { requestedBy: userId },
            { requestedBy: SYSTEM_ACTOR_ID },
            { requestedBy: { $exists: false } },
            { requestedBy: null },
            { requestedBy: '' },
        ],
    };
    const matched = await CampaignCompareRequest.countDocuments(filter);
    if (matched === 0) {
        return { collection: 'campaigncomparerequests', matched: 0, modified: 0 };
    }
    const result = await CampaignCompareRequest.updateMany(filter, {
        $set: { organizationId: targetOrgId, requestedBy: userId },
    });
    return {
        collection: 'campaigncomparerequests',
        matched,
        modified: result.modifiedCount ?? 0,
    };
}

/**
 * Move legacy org_default tenant data into the signed-in user's dev org.
 * Safe for multi-account dev: only rows owned by the user or legacy system actor.
 */
export async function migrateOrgDefaultToDevOrg(userId: string): Promise<DevOrgMigrationResult> {
    const targetOrgId = devOrgIdForUser(userId);

    if (!canRunDevOrgMigration()) {
        return {
            ok: false,
            targetOrgId,
            skipped: true,
            reason: 'dev_org_migration_not_enabled',
            collections: [],
            totalModified: 0,
        };
    }

    if (!userId || userId === SYSTEM_ACTOR_ID) {
        return {
            ok: false,
            targetOrgId,
            skipped: true,
            reason: 'missing_user_id',
            collections: [],
            totalModified: 0,
        };
    }

    const collections: DevOrgMigrationResult['collections'] = [];

    collections.push(
        await migrateSimpleCollection(RecruitmentCampaign, 'recruitmentcampaigns', targetOrgId, userId)
    );
    collections.push(await migrateSimpleCollection(Candidate, 'candidates', targetOrgId, userId));
    collections.push(
        await migrateSimpleCollection(VideoInterviewSession, 'video_interview_sessions', targetOrgId, userId)
    );
    collections.push(
        await migrateSimpleCollection(InterviewBlueprint, 'interviewblueprints', targetOrgId, userId)
    );
    collections.push(
        await migrateSimpleCollection(JobExpertiseProfile, 'jobexpertiseprofiles', targetOrgId, userId)
    );
    collections.push(await migrateCompareRequests(targetOrgId, userId));
    collections.push(
        await migrateSimpleCollection(
            HeadHunterSourcingContext,
            'headhuntersourcingcontexts',
            targetOrgId,
            userId
        )
    );
    collections.push(
        await migrateSimpleCollection(
            HeadHunterContactReveal,
            'headhuntercontactreveals',
            targetOrgId,
            userId
        )
    );
    collections.push(
        await migrateSimpleCollection(Stage1EvaluationOutbox, 'stage1evaluationoutboxes', targetOrgId, userId)
    );
    collections.push(
        await migrateSimpleCollection(OrgIntegration, 'orgintegrations', targetOrgId, userId)
    );
    collections.push(await migrateSimpleCollection(CreditLedger, 'creditledgers', targetOrgId, userId));
    collections.push(
        await migrateSimpleCollection(UsageReservation, 'usagereservations', targetOrgId, userId)
    );
    collections.push(await migrateUniqueOrgRow(CreditBalance, 'creditbalances', targetOrgId));
    collections.push(await migrateUniqueOrgRow(OrgPlanState, 'orgplanstates', targetOrgId));

    const totalModified = collections.reduce((sum, row) => sum + row.modified, 0);

    return {
        ok: true,
        targetOrgId,
        skipped: false,
        collections,
        totalModified,
    };
}
