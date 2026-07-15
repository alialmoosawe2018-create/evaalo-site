/**
 * حقول المعاينة الموحّدة لبطاقة المرشح ولوحة الانزلاق.
 * @typedef {import('./headHunterNormalize.js').HeadHunterCandidate} HeadHunterCandidate
 * @typedef {import('./headHunterNormalize.js').HeadHunterTimelineEntry | undefined} HeadHunterTimelineEntry
 */

/**
 * @param {HeadHunterTimelineEntry} entry
 */
export function firstTimelineSnippet(entry) {
    if (!entry) return '';
    const titleCompany = [entry.title, entry.company].filter(Boolean).join(' · ');
    const dates = [entry.start, entry.end].filter(Boolean).join(' — ');
    if (titleCompany && dates) return `${titleCompany} · ${dates}`;
    return titleCompany || dates || '';
}

/**
 * @param {string} s
 * @param {number} max
 */
export function truncateSnippet(s, max = 96) {
    const t = s.replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    return `${t.slice(0, Math.max(0, max - 1)).trim()}…`;
}

/** أحرف عربية/فارسية شائعة في التسميات */
const RE_AR_SCR = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
const RE_LATIN_LETTER = /[A-Za-z]/;

/**
 * نص واحد يجمع اسمين بلغتي كتابة مختلفتين متتابعتين ← سطرّان أوضح (مثلاً شركة عربي + اسم إنجليزي رسمي).
 *
 * @param {string | undefined | null} text
 * @returns {string[] | null} قطعتان غير فارغّتين أو لا يُطبَّق الفصل
 */
export function splitBilingualDisplayLines(text) {
    const t = String(text ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    if (t.length < 5) return null;
    const iAr = t.search(RE_AR_SCR);
    const iLat = t.search(RE_LATIN_LETTER);
    if (iAr < 0 || iLat < 0) return null;
    let a;
    let b;
    if (iAr < iLat) {
        a = t.slice(0, iLat).trim();
        b = t.slice(iLat).trim();
    } else {
        a = t.slice(0, iAr).trim();
        b = t.slice(iAr).trim();
    }
    if (a.length < 2 || b.length < 2) return null;
    if (a.toLowerCase() === b.toLowerCase()) return null;
    return [a, b];
}

/** @returns {number} */
function latinLetterCount(s) {
    const matches = String(s || '').match(/[A-Za-z]/g);
    return matches ? matches.length : 0;
}

/** @returns {number} */
function arabicScriptCount(s) {
    const matches = String(s || '').match(new RegExp(RE_AR_SCR.source, 'g'));
    return matches ? matches.length : 0;
}

/**
 * قطعتان عربي/لاتيني: في بطاقة النتائج يُعرض السطر ذو الحروف اللاتينية أولًا ثم العربي تحته.
 *
 * @param {string[]} parts طول ٢ من `splitBilingualDisplayLines`
 * @returns {string[]}
 */
export function sortBilingualLinesLatinFirst(parts) {
    if (!parts || parts.length !== 2) return parts || [];
    const [segA, segB] = parts;
    const la = latinLetterCount(segA);
    const lb = latinLetterCount(segB);
    if (la !== lb) return la >= lb ? [segA, segB] : [segB, segA];
    const aa = arabicScriptCount(segA);
    const ab = arabicScriptCount(segB);
    return aa <= ab ? [segA, segB] : [segB, segA];
}

/**
 * @param {HeadHunterCandidate | Record<string, unknown>} candidate
 */
export function candidateMetaLocation(candidate) {
    const loc =
        typeof candidate.location === 'string'
            ? candidate.location
                  .split('\n')
                  .map((ln) => ln.trim())
                  .find(Boolean) || ''
            : '';
    return loc || '';
}

const PRESENT_SORT_RANK = Number.MAX_SAFE_INTEGER;

/**
 * @param {string} s
 * @returns {number | null}
 */
function approxDateSortKey(s) {
    if (s == null || typeof s !== 'string') return null;
    const t = s.trim();
    if (!t || /^present$/i.test(t)) return null;
    const m = t.match(/^(\d{1,4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/);
    if (!m || !m[1]) return null;
    const y = parseInt(m[1], 10);
    if (!Number.isFinite(y) || y < 1900 || y > 2130) return null;
    const mo = m[2] != null && m[2] !== '' ? Math.min(12, Math.max(1, parseInt(m[2], 10))) : 0;
    const d = m[3] != null && m[3] !== '' ? Math.min(31, Math.max(1, parseInt(m[3], 10))) : 0;
    return y * 10000 + mo * 100 + d;
}

/**
 * @param {{ start?: string; end?: string }} entry
 */
function effectiveEndSortRank(entry) {
    const end = typeof entry.end === 'string' ? entry.end.trim() : '';
    if (!end || /^present$/i.test(end)) return PRESENT_SORT_RANK;
    const n = approxDateSortKey(end);
    if (n != null) return n;
    const st = typeof entry.start === 'string' ? entry.start.trim() : '';
    return approxDateSortKey(st) ?? 0;
}

/**
 * ترتيب زمني تنازلي (الأحدث أولاً) كما في LinkedIn — حسب نهاية المدة ثم البداية.
 * @param {import('./headHunterNormalize.js').HeadHunterTimelineEntry[] | undefined} entries
 * @returns {import('./headHunterNormalize.js').HeadHunterTimelineEntry[]}
 */
export function sortExperienceTimelineDescending(entries) {
    if (!entries || !Array.isArray(entries) || entries.length <= 1) return entries ? [...entries] : [];
    return [...entries].sort((a, b) => {
        const endB = effectiveEndSortRank(b);
        const endA = effectiveEndSortRank(a);
        if (endB !== endA) return endB - endA;
        const sb = approxDateSortKey(typeof b.start === 'string' ? b.start.trim() : '') ?? 0;
        const sa = approxDateSortKey(typeof a.start === 'string' ? a.start.trim() : '') ?? 0;
        return sb - sa;
    });
}

/**
 * متتالٍ بعد فرز التجربة — دمج صفوف متتالية لها نفس اسم الشركة (كترقية داخل الشركة).
 *
 * @param {import('./headHunterNormalize.js').HeadHunterTimelineEntry[]} entries
 * @returns {{ key: string; companyDisplay: string; logoUrl: string; roles: import('./headHunterNormalize.js').HeadHunterTimelineEntry[] }[]}
 */
export function groupExperienceTimelineByCompany(entries) {
    if (!entries || !entries.length) return [];
    /** @type {{ key: string; companyDisplay: string; logoUrl: string; roles: import('./headHunterNormalize.js').HeadHunterTimelineEntry[] }[]} */
    const groups = [];
    for (let i = 0; i < entries.length; i++) {
        const ex = entries[i];
        const name = typeof ex.company === 'string' ? ex.company.trim() : '';
        const key = name
            ? name.replace(/\s+/g, ' ').toLowerCase()
            : `__noco_${i}_${String(ex.title || '').slice(0, 28)}`;
        const logoCandidate =
            typeof ex.company_logo_url === 'string' &&
            (/^https?:\/\//i.test(ex.company_logo_url.trim()) || /^data:image\//i.test(ex.company_logo_url.trim()))
                ? ex.company_logo_url.trim()
                : '';
        const prev = groups[groups.length - 1];
        if (prev && prev.key === key) {
            prev.roles.push(ex);
            if (!prev.logoUrl && logoCandidate) prev.logoUrl = logoCandidate;
            if ((!prev.companyDisplay || prev.companyDisplay === '—') && name) prev.companyDisplay = name;
            continue;
        }
        groups.push({
            key,
            companyDisplay: name || '—',
            logoUrl: logoCandidate,
            roles: [ex],
        });
    }
    return groups;
}
