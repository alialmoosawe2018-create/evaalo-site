import { canonicalStageRecommendation, hasMeaningfulStageEvaluation } from './stageRecommendation.js';

/** Sentinel for drill-down into candidates without campaignId */
export const SCREENING_UNCATEGORIZED_KEY = '__uncategorized__';

export function isScreeningCandidate(c) {
    const entry = c?.entryStage;
    return !entry || entry === 'screening';
}

/** هل أُخفيت بطاقة هذا المرشح من قائمة المرحلة المحددة (إخفاء فقط، البيانات باقية). */
export function isHiddenFromStage(c, stage) {
    const list = c?.hiddenFromStages;
    return Array.isArray(list) && list.includes(stage);
}

export function splitScreeningCandidates(allCandidates) {
    const evaluated = [];
    const pending = [];
    for (const c of allCandidates) {
        if (isHiddenFromStage(c, 'screening')) continue;
        if (hasMeaningfulStageEvaluation(c.writtenInterviewEvaluation)) {
            evaluated.push(c);
        } else if (isScreeningCandidate(c) && Array.isArray(c.files) && c.files.length > 0) {
            pending.push(c);
        }
    }
    return { evaluated, pending };
}

function campaignKeyFromCandidate(c) {
    const id = c?.campaignId;
    if (id == null || String(id).trim() === '') return null;
    return String(id).trim();
}

function countRecommendations(evaluated) {
    let hireCount = 0;
    let considerCount = 0;
    let rejectCount = 0;
    let naCount = 0;
    for (const c of evaluated) {
        const rec = canonicalStageRecommendation(c.writtenInterviewEvaluation?.recommendation);
        if (rec === 'Hire') hireCount += 1;
        else if (rec === 'Consider') considerCount += 1;
        else if (rec === 'Reject') rejectCount += 1;
        else naCount += 1;
    }
    return { hireCount, considerCount, rejectCount, naCount };
}

function latestActivityAt(candidates) {
    let max = 0;
    for (const c of candidates) {
        const raw = c.updatedAt || c.createdAt;
        if (!raw) continue;
        const t = new Date(raw).getTime();
        if (Number.isFinite(t) && t > max) max = t;
    }
    return max > 0 ? new Date(max) : null;
}

function modePosition(candidates) {
    const counts = new Map();
    for (const c of candidates) {
        const p = (c.position_applied_for || c.positionAppliedFor || '').trim();
        if (!p) continue;
        counts.set(p, (counts.get(p) || 0) + 1);
    }
    let best = '';
    let bestN = 0;
    for (const [p, n] of counts) {
        if (n > bestN) {
            best = p;
            bestN = n;
        }
    }
    return best;
}

function resolveLocationFromMeta(meta) {
    const criteria = meta?.criteria;
    if (!criteria || typeof criteria !== 'object') return '';
    const loc = criteria.location || criteria.Location || criteria.city || criteria.governorate;
    return loc != null ? String(loc).trim() : '';
}

/** Advertising / hiring company from campaign job criteria. */
export function resolveCompanyFromMeta(meta) {
    const criteria = meta?.criteria;
    if (!criteria || typeof criteria !== 'object') return '';
    const co =
        criteria.company ||
        criteria.company_applied_to ||
        criteria.companyAppliedTo;
    return co != null ? String(co).trim() : '';
}

function resolveTitleFromMeta(meta) {
    if (!meta) return '';
    const criteria = meta.criteria;
    if (criteria && typeof criteria === 'object') {
        const pos = criteria.position || criteria.position_applied_for || criteria.job;
        if (pos != null && String(pos).trim()) return String(pos).trim();
    }
    if (meta.templateName && String(meta.templateName).trim()) {
        return String(meta.templateName).trim();
    }
    return '';
}

/**
 * @param {object[]} evaluated
 * @param {object[]} pending
 * @param {Record<string, object>} metaByCampaignId — from batch API
 * @param {object} labels — i18n strings for deleted/uncategorized fallbacks
 */
export function buildScreeningCampaignGroups(evaluated, pending, metaByCampaignId = {}, labels = {}) {
    const buckets = new Map();

    const ensureBucket = (key) => {
        if (!buckets.has(key)) {
            buckets.set(key, {
                campaignId: key === SCREENING_UNCATEGORIZED_KEY ? null : key,
                selectionKey: key,
                evaluated: [],
                pending: [],
            });
        }
        return buckets.get(key);
    };

    const assign = (list, field) => {
        for (const c of list) {
            const rawKey = campaignKeyFromCandidate(c);
            const key = rawKey ?? SCREENING_UNCATEGORIZED_KEY;
            ensureBucket(key)[field].push(c);
        }
    };

    assign(evaluated, 'evaluated');
    assign(pending, 'pending');

    const active = [];
    let uncategorized = null;

    for (const [key, bucket] of buckets) {
        const allInBucket = [...bucket.evaluated, ...bucket.pending];
        const recCounts = countRecommendations(bucket.evaluated);
        const pendingCount = bucket.pending.length;
        const evaluatedCount = bucket.evaluated.length;
        const totalCount = pendingCount + evaluatedCount;
        const lastActivityAt = latestActivityAt(allInBucket);

        const meta = key !== SCREENING_UNCATEGORIZED_KEY ? metaByCampaignId[key] : null;
        const isDeleted =
            key !== SCREENING_UNCATEGORIZED_KEY && !meta && totalCount > 0;
        const isUncategorized = key === SCREENING_UNCATEGORIZED_KEY;

        let title = resolveTitleFromMeta(meta) || modePosition(allInBucket);
        if (isUncategorized) {
            title = labels.uncategorized || 'Uncategorized';
        } else if (isDeleted) {
            title = labels.deleted || 'Deleted Campaign';
        } else if (!title) {
            title = labels.unknownCampaign || 'Campaign';
        }

        const location =
            resolveLocationFromMeta(meta) ||
            (allInBucket[0]?.company_applied_to || allInBucket[0]?.companyAppliedTo || '').trim() ||
            '';

        const company =
            resolveCompanyFromMeta(meta) ||
            (allInBucket[0]?.company_applied_to || allInBucket[0]?.companyAppliedTo || '').trim() ||
            '';

        const status = meta?.status === 'closed' ? 'closed' : 'active';

        const row = {
            campaignId: bucket.campaignId,
            selectionKey: key,
            title,
            location,
            company,
            isDeleted,
            isUncategorized,
            status,
            isClosed: status === 'closed',
            closedAt: meta?.closedAt ? new Date(meta.closedAt) : null,
            lastActivityAt,
            pendingCount,
            evaluatedCount,
            totalCount,
            ...recCounts,
            evaluated: bucket.evaluated,
            pending: bucket.pending,
            campaignCreatedAt: meta?.createdAt ? new Date(meta.createdAt) : null,
        };

        if (isUncategorized) uncategorized = row;
        else active.push(row);
    }

    active.sort((a, b) => {
        const ta = (a.lastActivityAt || a.campaignCreatedAt)?.getTime?.() ?? 0;
        const tb = (b.lastActivityAt || b.campaignCreatedAt)?.getTime?.() ?? 0;
        return tb - ta;
    });

    return { active, uncategorized };
}

export function findCampaignGroup(groups, selectionKey) {
    if (selectionKey === SCREENING_UNCATEGORIZED_KEY) {
        return groups.uncategorized;
    }
    return groups.active.find((g) => g.selectionKey === selectionKey) ?? null;
}

export function collectCampaignIdsFromCandidates(evaluated, pending) {
    const ids = new Set();
    for (const c of [...evaluated, ...pending]) {
        const k = campaignKeyFromCandidate(c);
        if (k) ids.add(k);
    }
    return [...ids];
}
