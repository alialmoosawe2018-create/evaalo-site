/** مرشحون مضافون من صفحة Candidates ليظهروا في قائمة «+» في صفحة الشارت (Employees). */

import { candidatePhotoUrl } from './candidateAssets.jsx';

export const CHART_CANDIDATE_POOL_KEY = 'evaalo-org-chart-candidate-pool';

export const CHART_CANDIDATE_POOL_UPDATED = 'evaalo-org-chart-candidate-pool-updated';

function notifyPoolUpdated() {
    try {
        window.dispatchEvent(new CustomEvent(CHART_CANDIDATE_POOL_UPDATED));
    } catch (_) {
        /* ignore */
    }
}

function normalizeChartCandidateId(candidate) {
    if (!candidate) return null;
    const raw = candidate._id ?? candidate.id;
    if (raw == null || raw === '') return null;
    if (typeof raw === 'object') {
        if (typeof raw.$oid === 'string') return raw.$oid;
        if (typeof raw.toHexString === 'function') {
            try {
                return raw.toHexString();
            } catch (_) {
                /* ignore */
            }
        }
        return null;
    }
    return raw;
}

function normalizeEmp(e) {
    if (!e || e.id == null) return null;
    return {
        id: e.id,
        name: e.name ?? 'Unknown',
        position: e.position ?? 'N/A',
        ...(e.email != null && e.email !== '' ? { email: e.email } : {}),
        ...(e.photo != null && e.photo !== '' ? { photo: e.photo } : {}),
    };
}

export function loadPool() {
    try {
        const raw = localStorage.getItem(CHART_CANDIDATE_POOL_KEY);
        if (!raw) return [];
        const p = JSON.parse(raw);
        return Array.isArray(p) ? p.map((x) => normalizeEmp(x)).filter(Boolean) : [];
    } catch (_) {
        return [];
    }
}

export function savePool(list) {
    try {
        localStorage.setItem(CHART_CANDIDATE_POOL_KEY, JSON.stringify(list));
    } catch (_) {
        /* ignore */
    }
}

/** يضيف/يحدّث مرشحين؛ المضافون حديثاً يظهرون في مقدمة المصفوفة. */
export function mergeIntoPool(entries) {
    const prev = loadPool();
    const next = [];
    const seen = new Set();
    for (const e of entries) {
        const n = normalizeEmp(e);
        if (!n) continue;
        const k = String(n.id);
        if (seen.has(k)) continue;
        seen.add(k);
        next.push(n);
    }
    for (const e of prev) {
        const k = String(e.id);
        if (seen.has(k)) continue;
        seen.add(k);
        next.push(e);
    }
    savePool(next);
    notifyPoolUpdated();
}

export function removeIdsFromPoolAndSave(ids) {
    if (!ids?.length) return;
    const drop = new Set(ids.map(String));
    const next = loadPool().filter((e) => !drop.has(String(e.id)));
    savePool(next);
    notifyPoolUpdated();
}

/** pool أولاً ثم عناصر base غير المكررة (حسب id). */
export function mergeDisplayWithPool(baseList, pool) {
    const poolArr = (pool || []).filter((e) => e?.id != null);
    const seen = new Set(poolArr.map((e) => String(e.id)));
    const out = [...poolArr];
    for (const e of baseList || []) {
        if (e?.id == null) continue;
        const k = String(e.id);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(e);
    }
    return out;
}

/** نفس حقل assignEmployeeToDept في Employees (fetch qualified). */
export function candidateToChartEmp(candidate) {
    if (!candidate) return null;
    const id = normalizeChartCandidateId(candidate);
    if (id == null) return null;
    const name =
        ((candidate.full_name || candidate.fullName) || '').trim() ||
        candidate.email?.split('@')[0] ||
        'Unknown';
    return {
        id,
        name,
        position: candidate.position_applied_for || candidate.positionAppliedFor || 'N/A',
        email: candidate.email,
        photo: candidatePhotoUrl(candidate),
    };
}
