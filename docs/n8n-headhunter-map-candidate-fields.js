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
    if (hasForeignLocationEvidence(blob, raw)) return false;
    if (hasIraqTerm(blob) || isIraqCountryCode(raw)) return true;

    // Soft pass: Serp/enrich pipeline already targets Iraq; keep profiles with no foreign signal.
    if (!currentLoc && !hasForeignLocationEvidence(blob, raw)) return true;

    const narrow = joinLoc([
      raw.city,
      raw.state,
      raw.country,
      raw.country_full_name,
      raw.headline,
      raw.occupation,
    ]);
    if (hasIraqTerm(narrow) || isIraqCountryCode(raw)) return true;
    if (!narrow.trim()) return true;
    return false;
  }

  const terms = locationSearch
    .split(/[,\s]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 2);
  const checkText = currentLoc || joinLoc([raw.headline, raw.occupation]);
  return terms.length === 0 || terms.some((t) => checkText.includes(t));
}

function profileTextForPosition(mapped) {
  const parts = [
    mapped.headline,
    mapped.job_title,
    mapped.bio,
    mapped.industry,
    ...(mapped.experiences || []).map((e) => `${e.role} ${e.company} ${e.title} ${e.description || ''}`),
  ];
  return parts.join(' ').toLowerCase();
}

function matchesPosition(text) {
  if (!position.trim()) return true;

  if (position.includes('field') && position.includes('engineer')) {
    if (text.includes('field engineer') || text.includes('field engineering')) return true;
    if (text.includes('oilfield') || text.includes('oil field') || text.includes('petroleum')) return true;
    if (text.includes('مهندس') && text.includes('حقل')) return true;
  }

  if (position.includes('compensation') || position.includes('benefits')) {
    const roleTerms = ['compensation', 'benefits', 'total rewards', 'c&b', 'payroll', 'reward', 'تعويضات', 'مزايا'];
    if (roleTerms.some((t) => text.includes(t))) return true;
  }

  for (const group of ROLE_PHRASES) {
    if (group.search.some((s) => position.includes(s))) {
      if (group.match.some((m) => text.includes(m))) return true;
    }
  }

  if (position.includes('human resources') || /\bhr\b/.test(position)) {
    if (text.includes('human resources') || text.includes(' hr ') || text.startsWith('hr ')) return true;
  }

  const words = position
    .split(/\s+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w) && !LEVEL_WORDS.has(w));
  if (words.length === 0) return true;

  const hits = words.filter((w) => text.includes(w));
  return hits.length >= 1;
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

  const text = profileTextForPosition(mapped);
  if (!matchesPosition(text)) {
    out.push(skipRow());
    continue;
  }

  out.push({ json: mapped });
}

return out;
