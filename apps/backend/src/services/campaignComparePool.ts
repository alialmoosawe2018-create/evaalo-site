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
import {
    videoInterviewEvidence,
    type InterviewEvidence,
} from '../services/videoEvaluationEvidence.js';
import { resolveCampaignEvaluationRubric } from '../services/stage1N8nPayloadBuilder.js';
import { NON_CRITERION_META_KEYS } from '../shared/formTemplates/index.js';
import type { CampaignFormContext } from '../types/campaignFormContext.js';

const MAX_TOP_N = 10;
const DEFAULT_TOP_N = 5;
const MAX_TEXT = 2000;
const MAX_SHORT = 1500;
const MAX_LIST_ITEMS = 8;
/** A campaign's criteria list is short; this only guards against a runaway one. */
const MAX_RUBRIC_ITEMS = 20;
/**
 * The requirement text repeated next to each verdict. Short on purpose: it is
 * copied per candidate per criterion (up to 20 × topN), and the untruncated
 * text is already in `rubric`. Long enough for a real requirement — the longest
 * in production is "HR professional certification (SHRM, CIPD, PHR) or
 * equivalent accredited training" at 88 characters.
 */
const MAX_EXPECTATION_IN_VERDICT = 120;

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

/**
 * One of the recruiter's own evaluation criteria, worded as they typed it when
 * the campaign was created.
 *
 * Resolved through `resolveCampaignEvaluationRubric` — the same call Stage 1
 * makes — so the comparison judges against exactly the criteria the screening
 * scored. Reading `campaign.evaluationRubric` directly is NOT equivalent: no
 * campaign in production has ever stored one, so that field is empty and the
 * rubric is derived from `criteria` on demand.
 */
export interface PoolRubricItem {
    id: string;
    label: string;
    expectation: string;
}

/**
 * Catalog plumbing that lives in `criteria` and therefore becomes a "criterion"
 * when the rubric is derived. None of it is something a candidate can meet, and
 * a report naming "does not meet roleMatchSource" would be nonsense, so it is
 * kept out of the rubric and out of the verdict list.
 */
const RUBRIC_INTERNAL_KEYS = new Set(
    [...NON_CRITERION_META_KEYS].map((k) => canonicalRubricKey(k))
);

/**
 * Protected attributes. These ARE real stored criteria — 3 of 14 production
 * campaigns set `gender`, 4 set `age` — and nothing here changes that: Stage 1
 * still scores them and the UI still shows them.
 *
 * They are kept out of the comparison payload because this block is the one
 * place that asks the model to NAME an unmet criterion, both in prose and in
 * `keyGaps`. Left in, a woman applying to a `gender: male` campaign would get
 * "does not meet gender" printed into a hiring report as a reason to reject
 * her. Excluding them here makes that impossible deterministically, instead of
 * relying on the model to be tactful.
 */
const PROTECTED_ATTRIBUTE_KEYS = new Set(['gender', 'age']);

/** Everything held out of the rubric and the per-criterion verdict list. */
const EXCLUDED_RUBRIC_KEYS = new Set([...RUBRIC_INTERNAL_KEYS, ...PROTECTED_ATTRIBUTE_KEYS]);

/**
 * Removes protected attributes from the criteria object IN PLACE, and returns
 * it for convenience.
 *
 * Separate from the rubric filter because this object travels a different road:
 * the compare prompt interpolates it verbatim as
 * `Campaign Criteria: {{ JSON.stringify($json.criteria || {}) }}`, so a stored
 * `gender: "male"` reaches the model as part of the job description even though
 * no per-candidate verdict on it is sent any more.
 *
 * Matching is on the canonical key, so `Gender` and `AGE` go too, and it is
 * exact — a criterion like `storage` or `average_handling_time` survives.
 */
export function stripProtectedAttributes(
    criteria: Record<string, unknown>
): Record<string, unknown> {
    for (const key of Object.keys(criteria)) {
        if (PROTECTED_ATTRIBUTE_KEYS.has(canonicalRubricKey(key))) delete criteria[key];
    }
    return criteria;
}

/**
 * Canonical form of a criterion key — the join key between a stored verdict and
 * the criterion it was scored against.
 *
 * Rubric ids carry a RANDOM suffix (`assignRubricId` uses `randomBytes`) and no
 * campaign stores its rubric, so a freshly derived id can never equal the one
 * saved in `rubricResults`. The middle segment of the id is the criterion key,
 * and that IS stable. Measured against production: 0/20 stored verdicts matched
 * by id, 20/20 matched by key.
 *
 * The two producers disagree on the separator — `assignRubricId` slugs with `_`
 * and truncates to 40, `normalizeRubricLabelKey` slugs with `-` — so both sides
 * are normalised here rather than compared raw.
 */
function canonicalRubricKey(raw: unknown): string {
    return String(raw ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40)
        .replace(/-+$/, '');
}

/** `preset__position__d660d64d` -> `position`. Empty when the id is not an id. */
function rubricKeyFromId(id: string): string {
    const parts = String(id ?? '').split('__');
    return parts.length >= 3 ? canonicalRubricKey(parts.slice(1, -1).join('__')) : '';
}

/**
 * How Stage 1 judged this candidate against one criterion. Stage 1 is where the
 * rubric is actually scored, so stages 2 and 3 carry the verdicts forward —
 * otherwise the later the report, the less it knows about what the job asked
 * for, and the final report would rank on interview performance alone.
 */
export interface CriteriaFitItem {
    rubricItemId: string;
    /** The criterion's wording — the id on its own is unreadable to a reader. */
    label?: string;
    /**
     * What the recruiter actually asked for, next to the verdict.
     *
     * A derived rubric's `label` is the FIELD KEY (`position`), not prose — the
     * real requirement (`Senior HR Assistant`) lives in `expectation`. Without
     * it here a report could name the gap only as "position": the requirement
     * text reached the model in `rubric`, but nothing tied it to this
     * candidate's verdict. Observed on a real run: keyGaps came back
     * ["position", "location", "industryType"].
     *
     * Kept short on purpose — the untruncated text is already in `rubric`, and
     * this copy repeats per candidate per criterion.
     */
    expectation?: string;
    result: string;
    confidence?: string;
}

/** A stage already cleared. Context for consistency, never a ranking input. */
export interface PriorStageResult {
    score: number | null;
    recommendation: string;
}

export interface PriorStages {
    screening?: PriorStageResult;
    voice?: PriorStageResult;
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
    eligibility?: CriteriaFitItem[];
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
    criteriaFit?: CriteriaFitItem[];
    priorStages?: PriorStages;
    /** False when the candidate joined at this stage via a public link. */
    screened: boolean;
    entryStage?: string;
    applicationId?: string;
}

export interface Stage3PoolItem {
    candidateId: string;
    candidateName: string;
    overallScore: number;
    recommendation: string;
    /**
     * Whether the interview measured anything. A session that ended early still
     * produces a score and a recommendation, and without this the comparison
     * ranked that number against candidates who completed their interview.
     * The comparator is told to place an `insufficient` row last and say why,
     * rather than dropping the person silently — a candidate who vanishes from
     * the report is the harder failure to notice.
     */
    interviewEvidence: InterviewEvidence;
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
    criteriaFit?: CriteriaFitItem[];
    priorStages?: PriorStages;
    /** False when the candidate joined at this stage via a public link. */
    screened: boolean;
    entryStage?: string;
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
    /** The recruiter's criteria, so the report can name what was and was not met. */
    rubric: PoolRubricItem[];
    candidateSnapshotHash: string;
}

/** صف مقارنة: Application + هوية الشخص المدمجة. */
export type CompareRow = {
    personId: string;
    applicationId: string;
    applicationMongoId: string;
    full_name: string;
    position_applied_for?: string;
    /** Where the candidate joined the pipeline: 'screening' | 'audio' | 'video'. */
    entryStage?: string;
    writtenInterviewEvaluation?: ICandidate['writtenInterviewEvaluation'];
    voiceInterviewEvaluation?: ICandidate['voiceInterviewEvaluation'];
    videoInterviewEvaluation?: ICandidate['videoInterviewEvaluation'];
};

/**
 * Whether this candidate ever went through CV screening.
 *
 * A public interview link drops an applicant straight into the voice or video
 * stage, so they have no Stage 1 evaluation and never will — 22 of 27
 * applications in production entered that way. Without this the later reports
 * cannot tell "screened and met nothing" from "never screened": both arrive as
 * an absent `criteriaFit`, and the second must not read as a shortcoming.
 */
export function wasScreened(c: CompareRow): boolean {
    return c.writtenInterviewEvaluation?.overall_score != null;
}

export interface RubricLookup {
    byId: Map<string, PoolRubricItem>;
    /** A key two criteria share maps to null: ambiguous, so nothing is labelled. */
    byKey: Map<string, PoolRubricItem | null>;
}

export function createRubricLookup(
    items: Array<PoolRubricItem & { key?: string }>
): RubricLookup {
    const byId = new Map<string, PoolRubricItem>();
    const byKey = new Map<string, PoolRubricItem | null>();
    for (const item of items) {
        const entry: PoolRubricItem = {
            id: item.id,
            label: item.label,
            expectation: item.expectation,
        };
        if (item.id) byId.set(item.id, entry);
        const key = canonicalRubricKey(item.key || item.label) || rubricKeyFromId(item.id);
        if (!key) continue;
        byKey.set(key, byKey.has(key) ? null : entry);
    }
    return { byId, byKey };
}

/** Exact id first (a stored rubric), then the stable key (a derived one). */
export function resolveRubricItem(rubric: RubricLookup, id: string): PoolRubricItem | undefined {
    return rubric.byId.get(id) ?? rubric.byKey.get(rubricKeyFromId(id)) ?? undefined;
}

/**
 * The recruiter's criteria and how Stage 1 judged this candidate against each.
 * Returns undefined when the campaign has no rubric or the candidate was never
 * screened, so the payload is unchanged for those.
 *
 * Capped at MAX_RUBRIC_ITEMS rather than MAX_LIST_ITEMS: the criteria ARE the
 * subject here, and a real campaign carries more than eight of them, so the
 * shorter cap silently dropped verdicts.
 */
export function buildCriteriaFit(c: CompareRow, rubric: RubricLookup): CriteriaFitItem[] | undefined {
    const results = c.writtenInterviewEvaluation?.rubricResults;
    if (!Array.isArray(results) || results.length === 0) return undefined;
    const out = results
        .map((row) => String(row.rubricItemId ?? ''))
        .map((id, i) => ({ id, row: results[i] }))
        .filter(({ id }) => !EXCLUDED_RUBRIC_KEYS.has(rubricKeyFromId(id)))
        .slice(0, MAX_RUBRIC_ITEMS)
        .map(({ id, row }) => {
            const item = resolveRubricItem(rubric, id);
            const expectation = item?.expectation
                ? truncateText(item.expectation, MAX_EXPECTATION_IN_VERDICT)
                : undefined;
            return {
                rubricItemId: id,
                label: item?.label ? truncateText(item.label, 200) : undefined,
                expectation: expectation || undefined,
                result: String(row.result ?? ''),
                confidence: row.confidence,
            };
        });
    return out.length ? out : undefined;
}

/**
 * Score and recommendation from the stages already behind this one. Deliberately
 * thin — a score and a verdict, not the narrative — because this is meant to
 * answer "was the candidate consistent?", not to be re-scored.
 */
export function buildPriorStages(
    c: CompareRow,
    compareStage: CampaignCompareStage
): PriorStages | undefined {
    // Screening is the first stage: nothing precedes it, and returning its own
    // result as a "prior stage" would double-report it.
    if (compareStage === 'stage1') return undefined;
    const out: PriorStages = {};
    const w = c.writtenInterviewEvaluation;
    if (w && w.overall_score != null) {
        out.screening = {
            score: numOrNull(w.overall_score),
            recommendation: String(w.recommendation ?? ''),
        };
    }
    if (compareStage === 'stage3') {
        const v = c.voiceInterviewEvaluation;
        if (v && v.overall_score != null) {
            out.voice = {
                score: numOrNull(v.overall_score),
                recommendation: String(v.recommendation ?? ''),
            };
        }
    }
    return out.screening || out.voice ? out : undefined;
}

function scoreFromWritten(c: CompareRow): number {
    return Number(c.writtenInterviewEvaluation?.overall_score ?? 0);
}

function scoreFromVoice(c: CompareRow): number {
    return Number(c.voiceInterviewEvaluation?.overall_score ?? 0);
}

function scoreFromVideo(c: CompareRow): number {
    return Number(c.videoInterviewEvaluation?.overall_score ?? 0);
}

function buildStage1Item(c: CompareRow, rubric: RubricLookup): Stage1PoolItem {
    const w = c.writtenInterviewEvaluation!;
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
        eligibility: buildCriteriaFit(c, rubric),
    };
}

function isEmptyDimension(v: unknown): boolean {
    if (v === undefined || v === null) return true;
    return String(v).trim() === '';
}

function buildStage2Item(c: CompareRow, rubric: RubricLookup): Stage2PoolItem {
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
        criteriaFit: buildCriteriaFit(c, rubric),
        priorStages: buildPriorStages(c, 'stage2'),
        screened: wasScreened(c),
        entryStage: c.entryStage || undefined,
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

function buildStage3Item(c: CompareRow, rubric: RubricLookup): Stage3PoolItem {
    const v = c.videoInterviewEvaluation!;
    return {
        candidateId: c.personId,
        applicationId: c.applicationId,
        candidateName: truncateText(c.full_name, 200),
        overallScore: Number(v.overall_score),
        recommendation: String(v.recommendation),
        interviewEvidence: videoInterviewEvidence(v as never),
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
        criteriaFit: buildCriteriaFit(c, rubric),
        priorStages: buildPriorStages(c, 'stage3'),
        screened: wasScreened(c),
        entryStage: c.entryStage || undefined,
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
            entryStage: a.entryStage ? String(a.entryStage) : undefined,
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
        entryStage: c.entryStage ? String(c.entryStage) : undefined,
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

function buildItemForStage(
    c: CompareRow,
    compareStage: CampaignCompareStage,
    rubric: RubricLookup
): CampaignComparePoolItem {
    if (compareStage === 'stage1') return buildStage1Item(c, rubric);
    if (compareStage === 'stage2') return buildStage2Item(c, rubric);
    return buildStage3Item(c, rubric);
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

    /* The prompt interpolates this object verbatim —
       `Campaign Criteria: {{ JSON.stringify($json.criteria || {}) }}` — so
       leaving gender/age here tells the model the job asks for a man aged
       25-34, and it can act on that from a name alone. They are dropped after
       the override merge so an injected override cannot smuggle them back.

       The campaign still stores them and Stage 1 still scores them; this only
       decides what the comparison model is shown. Both compare paths (v2 and
       the legacy branch in recruitmentCampaigns.ts) read this same object, and
       the stored CampaignCompareRequest.criteria records what was actually
       sent — so stripping here keeps that audit record honest rather than
       weakening it. */
    stripProtectedAttributes(criteria);

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

    // Resolved exactly the way Stage 1 resolves it, so the comparison judges
    // against the same criteria the screening scored. Going straight to
    // `campaign.evaluationRubric` looks equivalent but is not: that field is
    // empty on every campaign in production, so the rubric only exists once
    // this resolver derives it from `criteria`.
    const resolvedRubric = resolveCampaignEvaluationRubric(
        campaign as unknown as CampaignFormContext
    )
        .filter((r) => !EXCLUDED_RUBRIC_KEYS.has(canonicalRubricKey(r.key || r.label)))
        .slice(0, MAX_RUBRIC_ITEMS)
        .map((r) => ({
            id: String(r.id ?? ''),
            key: String(r.key ?? ''),
            label: truncateText(r.label, 200),
            expectation: truncateText(r.expectation, MAX_SHORT),
        }))
        .filter((r) => r.id && r.label);

    const rubricLookup = createRubricLookup(resolvedRubric);
    const rubricItems: PoolRubricItem[] = resolvedRubric.map(({ id, label, expectation }) => ({
        id,
        label,
        expectation,
    }));

    const candidatePool = poolCandidates.map((c) =>
        buildItemForStage(c, input.compareStage, rubricLookup)
    );
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
        rubric: rubricItems,
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
