const webhook = $('Webhook').first().json.body || {};
const position = String(webhook.position || '').toLowerCase();
const locationSearch = String(webhook.location || '').toLowerCase();

const STOP_WORDS = new Set(['and', 'or', 'the', 'of', 'for', 'in', 'at', 'to', 'a', 'an', 'with']);
const LEVEL_WORDS = new Set([
  'senior', 'junior', 'lead', 'principal', 'specialist', 'manager', 'director', 'head', 'chief',
  'staff', 'associate', 'assistant', 'officer', 'executive', 'general', 'employee', 'intern',
  'graduate', 'trainee', 'sr', 'jr', 'ii', 'iii', 'iv', 'level',
]);
const ROLE_PHRASES = [
  {
    search: ['employee relations', 'employee relation', 'labor relations', 'industrial relations'],
    match: [
      'employee relations', 'employee relation', 'labor relations', 'industrial relations',
      'relations specialist', 'relations manager', 'human resources', ' hr ', 'people operations',
      'personnel', 'علاقات الموظفين', 'علاقات العمل',
    ],
  },
  {
    search: ['recruiter', 'recruitment', 'talent acquisition', 'talent partner', 'headhunter', 'staffing'],
    match: [
      'recruiter', 'recruitment', 'talent acquisition', 'talent partner', 'talent scout',
      'headhunter', 'head hunter', 'staffing', 'sourcing', 'human resources', ' hr ',
      'موارد بشرية', 'توظيف', 'استقطاب', 'تعيين',
    ],
  },
  {
    search: ['human resources', ' hr '],
    match: [
      'human resources', ' hr ', 'hr manager', 'hr specialist', 'hr business', 'hr generalist',
      'people operations', 'people partner', 'personnel', 'موارد بشرية', 'شؤون الموظفين',
    ],
  },
];
const IRAQ_TERMS = ['iraq', 'iraqi', 'baghdad', 'بغداد', 'العراق', 'basra', 'erbil', 'kirkuk', 'mosul', 'najaf', 'karbala', 'sulaymaniyah'];
const US_EXCLUDE_TERMS = [
  'united states', 'u.s.', 'usa', 'america', 'california', 'texas', 'new york', 'florida',
  'orange county', 'illinois', 'washington', 'virginia', 'georgia', 'arizona', 'colorado',
];
const NON_IRAQ_EXCLUDE_TERMS = [
  'iran', 'tehran', 'turkey', 'istanbul', 'uae', 'dubai', 'abu dhabi', 'saudi', 'riyadh',
  'jordan', 'amman', 'lebanon', 'beirut', 'kuwait', 'qatar', 'bahrain', 'oman', 'egypt', 'cairo',
  'pakistan', 'india', 'bangladesh',
];

function fmtDate(d) {
  if (!d) return '';
  if (typeof d === 'string') return d;
  if (typeof d === 'object' && d !== null) {
    const y = d.year || '';
    const m = d.month ? String(d.month).padStart(2, '0') : '';
    return [y, m].filter(Boolean).join('-');
  }
  return String(d);
}

function experienceLogo(e) {
  if (!e || typeof e !== 'object') return '';
  const direct = e.logo_url || e.company_logo_url || e.companyLogoUrl || '';
  if (direct) return String(direct);
  const comp = e.company;
  if (comp && typeof comp === 'object' && comp.logo) return String(comp.logo);
  return '';
}

function norm(s) {
  return String(s || '').toLowerCase().trim();
}

function joinLoc(parts) {
  return norm(parts.filter(Boolean).join(' '));
}

function isIraqSearch() {
  return (
    locationSearch.includes('iraq') ||
    locationSearch.includes('baghdad') ||
    locationSearch.includes('عراق') ||
    locationSearch.includes('بغداد')
  );
}

function isBaghdadSearch() {
  return locationSearch.includes('baghdad') || locationSearch.includes('بغداد');
}

function hasIraqTerm(text) {
  return IRAQ_TERMS.some((t) => text.includes(t));
}

function hasUsLocation(text) {
  if (!text) return false;
  return US_EXCLUDE_TERMS.some((t) => text.includes(t));
}

function hasNonIraqCountry(text) {
  if (!text) return false;
  if (hasIraqTerm(text)) return false;
  if (text === 'iq' || text.endsWith(', iq') || text.includes(' iraq')) return false;
  return NON_IRAQ_EXCLUDE_TERMS.some((t) => text.includes(t));
}

function isIraqCountryCode(raw) {
  const c = norm(raw.country || '');
  const cf = norm(raw.country_full_name || '');
  return c === 'iq' || cf === 'iraq' || cf.includes('iraq');
}

function currentLocationText(raw, experiences) {
  const fromProfile = joinLoc([raw.city, raw.state, raw.country, raw.country_full_name]);
  if (fromProfile) return fromProfile;

  if (Array.isArray(experiences)) {
    for (let i = 0; i < experiences.length; i++) {
      const loc = norm(experiences[i].location || '');
      if (loc) return loc;
    }
  }
  return '';
}

function allProfileLocationText(raw, experiences) {
  const parts = [
    raw.city,
    raw.state,
    raw.country,
    raw.country_full_name,
    raw.headline,
    raw.occupation,
    raw.summary,
  ];
  if (Array.isArray(experiences)) {
    for (const e of experiences) {
      parts.push(e.location, e.title, e.role, e.company, e.description);
    }
  }
  return joinLoc(parts);
}

function hasForeignLocationEvidence(text, raw) {
  if (!text) return false;
  if (hasIraqTerm(text) || isIraqCountryCode(raw)) return false;
  if (hasUsLocation(text)) return true;
  return hasNonIraqCountry(text);
}

function matchesLocation(raw, experiences) {
  if (!locationSearch.trim()) return true;

  const currentLoc = currentLocationText(raw, experiences);
  const blob = allProfileLocationText(raw, experiences);

  if (isIraqSearch()) {
    /**
     * Residence is decided by the profile's CURRENT COUNTRY, never by the whole
     * profile text.
     *
     * The old rule asked `hasIraqTerm(blob)`, and `blob` concatenates the summary
     * and every past job's location, title, company and description — so one past
     * Iraqi role made a candidate "in Iraq" forever. On 2026-09-29 that delivered
     * a Cairo-based and a Switzerland-based candidate for a Baghdad search.
     *
     * The country CODE wins over any city name, because production returned
     * "Erbil, SY": an Iraqi city with a Syrian country code, which `IRAQ_TERMS`
     * accepted as Iraqi. City names cannot prove a country.
     */
    const code = norm(raw.country || '');
    const full = norm(raw.country_full_name || '');
    if (code) return code === 'iq';
    if (full) return full.includes('iraq');

    // No country field at all. Fall back to the CURRENT location only — never the
    // blob — and keep a profile that carries no location signal whatsoever, since
    // the SERP query itself already targeted Iraq.
    if (hasIraqTerm(currentLoc)) return true;
    if (hasForeignLocationEvidence(currentLoc, raw)) return false;
    return !currentLoc.trim();
  }

  const terms = locationSearch
    .split(/[,\s]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 2);
  const checkText = currentLoc || joinLoc([raw.headline, raw.occupation]);
  return terms.length === 0 || terms.some((t) => checkText.includes(t));
}

// Position gate: the searched role must appear in a job TITLE, current OR past,
// or in the headline / occupation title. Descriptions, bio, company names after
// ' at ' / '@' and industry are deliberately not searched.
// Measured 2026-10-02 on the 14 retained real searches: of the 200 profiles that
// reach this gate under this code, the people delivered in another job got
// through on 'business'/'partner' in a bio, headline or description, on
// 'generalist' in a headline, or on the old pass-all (a title made only of level
// words, e.g. 'HR Assistant', passed everyone - even a profile with no title).
// And 36 of the 200 held the searched title only in an EARLIER job (27 of them
// were delivered), so a past title keeps counting.
const TITLE_REWRITES = [
  [/\bhuman\s+resources?\b/g, 'hr'],
  [/\bh\.r\.?(?=\s|$)/g, 'hr'],
  [/\bhrbp\b/g, 'hr business partner'],
  [/\bbd\b/g, 'business development'],
  [/\bpurchasing\b/g, 'procurement'],
  [/\badministrat(?:ive|ion)\b/g, 'admin'],
  // An 'administrator' is admin staff unless it administers systems.
  [/(?<!\b(?:system|systems|network|networks|database|db|it|erp|server|sql|linux|windows|cloud|domain|sharepoint|odoo|oracle|web|security)\s+)\badministrators?\b/g, 'admin'],
  [/\bsales(?:man|men|woman|women|person|persons|people)\b/g, 'sales'],
  [/\btelesales\b/g, 'tele sales'],
  [/\b(project|operation|logistic|relation|system)s\b/g, '$1'],
  [/\bstores?[\s-]*keepers?\b/g, 'storekeeper'],
  [/\b(?:qhse|hseq|hsse|qhsse|ehs)\b/g, 'hse'],
  [/\bhealth\s*(?:and|&)?\s*safety\b/g, 'hse safety'],
  [/\binformation\s+technology\b/g, 'it technology'],
  [/\bi\.t\.?(?=\s|$)/g, 'it'],
  [/\b(?:auditors?|auditing)\b/g, 'audit'],
  [/\bmgr\b/g, 'manager'],
  [/\basst\b/g, 'assistant'],
  // 'M&E', 'C&B', 'R&D' become one word ('mne', 'cnb', 'rnd'), never two single
  // letters and never a real word such as 'me'.
  [/\b([a-z])\s*&\s*([a-z])\b/g, '$1n$2'],
];
function normTitle(s) {
  let t = String(s || '').toLowerCase();
  for (const [re, to] of TITLE_REWRITES) t = t.replace(re, to);
  // Drop diacritics (Arabic harakat) before splitting, or one word would become two.
  t = t.replace(/\p{M}+/gu, '').replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return t ? ` ${t} ` : '';
}
// "Title at Company" / "Title @ Company": only the title part, so a company named
// after ' at ' or '@' never counts ("Regional Business Partner at Example Trading Co").
function titlePart(s) {
  return String(s || '').split(/\s+at\s+|\s*@\s*/i)[0];
}
// Headline segments: '|' and the bullets U+2022 / U+00B7 (built from char codes so the
// source stays ASCII).
const HEADLINE_SEPARATORS = new RegExp('[|' + String.fromCharCode(0x2022, 0xb7) + ']');
function profileTitles(profile, experiences) {
  const raw = [titlePart(profile.occupation)];
  for (const seg of String(profile.headline || '').split(HEADLINE_SEPARATORS)) raw.push(titlePart(seg));
  for (const e of experiences) raw.push(e.title);
  return raw.map(normTitle).filter(Boolean);
}

const POS_NORM = normTitle(position);
const isArabicWord = (w) => /\p{Script=Arabic}/u.test(w);
// One-letter tokens ('a/r' -> 'a', 'r') identify nothing, nor do Arabic words of
// two letters ('fi', 'min'), which would match inside any Arabic word.
const POS_CORE = POS_NORM.trim().split(' ')
  .filter((w) => w.length > (isArabicWord(w) ? 2 : 1) && !STOP_WORDS.has(w) && !LEVEL_WORDS.has(w));
// Words too common in job titles to identify a role on their own: "HR Business
// Partner" must not match a "Regional Business Partner", nor "HR Generalist" a
// "Marketing Generalist". When the searched title has a distinctive word, any one
// of them in a title is enough (as before, but only in titles); when it has none
// ("Business Development Specialist"), all of its words must sit in one title.
const GENERIC_TITLE_WORDS = new Set([
  'business', 'partner', 'partners', 'development', 'generalist', 'management', 'operations',
  'operation', 'services', 'service', 'administration', 'administrative', 'admin', 'coordinator',
  'consultant', 'consulting', 'representative', 'support', 'team', 'office', 'regional', 'country',
  'area', 'district', 'global', 'international', 'corporate', 'group', 'project', 'projects',
  'affairs', 'public', 'relations', 'relation',
]);
const POS_DISTINCT = POS_CORE.filter((w) => !GENERIC_TITLE_WORDS.has(w));
// Never pass everyone: a title made only of level words ("Manager") must itself appear.
const POS_ALL = POS_CORE.length ? POS_CORE : POS_NORM.trim().split(' ').filter(Boolean);
// Arabic words are matched inside words, as the old gate did: a title with the
// article 'al-' or a feminine ending must still match the bare Arabic word.
// An English search also accepts the Arabic title of the same job, current or
// past. Kept deliberately short (no 'account' or 'store': their Arabic forms are
// different jobs).
const ARABIC_FOR = {
  sales: ['مبيعات'],
  procurement: ['مشتريات'],
  accountant: ['محاسب'],
  accounting: ['محاسب'],
  engineer: ['مهندس'],
  marketing: ['تسويق'],
};
function hasWord(t, w) {
  if (isArabicWord(w)) return t.includes(w);
  if (t.includes(` ${w} `)) return true;
  return (Object.hasOwn(ARABIC_FOR, w) ? ARABIC_FOR[w] : []).some((a) => t.includes(a));
}
function titleHasRole(t) {
  if (POS_DISTINCT.length) return POS_DISTINCT.some((w) => hasWord(t, w));
  return POS_ALL.every((w) => hasWord(t, w));
}
const POS_IS_HR = POS_NORM.includes(' hr ');
const HR_TITLE_TERMS = [
  ' hr ', ' people ', ' personnel ', ' talent acquisition ', ' talent management ', ' recruitment ',
  ' recruiter ', ' recruiting ', ' human capital ', ' employee relation ', ' payroll ',
  'موارد بشرية', 'الموارد البشرية', 'شؤون الموظفين',
];
const ROLE_GROUPS_FOR_POSITION = ROLE_PHRASES
  .filter((g) => g.search.some((s) => POS_NORM.includes(normTitle(s))))
  .map((g) => g.match.map(normTitle).filter(Boolean));
const POS_FIELD_ENGINEER = POS_NORM.includes(' field ') && POS_NORM.includes(' engineer ');
const POS_COMP_BEN = POS_NORM.includes(' compensation ') || POS_NORM.includes(' benefits ') || POS_NORM.includes(' cnb ');
const COMP_BEN_TERMS = ['compensation', 'benefits', 'total rewards', 'c&b', 'payroll', 'reward', 'تعويضات', 'مزايا'].map(normTitle);

function matchesPosition(titles) {
  if (!POS_NORM) return true;
  for (const t of titles) {
    if (titleHasRole(t)) return true;
    if (POS_IS_HR && HR_TITLE_TERMS.some((term) => t.includes(term))) return true;
    if (ROLE_GROUPS_FOR_POSITION.some((terms) => terms.some((m) => t.includes(m)))) return true;
    if (POS_FIELD_ENGINEER && [' oilfield ', ' oil field ', ' petroleum ', ' field engineering '].some((x) => t.includes(x))) return true;
    if (POS_FIELD_ENGINEER && t.includes('مهندس') && t.includes('حقل')) return true;
    if (POS_COMP_BEN && COMP_BEN_TERMS.some((x) => t.includes(x))) return true;
  }
  return false;
}

const out = [];

for (const item of $input.all()) {
  const profile = item.json;
  const skipRow = () => ({ json: { __skip: true, searchId: webhook.searchId, name: '' } });

  if (profile.error) {
    out.push(skipRow());
    continue;
  }

  const emails = profile.personal_emails || [];
  const phones = profile.personal_numbers || [];

  let linkedin_url = '';
  if (profile.linkedin_profile_url) {
    linkedin_url = String(profile.linkedin_profile_url);
  } else if (profile.public_identifier) {
    linkedin_url = `https://www.linkedin.com/in/${profile.public_identifier}`;
  }

  const name = profile.full_name || profile.name || '';
  const jobTitle = profile.occupation || profile.headline || '';
  const bio = profile.summary || '';
  const hasExp = Array.isArray(profile.experiences) && profile.experiences.length > 0;

  if (!name && !jobTitle && !bio && !hasExp && !linkedin_url) {
    out.push(skipRow());
    continue;
  }

  const experiences = (profile.experiences || []).map((e) => {
    const companyLogo = experienceLogo(e);
    const row = {
      company: e.company || '',
      role: e.title || e.role || '',
      title: e.title || e.role || '',
      starts_at: e.starts_at ?? null,
      ends_at: e.ends_at ?? null,
      period: e.starts_at
        ? `${fmtDate(e.starts_at)}${e.ends_at ? ' - ' + fmtDate(e.ends_at) : ''}`
        : (e.period || ''),
    };
    if (e.location) row.location = e.location;
    if (e.description) row.description = e.description;
    if (companyLogo) row.company_logo_url = companyLogo;
    return row;
  });

  if (!matchesLocation(profile, experiences)) {
    out.push(skipRow());
    continue;
  }

  const location = [profile.city, profile.state, profile.country || profile.country_full_name]
    .filter(Boolean)
    .join(', ');

  const mapped = {
    searchId: webhook.searchId,
    name,
    location,
    profile_picture_url: profile.profile_pic_url || profile.profile_picture_url || '',
    headline: profile.headline || profile.occupation || '',
    job_title: jobTitle,
    bio,
    gender: profile.gender || '',
    birth_date: profile.birth_date || '',
    industry: profile.industry || '',
    email: emails[0] || '',
    phone: phones[0] || '',
    skills: profile.skills || [],
    languages: profile.languages || [],
    education: profile.education || profile.educations || [],
    linkedin_url,
    experiences,
    location_priority: isBaghdadSearch() && norm(location).includes('baghdad') ? 1 : 0,
  };

  if (!matchesPosition(profileTitles(profile, experiences))) {
    out.push(skipRow());
    continue;
  }

  out.push({ json: mapped });
}

return out;
