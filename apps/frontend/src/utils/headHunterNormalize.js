/**
 * AI Head Hunter — عقد موصى به لاستجابة n8n (POST → webhook → GET /last-result payload):
 *
 * {
 *   "candidates": [ { id, full_name, photo_url, headline, ... } ],
 *   "meta": { "nextCursor": null }
 * }
 *
 * يقبل أيضاً حقول بديلة: results | items | data كمصفوفات، وجذراً كمصفوفة، وحروف مختلفة casing.
 * حقل الصورة: يُقبل `photo_url` أو `profile_pic_url` (Enrichlayer / n8n) أو أسماء شائعة أخرى،
 * ويُستخدم فقط رابط HTTP(s) أو `data:image/...` (يتم تجاهل `urn:li:...`).
 *
 * شكل شائع من سحب LinkedIn/n8n (كائن واحد في الجذر):
 * `Name`, `occupation`, `Location`, `experiences[{ company, title, starts_at, ends_at }]`.
 *
 * ملاحظة الخادم: كل POST لويب هوك يُدمَج مع النتيجة السابقة **لنفس searchId** عند إرسال **مرشح مفرد** (Name / occupation / …).
 * يُعلَن البحث مكتملاً عند `searchComplete: true` (أو `completed` / `done`) في آخر رسالة من n8n.
 * لإرسال دفعة كاملة دفعة واحدة استخدم `{ "candidates": [ ... ], "searchComplete": true }` من عقدة Merge في n8n.
 */

/** @typedef {'positive' | 'warning' | 'neutral'} HeadHunterInsightKind */

/**
 * @typedef {object} HeadHunterMatchInsight
 * @property {HeadHunterInsightKind} kind
 * @property {string} text
 */

/**
 * @typedef {object} HeadHunterTimelineEntry
 * @property {string} title
 * @property {string} company
 * @property {string} start
 * @property {string} end
 * @property {string} [company_logo_url]
 * @property {string} [description]
 * @property {string} [location]
 */

/**
 * @typedef {object} HeadHunterEducationEntry
 * @property {string} school
 * @property {string} years
 * @property {string} [school_logo_url]
 */

/**
 * @typedef {object} HeadHunterCandidate
 * @property {string} id
 * @property {string} full_name
 * @property {string} photo_url
 * @property {string} headline — عنوان المهنة للعرض؛ من occupation قد يكون فقرة كاملة (بدون اقتطاع 200 حرف)
 * @property {string} location
 * @property {string} current_company
 * @property {string} current_title
 * @property {number | null} years_experience
 * @property {string[]} skills
 * @property {string[]} languages — لغات المرشح (من مصفوفة أسماء أو عناصر LinkedIn)
 * @property {string} summary
 * @property {string} ai_summary
 * @property {string} ai_analysis — تحليل مُولَّد (حملات / n8n) للعرض بجانب الخبرة؛ منفصل عن الملخص المختصر ai_summary.
 * @property {string} linkedin_url
 * @property {string} email
 * @property {string} phone
 * @property {number | null} match_score
 * @property {HeadHunterMatchInsight[]} match_insights
 * @property {'open_to_work' | 'passive' | 'recently_active' | null} availability
 * @property {string} last_activity_label
 * @property {HeadHunterTimelineEntry[]} experience_timeline
 * @property {HeadHunterEducationEntry[]} education
 * @property {number | null} sort_rank — ترتيب صريح من n8n (1 = الأول). إن تُستخدم لأحد المرشحين يُقيَّد فرز القائمة.
 * @property {number} payload_index — موضع العنصر في مصفوفة الحمولة (ثبات ترتيب من المصدر).
 */

/**
 * @typedef {object} HeadHunterNormalizeMeta
 * @property {string | null} [nextCursor]
 */

/**
 * @typedef {object} HeadHunterNormalizeResult
 * @property {HeadHunterCandidate[]} candidates
 * @property {HeadHunterNormalizeMeta | null} meta
 */

function isPlainObject(v) {
    return v != null && typeof v === 'object' && !Array.isArray(v);
}

function str(v, fallback = '') {
    if (v == null) return fallback;
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return fallback;
}

function num(v) {
    if (v == null || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : null;
}

function pickFirst(obj, keys) {
    if (!isPlainObject(obj)) return '';
    for (const k of keys) {
        if (obj[k] != null && String(obj[k]).trim() !== '') return String(obj[k]).trim();
    }
    return '';
}

/**
 * يحوّل HTML الخام (LinkedIn / Enrichlayer) إلى نص عادي للعرض.
 * يحوّل `<br>` إلى أسطر جديدة ويزيل بقية الوسوم.
 * @param {unknown} value
 * @returns {string}
 */
export function stripHtmlForDisplay(value) {
    if (typeof value !== 'string') return '';
    let s = value;
    if (!s.trim()) return '';

    s = s
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#0*39;/gi, "'")
        .replace(/&apos;/gi, "'");

    s = s.replace(/<\s*br\s*\/?>/gi, '\n');
    s = s.replace(/(?<!<)\s*br\s*>/gi, '\n');

    s = s.replace(/<\s*\/\s*(p|div|li|h[1-6])\s*>/gi, '\n');
    s = s.replace(/<\s*(p|div|li|h[1-6])(\s[^>]*)?\/?>/gi, '\n');

    s = s.replace(/<[^>]+>/g, ' ');

    return s
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}

/**
 * رابط صورة يمكن استخدامه في عنصر `<img>` (يتجاهل URN وبيانات غير روابط HTTP).
 */
function normalizeDisplayableImageUrl(s) {
    if (s == null || typeof s !== 'string') return '';
    const u = s.trim();
    if (!u) return '';
    if (/^data:image\//i.test(u)) return u;
    if (/^urn:li:/i.test(u)) return '';
    if (/^https?:\/\//i.test(u)) return u;
    if (/^\/\//.test(u)) return `https:${u}`;
    /** روابط بدون بروتوكول شائعة من n8n / LinkedIn */
    if (/^(?:media\.licdn\.com|static\.licdn\.com|[a-z0-9](?:[a-z0-9-]*\.)+[a-z]{2,})\//i.test(u)) {
        return `https://${u}`;
    }
    return '';
}

/**
 * LinkedIn Voyager: rootUrl + أكبر artifact.
 * @param {unknown} vec
 */
function linkedInVectorImageUrl(vec) {
    if (!isPlainObject(vec)) return '';
    const root = typeof vec.rootUrl === 'string' ? vec.rootUrl.trim() : '';
    if (!root) return '';
    const artifacts = Array.isArray(vec.artifacts) ? vec.artifacts : [];
    if (!artifacts.length) return normalizeDisplayableImageUrl(root);
    let best = /** @type {Record<string, unknown> | null} */ (null);
    for (const a of artifacts) {
        if (!isPlainObject(a)) continue;
        const w = typeof a.width === 'number' ? a.width : parseInt(String(a.width ?? ''), 10);
        const bw = best && typeof best.width === 'number' ? best.width : parseInt(String(best?.width ?? ''), 10);
        if (!best || (Number.isFinite(w) && w > (Number.isFinite(bw) ? bw : 0))) {
            best = /** @type {Record<string, unknown>} */ (a);
        }
    }
    const seg =
        (typeof best?.fileIdentifyingUrlPathSegment === 'string' && best.fileIdentifyingUrlPathSegment.trim()) ||
        (typeof best?.url === 'string' && best.url.trim()) ||
        '';
    if (seg) {
        const joined = root.endsWith('/') || seg.startsWith('/') ? `${root}${seg}` : `${root}${seg}`;
        const normalized = normalizeDisplayableImageUrl(joined);
        if (normalized) return normalized;
    }
    return normalizeDisplayableImageUrl(root);
}

/**
 * يستخرج رابط صورة من سلسلة، كائن متداخل، أو مصفوفة (أنماط n8n / LinkedIn / PhantomBuster).
 * @param {unknown} v
 * @param {number} depth
 * @returns {string}
 */
function coalesceImageUrl(v, depth = 0) {
    if (v == null || depth > 6) return '';
    const fromStr = normalizeDisplayableImageUrl(typeof v === 'string' ? v : '');
    if (fromStr) return fromStr;
    if (Array.isArray(v)) {
        for (const item of v) {
            const u = coalesceImageUrl(item, depth + 1);
            if (u) return u;
        }
        return '';
    }
    if (!isPlainObject(v)) return '';
    if (isPlainObject(v.vectorImage)) {
        const u = linkedInVectorImageUrl(v.vectorImage);
        if (u) return u;
    }
    const nestedKeys = [
        'url',
        'href',
        'uri',
        'imageUrl',
        'image_url',
        'downloadUrl',
        'download_url',
        'sourceUrl',
        'source_url',
        'original',
        'large',
        'xlarge',
        'full',
        'rootUrl',
        'root_url',
        'media',
        'displayImageReference',
        'profilePicture',
        'picture',
    ];
    for (const k of nestedKeys) {
        if (v[k] != null) {
            const u = coalesceImageUrl(v[k], depth + 1);
            if (u) return u;
        }
    }
    /** LinkedIn Voyager يضع الرابط تحت هذا المسار أحياناً */
    const resolver =
        v.displayImageReferenceResolutionResult ??
        v.comLogoResolutionResult ??
        v.displayImageReference ??
        null;
    if (isPlainObject(resolver)) {
        const vec = resolver.vectorImage;
        if (isPlainObject(vec) && typeof vec.rootUrl === 'string') {
            const u = coalesceImageUrl(vec.rootUrl, depth + 1);
            if (u) return u;
        }
        if (resolver.url != null) {
            const u = coalesceImageUrl(resolver.url, depth + 1);
            if (u) return u;
        }
    }
    if (typeof v.displayImage === 'string') {
        const u = normalizeDisplayableImageUrl(v.displayImage);
        if (u) return u;
    }
    return '';
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {string}
 */
function extractPhotoUrl(raw) {
    if (!isPlainObject(raw)) return '';
    /** مفاتيح مسطحة شائعة في ويب الهوكس */
    const topKeys = [
        'profile_pic_url',
        'profilePicUrl',
        'photo_url',
        'photoUrl',
        'profile_pic',
        'profilePic',
        'profile_image_url',
        'profileImageUrl',
        'avatar',
        'avatar_url',
        'avatarUrl',
        'profile_image',
        'profileImage',
        'profile_photo',
        'profilePhoto',
        'profile_photo_url',
        'profilePhotoUrl',
        'profile_picture',
        'profilePicture',
        'picture',
        'picture_url',
        'pictureUrl',
        'thumbnail',
        'thumbnail_url',
        'thumbnailUrl',
        'image',
        'image_url',
        'imageUrl',
        'image_link',
        'imageLink',
        'img',
        'img_url',
        'imgUrl',
        'pic',
        'pic_url',
        'picUrl',
        'linkedin_photo',
        'linkedinPhoto',
        'linkedin_profile_picture',
        'linkedinProfilePicture',
        'Photo',
        'photo',
        'Photo URL',
        'photo URL',
    ];
    for (const k of topKeys) {
        if (raw[k] == null) continue;
        const u = coalesceImageUrl(raw[k], 0);
        if (u) return u;
    }
    /** كائنات متداخلة شائعة من n8n / LinkedIn */
    const containerKeys = [
        'profile',
        'person',
        'candidate',
        'member',
        'user',
        'data',
        'attributes',
        'linkedin',
        'linkedinProfile',
        'linkedin_profile',
        'json',
    ];
    for (const ck of containerKeys) {
        const nested = raw[ck];
        if (!isPlainObject(nested)) continue;
        const u = extractPhotoUrl(/** @type {Record<string, unknown>} */ (nested));
        if (u) return u;
    }
    return '';
}

/**
 * شعار شركة من عنصر خبرة (LinkedIn Voyager، n8n، إلخ).
 * @param {Record<string, unknown>} raw
 */
function extractExperienceCompanyLogo(raw) {
    if (!isPlainObject(raw)) return '';
    /** @type {string[]} */
    const keys = [
        'company_logo_url',
        'companyLogoUrl',
        'company_logo',
        'companyLogo',
        'employer_logo',
        'organization_logo',
        'org_logo',
        'logo_url',
        'brand_logo',
    ];
    for (const k of keys) {
        if (raw[k] != null) {
            const u = coalesceImageUrl(raw[k], 0);
            if (u) return u;
        }
    }
    const comp = raw.company;
    if (isPlainObject(comp)) {
        for (const k of ['logo', 'picture', 'image', 'icon']) {
            if (/** @type {Record<string, unknown>} */ (comp)[k] != null) {
                const u = coalesceImageUrl(/** @type {Record<string, unknown>} */ (comp)[k], 0);
                if (u) return u;
            }
        }
    }
    const org = raw.organization;
    if (isPlainObject(org) && /** @type {Record<string, unknown>} */ (org).logo != null) {
        const u = coalesceImageUrl(/** @type {Record<string, unknown>} */ (org).logo, 0);
        if (u) return u;
    }
    return '';
}

/**
 * شعار جهة التعليم (جامعة/معهد) من عنصر Voyager أو ويب الهوكس.
 * @param {Record<string, unknown>} raw
 * @returns {string}
 */
function extractEducationSchoolLogo(raw) {
    if (!isPlainObject(raw)) return '';
    /** @type {string[]} */
    const flatKeys = [
        'school_logo_url',
        'schoolLogoUrl',
        'university_logo_url',
        'education_logo_url',
        'institution_logo',
        'institution_logo_url',
        'logo_url',
        'logoUrl',
        'logo',
        'picture',
        'image',
        'thumbnail',
        'thumbnail_url',
        'icon',
        'badge',
        'squareLogo',
        'square_logo',
        'squareLogoUrl',
    ];
    for (const k of flatKeys) {
        if (raw[k] != null) {
            const u = coalesceImageUrl(raw[k], 0);
            if (u) return u;
        }
    }
    const resolverKeys = [
        'schoolLogoResolutionResult',
        'school_logo_resolution_result',
        'logoResolutionResult',
        'companyLogoResolutionResult',
        'entityLogoResolutionResult',
        'displayImageReferenceResolutionResult',
        'thumbnailResolutionResult',
    ];
    for (const rk of resolverKeys) {
        if (raw[rk] != null) {
            const u = coalesceImageUrl(raw[rk], 0);
            if (u) return u;
        }
    }
    /** حقل `school` ككيان منفصل أو URN تحت الاسم شائع في LinkedIn */
    const school = raw.school;
    if (isPlainObject(school)) {
        const sObj = /** @type {Record<string, unknown>} */ (school);
        for (const k of ['logo', 'picture', 'image', 'icon', 'squareLogo']) {
            if (sObj[k] != null) {
                const u = coalesceImageUrl(sObj[k], 0);
                if (u) return u;
            }
        }
    }
    for (const key of ['institution', 'organization', 'educational_institution', 'university', 'educationOrganization']) {
        const obj = raw[key];
        if (isPlainObject(obj)) {
            const o = /** @type {Record<string, unknown>} */ (obj);
            for (const k of ['logo', 'picture', 'image', 'icon', 'squareLogo']) {
                if (o[k] != null) {
                    const u = coalesceImageUrl(o[k], 0);
                    if (u) return u;
                }
            }
        }
    }
    return '';
}

/** هاش صغير لمعرّفات مستقرة بدون وجود id من المصدر */
function simpleStringHash(seed) {
    let h = 5381;
    const s = String(seed);
    for (let i = 0; i < s.length; i += 1) {
        h = (h * 33) ^ s.charCodeAt(i);
    }
    return (h >>> 0).toString(36);
}

function normalizeId(raw, index) {
    const linked = pickFirst(raw, ['linkedin_url', 'linkedinUrl', 'linkedin', 'profile_url', 'linkedin_profile_url']);
    const id =
        pickFirst(raw, ['id', '_id', 'candidate_id', 'candidateId', 'linkedin_id', 'profile_id']) ||
        (linked ? `li-${linked.slice(0, 96)}` : '');
    if (id) return id;
    const name = pickFirst(raw, ['Name', 'full_name', 'fullName', 'name']);
    const occ = typeof raw.occupation === 'string' ? raw.occupation.slice(0, 120) : '';
    const loc = pickFirst(raw, ['Location', 'location', 'city']);
    if (name || occ || loc) {
        return `hh-${simpleStringHash(`${name}|${occ}|${loc}`)}`;
    }
    return `headhunter-row-${index}`;
}

/**
 * يبدو ملف مرشح مفرداً من n8n/LinkedIn (جذر ليس تحت `candidates`).
 * @param {Record<string, unknown>} o
 */
function isShellCandidate(o) {
    if (!isPlainObject(o)) return true;
    const hasText =
        pickFirst(o, [
            'Name',
            'name',
            'full_name',
            'fullName',
            'job_title',
            'jobTitle',
            'bio',
            'summary',
            'occupation',
            'Location',
            'location',
            'email',
            'phone',
            'headline',
        ]) !== '';
    const hasExp =
        (Array.isArray(o.experiences) && o.experiences.length > 0) ||
        (Array.isArray(o.experience) && o.experience.length > 0) ||
        (Array.isArray(o.experience_timeline) && o.experience_timeline.length > 0);
    const hasSkills = Array.isArray(o.skills) && o.skills.length > 0;
    const hasEdu = Array.isArray(o.education) && o.education.length > 0;
    return !hasText && !hasExp && !hasSkills && !hasEdu;
}

/**
 * @param {Record<string, unknown>} o
 */
function canonicalizeInboundCandidate(o) {
    const out = { ...o };
    const name = pickFirst(o, ['Name', 'name', 'full_name', 'fullName', 'display_name']);
    const jobTitle = pickFirst(o, ['job_title', 'jobTitle', 'current_title', 'currentTitle', 'title']);
    const bio = pickFirst(o, ['bio', 'summary', 'about', 'overview']);
    if (name && !pickFirst(out, ['Name', 'name', 'full_name', 'fullName'])) out.full_name = name;
    if (jobTitle) {
        if (!pickFirst(out, ['current_title', 'currentTitle', 'job_title'])) out.current_title = jobTitle;
        if (!pickFirst(out, ['headline', 'occupation'])) out.headline = jobTitle;
    }
    if (bio && !pickFirst(out, ['summary', 'bio', 'about'])) out.summary = bio;
    if (jobTitle && bio && typeof out.occupation !== 'string') out.occupation = `${jobTitle}\n\n${bio}`;
    else if (bio && typeof out.occupation !== 'string') out.occupation = bio;
    else if (jobTitle && typeof out.occupation !== 'string') out.occupation = jobTitle;
    const photo = extractPhotoUrl(out);
    if (photo) out.photo_url = photo;
    return out;
}

function looksLikeSingleProfileCandidate(o) {
    if (!isPlainObject(o)) return false;
    if (isShellCandidate(o)) return false;
    const hasName = pickFirst(o, ['Name', 'name', 'full_name', 'fullName', 'display_name']) !== '';
    const hasOccupation = typeof o.occupation === 'string' && String(o.occupation).trim() !== '';
    const hasJobTitle = pickFirst(o, ['job_title', 'jobTitle', 'current_title', 'currentTitle', 'headline']) !== '';
    const hasBio = pickFirst(o, ['bio', 'summary', 'about', 'overview']) !== '';
    const hasLoc = pickFirst(o, ['Location', 'location', 'city', 'geo', 'region']) !== '';
    const hasExp =
        (Array.isArray(o.experiences) && o.experiences.length > 0) ||
        (Array.isArray(o.experience) && o.experience.length > 0);
    const hasEdu = Array.isArray(o.education) && o.education.length > 0;
    const identity = hasName || hasJobTitle || hasBio;
    const substance = hasOccupation || hasJobTitle || hasLoc || hasExp || hasEdu || hasBio;
    return identity && substance;
}

/**
 * @param {unknown} p
 */
function formatLinkedInDatePart(p) {
    if (!isPlainObject(p)) return '';
    const y = p.year;
    const m = p.month;
    const d = p.day;
    if (y == null || y === '') return '';
    const n = typeof y === 'number' ? y : parseInt(String(y).trim(), 10);
    if (!Number.isFinite(n) || n < 1900 || n > 2130) return '';
    const ys = String(y);
    if (m != null && m !== '' && d != null && d !== '') {
        return `${ys}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    if (m != null && m !== '') return `${ys}-${String(m).padStart(2, '0')}`;
    return ys;
}

/**
 * يزيل قيمًا شبه-تاريخية خارج نطاق سنوات مهنية واقعية (مثل 0004 من بيانات تالفة).
 * لا يطبّق على نص حر غير مخطَّط له كـ yyyy-mm-dd فقط؛ يعتمد على الشرط الأساسي.
 * @param {string} [s]
 * @returns {string}
 */
function sanitizeTimelineDateDisplay(s) {
    if (s == null || s === '') return '';
    const t = String(s).trim();
    if (!t) return '';
    if (/^present$/i.test(t)) return 'Present';
    const isoLike = t.match(/^(\d{1,4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/);
    if (isoLike && isoLike[1] !== '') {
        const y = parseInt(isoLike[1], 10);
        if (Number.isFinite(y) && (y < 1900 || y > 2130)) return '';
    }
    const yrOnly = t.match(/^(\d{4})$/);
    if (yrOnly) {
        const y = parseInt(yrOnly[1], 10);
        if (!Number.isFinite(y) || y < 1900 || y > 2130) return '';
    }
    return t;
}

/**
 * @param {unknown} val
 * @returns {HeadHunterTimelineEntry[]}
 */
function normalizeLinkedInStyleExperiences(val) {
    if (!Array.isArray(val)) return [];
    const out = [];
    for (const x of val) {
        if (!isPlainObject(x)) continue;
        const company = pickFirst(x, [
            'company',
            'company_name',
            'employer',
            'organization',
        ]);
        const title = pickFirst(x, [
            'title',
            'position',
            'role',
            'job_title',
        ]);
        let start =
            formatLinkedInDatePart(
                /** @type {Record<string, unknown>} */ (
                    typeof x.starts_at === 'object' && x.starts_at !== null ? x.starts_at : {}
                )
            ) || pickFirst(x, ['start', 'start_date', 'from', 'startDate']);
        let end =
            formatLinkedInDatePart(
                /** @type {Record<string, unknown>} */ (
                    typeof x.ends_at === 'object' && x.ends_at !== null ? x.ends_at : {}
                )
            ) || pickFirst(x, ['end', 'end_date', 'to', 'endDate']);
        if (!start && !end) {
            const periodStr = pickFirst(x, ['period']);
            if (periodStr) {
                const parts = periodStr.split(/\s*[-–—]\s*/);
                if (parts.length >= 2) {
                    start = parts[0].trim();
                    end = parts.slice(1).join(' - ').trim();
                } else if (parts.length === 1) {
                    start = parts[0].trim();
                }
            }
        }
        if (!end && (x.ends_at === null || str(x.present).toLowerCase() === 'true')) {
            end = 'Present';
        }
        start = sanitizeTimelineDateDisplay(start);
        end = sanitizeTimelineDateDisplay(end);
        const description = pickFirst(x, ['description', 'employment_description']);
        const location = pickFirst(x, ['location', 'location_name', 'geo']);
        const company_logo_url = extractExperienceCompanyLogo(x);
        if (!title && !company) continue;
        /** @type {Record<string, string>} */
        const row = {
            title: title || '—',
            company,
            start,
            end,
        };
        if (company_logo_url) row.company_logo_url = company_logo_url;
        if (description) row.description = description;
        if (location) row.location = location;
        out.push(row);
    }
    return out;
}

/**
 * من حقل occupation متعدد الأسطر: عنوان مختصر، ملخص، title/company.
 * @param {string} occupation
 */
function parseOccupationText(occupation) {
    const full = occupation.trim();
    if (!full) {
        return { headline: '', summary: '', aiSummary: '', currentTitle: '', currentCompany: '' };
    }
    const blocks = full.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
    const firstPara = blocks[0] ?? full.split('\n')[0]?.trim() ?? full;
    const restBlocks = blocks.slice(1);
    /** العنوان المعروض في الملف (كامل — مثل LinkedIn، بدون اقتطاع 200 حرف) */
    const headline = firstPara;
    const summary = restBlocks.join('\n\n') || (full.length > firstPara.length ? full.slice(firstPara.length).trim() : '');
    const firstLine = firstPara.split('\n')[0]?.trim() || firstPara;
    const atSplit = firstLine.split(/\s+at\s+/i);
    let currentTitle = '';
    let currentCompany = '';
    if (atSplit.length >= 2) {
        currentTitle = atSplit[0].trim();
        currentCompany = atSplit.slice(1).join(' at ').trim();
    }
    const aiSummary = summary.trim() ? summary.trim() : headline.trim();
    return {
        headline,
        summary,
        aiSummary,
        currentTitle,
        currentCompany,
    };
}

function normalizeSkills(val) {
    if (Array.isArray(val)) {
        return val.map((s) => str(s)).filter(Boolean);
    }
    if (typeof val === 'string') {
        return val
            .split(/[,;|]/)
            .map((s) => s.trim())
            .filter(Boolean);
    }
    return [];
}

/**
 * لغات المرشح؛ نصوص جاهزة أو كائنات Voyager/LinkedIn مع مستوى الإتقان.
 * @param {unknown} val
 * @returns {string[]}
 */
function normalizeLanguages(val) {
    if (val == null) return [];
    if (typeof val === 'string') {
        return normalizeSkills(val);
    }
    if (!Array.isArray(val)) return [];
    const collected = [];
    for (const x of val) {
        if (typeof x === 'string') {
            const t = str(x);
            if (t) collected.push(t);
            continue;
        }
        if (!isPlainObject(x)) continue;
        const name = pickFirst(x, ['name', 'language', 'title', 'localizedName', 'displayName', 'label']);
        const prof = pickFirst(x, ['proficiency', 'level', 'fluency', 'capability', 'proficiencyName']);
        let line = name;
        if (line && prof && !String(line).toLowerCase().includes(String(prof).toLowerCase())) {
            line = `${name} (${prof})`;
        } else if (!line && prof) line = prof;
        if (line) collected.push(line.trim());
    }
    return mergeUniqueSkills([], collected);
}

function normalizeInsights(val) {
    if (!Array.isArray(val)) return [];
    const out = [];
    for (const x of val) {
        if (typeof x === 'string' && x.trim()) {
            const t = x.trim();
            const kind =
                /^[!⚠]/.test(t) || /^limited/i.test(t) || /limited/i.test(t)
                    ? 'warning'
                    : 'positive';
            out.push({ kind, text: t.replace(/^[!✔✓⚠]\s*/, '') });
            continue;
        }
        if (!isPlainObject(x)) continue;
        const text = str(x.text ?? x.message ?? x.label);
        if (!text) continue;
        let kind = /** @type {HeadHunterInsightKind} */ ('positive');
        const k = str(x.kind ?? x.type).toLowerCase();
        if (k === 'warning' || k === 'warn' || k === 'negative') kind = 'warning';
        else if (k === 'neutral' || k === 'info') kind = 'neutral';
        out.push({ kind, text });
    }
    return out;
}

function normalizeTimeline(val) {
    if (!Array.isArray(val)) return [];
    const out = [];
    for (const x of val) {
        if (!isPlainObject(x)) continue;
        const title = pickFirst(x, ['title', 'role', 'position', 'job_title']);
        const company = pickFirst(x, ['company', 'employer', 'organization']);
        const description = pickFirst(x, ['description', 'employment_description']);
        const location = pickFirst(x, ['location', 'location_name', 'city', 'workplace']);
        let start = sanitizeTimelineDateDisplay(
            pickFirst(x, ['start', 'start_date', 'from', 'startDate'])
        );
        let end = sanitizeTimelineDateDisplay(
            pickFirst(x, ['end', 'end_date', 'to', 'endDate', 'present'])
        );
        const company_logo_url = extractExperienceCompanyLogo(x);
        if (!title && !company) continue;
        /** @type {Record<string, string>} */
        const row = {
            title,
            company,
            start,
            end,
        };
        if (company_logo_url) row.company_logo_url = company_logo_url;
        if (description) row.description = description;
        if (location) row.location = location;
        out.push(row);
    }
    return out;
}

function normalizeEducation(val) {
    if (!Array.isArray(val)) return [];
    const out = [];
    for (const x of val) {
        if (!isPlainObject(x)) continue;
        let schoolLine = pickFirst(x, ['school', 'institution', 'university', 'name']);
        let years = pickFirst(x, ['years', 'degree_years', 'period', 'date']);
        if (!years && (x.starts_at != null || x.ends_at != null)) {
            const st =
                typeof x.starts_at === 'object' && x.starts_at != null
                    ? formatLinkedInDatePart(/** @type {Record<string, unknown>} */ (x.starts_at))
                    : '';
            const en =
                typeof x.ends_at === 'object' && x.ends_at != null
                    ? formatLinkedInDatePart(/** @type {Record<string, unknown>} */ (x.ends_at))
                    : '';
            if (st || en)
                years = [sanitizeTimelineDateDisplay(st), sanitizeTimelineDateDisplay(en)].filter(Boolean).join(' — ');
        }
        const degree = pickFirst(x, ['degree_name']);
        const field = pickFirst(x, ['field_of_study']);
        const degParts = [degree, field].filter(Boolean);
        if (degParts.length) {
            schoolLine = schoolLine ? `${schoolLine} · ${degParts.join(' · ')}` : degParts.join(' · ');
        }
        const desc = pickFirst(x, ['description']);
        if (!years && desc) years = desc.length > 140 ? `${desc.slice(0, 137)}…` : desc;
        if (!schoolLine && !years) continue;
        const school_logo_url = extractEducationSchoolLogo(x);
        /** @type {Record<string, string>} */
        const row = {
            school: schoolLine || '—',
        };
        if (years) row.years = years;
        if (school_logo_url) row.school_logo_url = school_logo_url;
        out.push(row);
    }
    return out;
}

/** إضافة مهارات بدون تكرار تقريبي (حالة الأحرف) */
function mergeUniqueSkills(primary, extra) {
    const seen = new Set(primary.map((s) => String(s).toLowerCase()));
    const out = [...primary];
    for (const s of extra) {
        const t = str(s);
        if (!t) continue;
        const k = t.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(t);
    }
    return out;
}

function normalizeAvailability(v) {
    const s = str(v).toLowerCase().replace(/\s+/g, '_');
    if (s === 'open_to_work' || s === 'opentowork' || s === 'open-to-work') return 'open_to_work';
    if (s === 'passive' || s === 'passive_candidate') return 'passive';
    if (s === 'recently_active' || s === 'active' || s === 'recent') return 'recently_active';
    return null;
}

/**
 * استخراج مصفوفة خام من أشكال payload شائعة.
 * @param {unknown} payload
 * @returns {unknown[]}
 */
function extractRawArray(payload) {
    if (payload == null) return [];
    if (typeof payload === 'string') {
        const s = payload.trim();
        if (!s) return [];
        try {
            return extractRawArray(JSON.parse(s));
        } catch (_) {
            return [];
        }
    }
    if (Array.isArray(payload)) {
        return payload
            .filter(isPlainObject)
            .map((row) => canonicalizeInboundCandidate(/** @type {Record<string, unknown>} */ (row)))
            .filter((row) => !isShellCandidate(row));
    }
    if (typeof payload !== 'object') return [];
    const o = /** @type {Record<string, unknown>} */ (payload);
    for (const key of ['candidates', 'results', 'items', 'data', 'profiles', 'people', 'records']) {
        const v = o[key];
        if (Array.isArray(v)) {
            return v
                .filter(isPlainObject)
                .map((row) => canonicalizeInboundCandidate(/** @type {Record<string, unknown>} */ (row)))
                .filter((row) => !isShellCandidate(row));
        }
    }
    if (typeof o.output === 'object' && o.output !== null && !Array.isArray(o.output)) {
        const nested = extractRawArray(o.output);
        if (nested.length) return nested;
    }
    if (Array.isArray(o.output)) return o.output;

    /** غلاف واحد `{ profile: { Name, occupation, ... } }` */
    if (isPlainObject(o.profile) && looksLikeSingleProfileCandidate(o.profile))
        return [canonicalizeInboundCandidate(/** @type {Record<string, unknown>} */ (o.profile))];

    /** كائن ملف واحد كما يعيده n8n/LinkedIn بدون مصفوفة */
    const root = canonicalizeInboundCandidate(o);
    if (looksLikeSingleProfileCandidate(root)) return [root];

    return [];
}

/** @type {(raw: Record<string, unknown>, i: number) => HeadHunterCandidate} */
function normalizeOne(raw, i) {
    const canon = canonicalizeInboundCandidate(raw);
    const occupationStr =
        typeof canon.occupation === 'string' ? stripHtmlForDisplay(String(canon.occupation)) : '';
    const occParsed = occupationStr ? parseOccupationText(occupationStr) : null;

    const years =
        num(canon.years_experience) ??
        num(canon.experience_years) ??
        num(canon.yearsOfExperience) ??
        num(canon.total_years) ??
        num(canon.years);

    let timeline = normalizeTimeline(canon.experience_timeline);
    if (!timeline.length && Array.isArray(canon.experience))
        timeline = normalizeTimeline(canon.experience);
    if (!timeline.length && Array.isArray(canon.experiences))
        timeline = normalizeLinkedInStyleExperiences(canon.experiences);

    let education = normalizeEducation(canon.education);
    if (!education.length && Array.isArray(canon.educations)) education = normalizeEducation(canon.educations);

    let insights = normalizeInsights(canon.match_insights);
    if (!insights.length && typeof canon.match_insights_text === 'string') {
        const parts = canon.match_insights_text.split(/\n|•/).map((s) => s.trim()).filter(Boolean);
        insights = normalizeInsights(parts);
    }

    const matchScore = num(canon.match_score) ?? num(canon.matchScore) ?? num(canon.score) ?? num(canon.fit);

    const sort_rank =
        num(canon.rank) ??
        num(canon.sortRank) ??
        num(canon.sort_order) ??
        num(canon.order) ??
        num(canon.search_rank) ??
        num(canon.priority) ??
        null;

    let full_name = pickFirst(canon, ['Name', 'full_name', 'fullName', 'name', 'display_name']);
    let headline = pickFirst(canon, ['headline', 'title', 'head_line', 'tagline', 'job_title', 'jobTitle']);
    if (!headline && occParsed) headline = occParsed.headline;

    let location = pickFirst(canon, ['Location', 'location', 'city', 'geo', 'region']);

    let current_company = pickFirst(canon, ['current_company', 'currentCompany', 'company', 'employer', 'industry']);
    let current_title = pickFirst(canon, ['current_title', 'currentTitle', 'job_title', 'role']);
    if ((!current_title || !current_company) && occParsed) {
        if (!current_title && occParsed.currentTitle) current_title = occParsed.currentTitle;
        if (!current_company && occParsed.currentCompany) current_company = occParsed.currentCompany;
    }

    let summary = stripHtmlForDisplay(pickFirst(canon, ['summary', 'about', 'bio', 'overview']));
    if (!summary && occParsed?.summary) summary = stripHtmlForDisplay(occParsed.summary);

    let ai_summary = stripHtmlForDisplay(
        pickFirst(canon, ['ai_summary', 'aiSummary', 'ai_one_liner', 'aiTagline']),
    );
    if (!ai_summary && occParsed?.aiSummary) ai_summary = stripHtmlForDisplay(occParsed.aiSummary);

    /** تحليل أطول مخصص لواجهة «تحليل AI»؛ لا يدمج مع ai_summary لتجنّب التكرار في اللوحة. */
    let ai_analysis = stripHtmlForDisplay(
        pickFirst(canon, ['ai_analysis', 'aiAnalysis', 'person_ai_analysis', 'candidate_ai_analysis']),
    );

    headline = stripHtmlForDisplay(headline);

    let skills = normalizeSkills(canon.skills ?? canon.skill_tags ?? canon.tags);
    const languages = normalizeLanguages(canon.languages ?? canon.language_list ?? canon.profileLanguages ?? canon.language);
    if (Array.isArray(canon.certifications)) {
        const certLabels = [];
        for (const c of canon.certifications) {
            if (!isPlainObject(c)) continue;
            const nm = pickFirst(c, ['name', 'title', 'credential_name']);
            if (nm) certLabels.push(nm);
            if (certLabels.length >= 6) break;
        }
        skills = mergeUniqueSkills(skills, certLabels);
    }

    return {
        id: normalizeId(canon, i),
        sort_rank,
        payload_index: i,
        full_name,
        photo_url: extractPhotoUrl(canon),
        headline,
        location,
        current_company,
        current_title,
        years_experience: years,
        skills,
        languages,
        summary,
        ai_summary,
        ai_analysis,
        linkedin_url: pickFirst(canon, ['linkedin_url', 'linkedinUrl', 'linkedin', 'profile_url']),
        email: pickFirst(canon, ['email', 'email_address']),
        phone: pickFirst(canon, ['phone', 'mobile', 'telephone', 'phone_number']),
        match_score: matchScore,
        match_insights: insights,
        availability: normalizeAvailability(canon.availability ?? canon.availability_badge ?? canon.status),
        last_activity_label: pickFirst(canon, ['last_activity_label', 'lastActivity', 'last_active', 'activity']),
        experience_timeline: timeline,
        education,
    };
}

/**
 * تحويل payload ورد من GET /api/head-hunter/last-result إلى مرشحين موحّدين + meta اختياري.
 * @param {unknown} payload
 * @returns {HeadHunterNormalizeResult}
 */
export function normalizeHeadHunterPayload(payload) {
    const rawList = extractRawArray(payload);
    const candidates = rawList
        .map((row, i) => (isPlainObject(row) ? normalizeOne(/** @type {Record<string, unknown>} */ (row), i) : null))
        .filter(Boolean);

    /** @type {HeadHunterNormalizeMeta | null} */
    let meta = null;
    if (isPlainObject(payload) && payload.meta != null && isPlainObject(payload.meta)) {
        const m = /** @type {Record<string, unknown>} */ (payload.meta);
        const c = m.nextCursor;
        meta = {
            nextCursor: c != null && String(c).trim() ? String(c).trim() : null,
        };
    }

    return { candidates, meta };
}
