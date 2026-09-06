import { createHash } from 'crypto';
import mongoose from 'mongoose';
import Candidate, { type ICandidate } from '../models/Candidate.js';
import CandidateApplication, {
    type ICandidateApplication,
} from '../models/CandidateApplication.js';
import RecruitmentCampaign from '../models/RecruitmentCampaign.js';
import { stableJson } from '../services/webhookIdempotency.js';
import type { CampaignCompareStage } from '../services/campaignCompareCallbackAuth.js';
import { isApplicationOwnsCampaignStateEnabled } from '../config/applicationOwnership.js';

const MAX_TOP_N = 10;
const DEFAULT_TOP_N = 5;
const MAX_TEXT = 2000;
const MAX_SHORT = 1500;
const MAX_LIST_ITEMS = 8;

export class CampaignComparePoolError extends Error {
    readonly statusCode: number;
    readonly code: string;

    constructor(statusCode: number, code: string, message: string) {
        super(message);
        this.name = 'CampaignComparePoolError';
        this.statusCode = statusCode;
        this.code = code;
    }
}

function truncateText(value: unknown, max: number): string {
    const s = value == null ? '' : String(value).trim();
    if (!s) return '';
    return s.length > max ? s.slice(0, max) : s;
}

function truncateList(value: unknown, maxItems: number): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((x) => String(x ?? '').trim())
        .filter(Boolean)
        .slice(0, maxItems);
}

function isValidObjectId(id: string): boolean {
    return mongoose.Types.ObjectId.isValid(id) && /^[a-fA-F0-9]{24}$/.test(id);
}

function parseTopN(raw: unknown): number {
    if (raw === undefined || raw === null || raw === '') return DEFAULT_TOP_N;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) {
        throw new CampaignComparePoolError(400, 'invalid_topn', 'topN must be a positive integer');
    }
    return Math.min(Math.floor(n), MAX_TOP_N);
}

export interface Stage1PoolItem {
    candidateId: string;
    candidateName: string;
    positionAppliedFor: string;
    overallScore: number;
    recommendation: string;
    summary: string;
    strengths: string[];
    weaknesses: string[];
    fitForRole: string;
    finalHrEvaluation: string;
    eligibility?: Array<{
        rubricItemId: string;
        result: string;
        confidence?: string;
    }>;
    applicationId?: string;
}

export interface Stage2PoolItem {
    candidateId: string;
    candidateName: string;
    overallScore: number;
    recommendation: string;
    summary: string;
    strengths: string[];
    weaknesses: string[];
    communication: string | number;
    languageFluency: string;
    confidence: string;
    problemSolving: string | number;
    digitalSkills: string;
    professionalAttitude: string;
    finalHrEvaluation: string;
    dataCompleteness?: 'High' | 'Medium' | 'Low';
    notAssessedDimensions?: string[];
    applicationId?: string;
}

export interface Stage3PoolItem {
    candidateId: string;
    candidateName: string;
    overallScore: number;
    recommendation: string;
    summary: string;
    roleUnderstanding: number | null;
    professionalDepth: number | null;
    problemHandling: number | null;
    decisionMaking: number | null;
    prioritization: number | null;
    processThinking: number | null;
    responsibility: number | null;
    learningAbility: number | null;
    jobReadiness: number | null;
    finalRoleFit: number | null;
    competencyScores?: Array<{
        competencyKey: string;
        title?: string;
        score: number | null;
        status: 'assessed' | 'not_assessed';
        required?: boolean;
        importance?: string;
        evidence?: string[];
        redFlags?: string[];
    }>;
    applicationId?: string;
}

export type CampaignComparePoolItem = Stage1PoolItem | Stage2PoolItem | Stage3PoolItem;

export interface BuiltCampaignComparePool {
    campaignId: string;
    compareStage: CampaignCompareStage;
    topN: number;
    criteria: Record<string, unknown>;
    candidateIds: string[];
    candidatePool: CampaignComparePoolItem[];
    candidateSnapshotHash: string;
}

/** صف مقارنة: Application + هوية الشخص المدمجة. */
type CompareRow = {
    personId: string;
    applicationId: string;
    applicationMongoId: string;
    full_name: string;
    position_applied_for?: string;
    writtenInterviewEvaluation?: ICandidate['writtenInterviewEvaluation'];
    voiceInterviewEvaluation?: ICandidate['voiceInterviewEvaluation'];
    videoInterviewEvaluation?: ICandidate['videoInterviewEvaluation'];
};

function scoreFromWritten(c: CompareRow): number {
    return Number(c.writtenInterviewEvaluation?.overall_score ?? 0);
}

function scoreFromVoice(c: CompareRow): number {
    return Number(c.voiceInterviewEvaluation?.overall_score ?? 0);
}

function scoreFromVideo(c: CompareRow): number {
    return Number(c.videoInterviewEvaluation?.overall_score ?? 0);
}

function buildStage1Item(c: CompareRow): Stage1PoolItem {
    const w = c.writtenInterviewEvaluation!;
    const eligibility = Array.isArray(w.rubricResults)
        ? w.rubricResults.slice(0, MAX_LIST_ITEMS).map((row) => ({
              rubricItemId: String(row.rubricItemId ?? ''),
              result: String(row.result ?? ''),
              confidence: row.confidence,
          }))
        : undefined;
    return {
        candidateId: c.personId,
        applicationId: c.applicationId,
        candidateName: truncateText(c.full_name, 200),
        positionAppliedFor: truncateText(c.position_applied_for, 200),
        overallScore: Number(w.overall_score),
        recommendation: String(w.recommendation),
        summary: truncateText(w.summary, MAX_TEXT),
        strengths: truncateList(w.strengths, MAX_LIST_ITEMS),
        weaknesses: truncateList(w.weaknesses, MAX_LIST_ITEMS),
        fitForRole: truncateText(w.fit_for_role, MAX_SHORT),
        finalHrEvaluation: truncateText(w.final_hr_evaluation, MAX_SHORT),
        eligibility: eligibility?.length ? eligibility : undefined,
    };
}

function isEmptyDimension(v: unknown): boolean {
    if (v === undefined || v === null) return true;
    return String(v).trim() === '';
}

function buildStage2Item(c: CompareRow): Stage2PoolItem {
    const v = c.voiceInterviewEvaluation!;
    const dims: Array<[string, unknown]> = [
        ['communication', v.communication],
        ['languageFluency', v.language_fluency],
        ['confidence', v.confidence],
        ['problemSolving', v.problem_solving],
        ['digitalSkills', v.digital_skills],
        ['professionalAttitude', v.professional_attitude],
    ];
    const notAssessedDimensions = dims.filter(([, val]) => isEmptyDimension(val)).map(([k]) => k);
    const missing = notAssessedDimensions.length;
    const dataCompleteness: 'High' | 'Medium' | 'Low' =
        missing === 0 ? 'High' : missing <= 2 ? 'Medium' : 'Low';
    return {
        candidateId: c.personId,
        applicationId: c.applicationId,
        candidateName: truncateText(c.full_name, 200),
        overallScore: Number(v.overall_score),
        recommendation: String(v.recommendation),
        summary: truncateText(v.summary, MAX_TEXT),
        strengths: truncateList(v.strengths, MAX_LIST_ITEMS),
        weaknesses: truncateList(v.weaknesses, MAX_LIST_ITEMS),
        communication: v.communication ?? '',
        languageFluency: truncateText(v.language_fluency, 200),
        confidence: truncateText(v.confidence, 200),
        problemSolving: v.problem_solving ?? '',
        digitalSkills: truncateText(v.digital_skills, 200),
        professionalAttitude: truncateText(v.professional_attitude, MAX_SHORT),
        finalHrEvaluation: truncateText(v.final_hr_evaluation, MAX_SHORT),
        dataCompleteness,
        notAssessedDimensions: notAssessedDimensions.length ? notAssessedDimensions : undefined,
    };
}

function numOrNull(v: unknown): number | null {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function mapCompetencyScore(row: {
    competencyKey?: string;
    title?: string;
    score?: number;
    priority?: string;
    importance?: string;
    required?: boolean;
    evidence?: string[];
    redFlags?: string[];
}): NonNullable<Stage3PoolItem['competencyScores']>[number] {
    const n = numOrNull(row.score);
    const assessed = n != null;
    const priority = String(row.priority || row.importance || '').trim();
    const required =
        row.required === true || /^(required|critical|must)$/i.test(priority);
    return {
        competencyKey: String(row.competencyKey ?? ''),
        title: truncateText(row.title, 200),
        score: assessed ? n : null,
        status: assessed ? 'assessed' : 'not_assessed',
        required: required || undefined,
        importance: priority || undefined,
        evidence: truncateList(row.evidence, MAX_LIST_ITEMS),
        redFlags: truncateList(row.redFlags, MAX_LIST_ITEMS),
    };
}

function buildStage3Item(c: CompareRow): Stage3PoolItem {
    const v = c.videoInterviewEvaluation!;
    return {
        candidateId: c.personId,
        applicationId: c.applicationId,
        candidateName: truncateText(c.full_name, 200),
        overallScore: Number(v.overall_score),
        recommendation: String(v.recommendation),
        summary: truncateText(v.summary, MAX_TEXT),
        roleUnderstanding: numOrNull(v.role_understanding),
        professionalDepth: numOrNull(v.professional_depth),
        problemHandling: numOrNull(v.problem_handling),
        decisionMaking: numOrNull(v.decision_making),
        prioritization: numOrNull(v.prioritization),
        processThinking: numOrNull(v.process_thinking),
        responsibility: numOrNull(v.responsibility),
        learningAbility: numOrNull(v.learning_ability),
        jobReadiness: numOrNull(v.job_readiness),
        finalRoleFit: numOrNull(v.final_role_fit),
        competencyScores: Array.isArray(v.competencyScores)
            ? v.competencyScores.slice(0, MAX_LIST_ITEMS).map((row) =>
                  mapCompetencyScore(row as Parameters<typeof mapCompetencyScore>[0])
              )
            : undefined,
    };
}

async function loadEligibleFromApplications(
    compareStage: CampaignCompareStage,
    campaignId: string,
    organizationId: string
): Promise<CompareRow[]> {
    const base: Record<string, unknown> = {
        campaignId,
        organizationId,
        deletedAt: null,
    };
    let filter: Record<string, unknown>;
    if (compareStage === 'stage1') {
        filter = {
            ...base,
            'writtenInterviewEvaluation.recommendation': { $in: ['Hire', 'Consider'] },
            'writtenInterviewEvaluation.overall_score': { $exists: true },
        };
    } else if (compareStage === 'stage2') {
        filter = {
            ...base,
            'voiceInterviewEvaluation.recommendation': { $in: ['Hire', 'Consider'] },
            'voiceInterviewEvaluation.overall_score': { $exists: true },
        };
    } else {
        filter = {
            ...base,
            'videoInterviewEvaluation.recommendation': { $in: ['Hire', 'Consider'] },
            'videoInterviewEvaluation.overall_score': { $exists: true },
        };
    }

    const apps = (await CandidateApplication.find(filter).lean()) as unknown as ICandidateApplication[];
    if (!apps.length) {
        /* The legacy fallback used to run here, and its trigger was wrong in a
           way that mattered: `apps` is empty when nobody has a QUALIFYING
           evaluation, not only when no applications exist. So a campaign whose
           candidates simply had not been evaluated yet fell through to a query
           over Candidate.campaignId — which holds only a person's LATEST
           campaign, ignores deletedAt, ignores the hidden-from-stages filter,
           and returned the person's id dressed as applicationMongoId. The
           comparison then ranked people from another campaign.

           An empty pool is the honest answer: nobody here is eligible yet. */
        if (isApplicationOwnsCampaignStateEnabled()) return [];
        // توافق: مرشحون قدامى بلا Application rows بعد
        return loadEligibleLegacyCandidates(compareStage, campaignId, organizationId);
    }

    // The person is queried for the name and nothing else. It used to carry the
    // position too, which then beat the application's own — correct — value on
    // the very row that owns it. The narrowed select keeps that from returning.
    const personIds = [...new Set(apps.map((a) => String(a.candidateId)))];
    const people = await Candidate.find({ _id: { $in: personIds } })
        .select('full_name')
        .lean();
    const byId = new Map(people.map((p) => [String(p._id), p]));

    return apps.map((a) => {
        const p = byId.get(String(a.candidateId));
        const snap = (a.applicationSnapshot || {}) as Record<string, unknown>;
        return {
            personId: String(a.candidateId),
            applicationId: a.applicationId,
            applicationMongoId: String(a._id),
            full_name: String((p as any)?.full_name || snap.full_name || ''),
            position_applied_for: String(
                a.position_applied_for || snap.position_applied_for || ''
            ),
            writtenInterviewEvaluation: a.writtenInterviewEvaluation as CompareRow['writtenInterviewEvaluation'],
            voiceInterviewEvaluation: a.voiceInterviewEvaluation as CompareRow['voiceInterviewEvaluation'],
            videoInterviewEvaluation: a.videoInterviewEvaluation as CompareRow['videoInterviewEvaluation'],
        };
    });
}

async function loadEligibleLegacyCandidates(
    compareStage: CampaignCompareStage,
    campaignId: string,
    organizationId: string
): Promise<CompareRow[]> {
    const base = { campaignId, organizationId };
    let candidates: ICandidate[];
    if (compareStage === 'stage1') {
        candidates = await Candidate.find({
            ...base,
            'writtenInterviewEvaluation.recommendation': { $in: ['Hire', 'Consider'] },
            'writtenInterviewEvaluation.overall_score': { $exists: true },
        }).exec();
    } else if (compareStage === 'stage2') {
        candidates = await Candidate.find({
            ...base,
            'voiceInterviewEvaluation.recommendation': { $in: ['Hire', 'Consider'] },
            'voiceInterviewEvaluation.overall_score': { $exists: true },
        }).exec();
    } else {
        candidates = await Candidate.find({
            ...base,
            'videoInterviewEvaluation.recommendation': { $in: ['Hire', 'Consider'] },
            'videoInterviewEvaluation.overall_score': { $exists: true },
        }).exec();
    }
    return candidates.map((c) => ({
        personId: String(c._id),
        applicationId: '',
        applicationMongoId: String(c._id),
        full_name: c.full_name || '',
        position_applied_for: c.position_applied_for,
        writtenInterviewEvaluation: c.writtenInterviewEvaluation,
        voiceInterviewEvaluation: c.voiceInterviewEvaluation,
        videoInterviewEvaluation: c.videoInterviewEvaluation,
    }));
}

function scoreForStage(c: CompareRow, compareStage: CampaignCompareStage): number {
    if (compareStage === 'stage1') return scoreFromWritten(c);
    if (compareStage === 'stage2') return scoreFromVoice(c);
    return scoreFromVideo(c);
}

function buildItemForStage(c: CompareRow, compareStage: CampaignCompareStage): CampaignComparePoolItem {
    if (compareStage === 'stage1') return buildStage1Item(c);
    if (compareStage === 'stage2') return buildStage2Item(c);
    return buildStage3Item(c);
}

export async function buildCampaignComparePool(input: {
    compareStage: CampaignCompareStage;
    campaignId: string;
    organizationId: string;
    topN?: unknown;
    candidateIds?: unknown;
    criteriaOverride?: unknown;
}): Promise<BuiltCampaignComparePool> {
    const campaignId = String(input.campaignId ?? '').trim();
    const organizationId = String(input.organizationId ?? '').trim();
    if (!campaignId) {
        throw new CampaignComparePoolError(400, 'campaign_id_required', 'campaignId is required');
    }
    if (!organizationId) {
        throw new CampaignComparePoolError(400, 'organization_id_required', 'organizationId is required');
    }

    const campaign = await RecruitmentCampaign.findOne({ campaignId, organizationId }).lean();
    if (!campaign) {
        throw new CampaignComparePoolError(404, 'campaign_not_found', 'Campaign not found');
    }

    const topN = parseTopN(input.topN);
    const criteriaBase =
        campaign.criteria && typeof campaign.criteria === 'object' && !Array.isArray(campaign.criteria)
            ? { ...(campaign.criteria as Record<string, unknown>) }
            : {};
    const criteriaOverride =
        input.criteriaOverride &&
        typeof input.criteriaOverride === 'object' &&
        !Array.isArray(input.criteriaOverride)
            ? (input.criteriaOverride as Record<string, unknown>)
            : {};
    const criteria = { ...criteriaBase, ...criteriaOverride };

    const eligible = await loadEligibleFromApplications(input.compareStage, campaignId, organizationId);
    // مفاتيح التصفية: personId أو applicationMongoId أو applicationId العام
    const eligibleByKey = new Map<string, CompareRow>();
    for (const row of eligible) {
        eligibleByKey.set(row.personId, row);
        if (row.applicationMongoId) eligibleByKey.set(row.applicationMongoId, row);
        if (row.applicationId) eligibleByKey.set(row.applicationId, row);
    }

    let filterIds: string[] | null = null;
    if (input.candidateIds !== undefined && input.candidateIds !== null) {
        if (!Array.isArray(input.candidateIds)) {
            throw new CampaignComparePoolError(400, 'invalid_candidate_ids', 'candidateIds must be an array');
        }
        filterIds = [];
        for (const raw of input.candidateIds) {
            const id = String(raw ?? '').trim();
            if (!id) continue;
            const row = eligibleByKey.get(id);
            if (!row) {
                if (!isValidObjectId(id) && !/^[a-fA-F0-9]{16,}$/.test(id)) {
                    throw new CampaignComparePoolError(400, 'invalid_candidate_ids', 'Malformed candidate ID');
                }
                throw new CampaignComparePoolError(
                    400,
                    'invalid_candidate_ids',
                    'candidateIds must belong to the eligible campaign pool'
                );
            }
            filterIds.push(row.personId);
        }
    }

    let poolCandidates = eligible;
    if (filterIds) {
        const idSet = new Set(filterIds);
        poolCandidates = eligible.filter((c) => idSet.has(c.personId));
    }

    poolCandidates.sort((a, b) => scoreForStage(b, input.compareStage) - scoreForStage(a, input.compareStage));
    poolCandidates = poolCandidates.slice(0, topN);

    if (poolCandidates.length === 0) {
        throw new CampaignComparePoolError(
            400,
            'empty_eligible_pool',
            'No eligible candidates found for this campaign'
        );
    }

    const candidatePool = poolCandidates.map((c) => buildItemForStage(c, input.compareStage));
    const candidateIds = candidatePool.map((p) => p.candidateId);
    const candidateSnapshotHash = createHash('sha256')
        .update(
            stableJson({
                compareStage: input.compareStage,
                campaignId,
                candidateIds,
                candidatePool,
            })
        )
        .digest('hex');

    return {
        campaignId,
        compareStage: input.compareStage,
        topN,
        criteria,
        candidateIds,
        candidatePool,
        candidateSnapshotHash,
    };
}

export function computeCampaignCompareSnapshotHash(
    compareStage: CampaignCompareStage,
    campaignId: string,
    candidateIds: string[],
    candidatePool: CampaignComparePoolItem[]
): string {
    return createHash('sha256')
        .update(stableJson({ compareStage, campaignId, candidateIds, candidatePool }))
        .digest('hex');
}
