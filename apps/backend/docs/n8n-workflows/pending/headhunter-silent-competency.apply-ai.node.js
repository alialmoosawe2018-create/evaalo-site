/**
 * Apply AI Analysis — the score is COMPUTED here, not taken from the model.
 *
 * WHY (measured on execs 2035 and 2036, 2026-09-30):
 * the model was returning 35 for candidates whose own insights said
 * `position: positive` and `location: positive`. The prompt's own rubric is
 * Position 35% + Location 30% + Years 15% + other 20%, so positive on the two
 * heaviest criteria is 65 of the 100 criterion points before anything else.
 * In exec 2036, 10 of the 14 candidates who were actually in Iraq scored
 * exactly 35, five of them physically in Baghdad, and the whole search
 * delivered 2 instead of 20.
 *
 * The only score value in the prompt is the location cap ("cap match_score at
 * 35"), written for candidates OUTSIDE Iraq/the Middle East, and the model
 * anchored on it for everyone. Two insights said so in words: "the system caps
 * score at 35 for Baghdad, Iraq location" and "Erbil (Northern Iraq), not
 * Baghdad".
 *
 * The per-criterion JUDGEMENTS are sound — 46 real candidates were reviewed and
 * each carries specific, distinct reasoning. It is only the arithmetic that is
 * unreliable. So the model keeps judging and this node does the arithmetic,
 * which is exactly how the Stage 1 screener was fixed.
 *
 * The prompt is deliberately NOT changed: it already emits one insight per
 * active criterion with a `kind`, which is the whole input needed — for every
 * criterion scored below. The model's own number is kept as `llm_match_score`
 * so the two can be compared in production instead of argued about.
 *
 * No location cap is applied here. `Map Candidate Fields` decides residence
 * from the current country and, for an Iraq/Baghdad search, drops candidates
 * whose current country is not Iraq before scoring (version d9583254).
 *
 * WHAT THE RECRUITER ASKED FOR DECIDES WHAT IS SCORED (2026-09-30).
 * The first version of this node dropped every `neutral` criterion from the
 * sum, so a profile that said nothing about location or years scored 100 on
 * position alone — in exec 2039, 10 of the 20 evaluations (7 different people)
 * scored 100, and only one of those people had position, location, years and
 * age all verified. Two rules now:
 *
 *  - A criterion the recruiter SET earns the share of positive among the
 *    judgements that took a side (positive = 1, warning = 0), and HALF when the
 *    profile is silent on it — every insight neutral, or none at all. Silence is
 *    not a match, and it is not a mismatch either. A neutral remark next to a
 *    real judgement adds nothing.
 *  - A criterion the recruiter did NOT set is not scored, whatever the model
 *    wrote about it — the prompt promises "Unspecified criteria = neutral, no
 *    penalty". (In the 426 retained evaluations the model judged a filter the
 *    search had not set 3 times, all positive: languages and skills in exec
 *    1869, languages in exec 2039.)
 *
 * What was set is read from the search request itself, never inferred from
 * which insights the model happened to write.
 *
 * COMPETENCIES (2026-10-03). The role model is Evaalo's background model, not
 * something the recruiter asked for, so its competencies stay at 30% and count
 * only when the model wrote about them. A competency the profile is silent on
 * now counts HALF, the same rule as a silent criterion. Before, silence was
 * dropped, so a profile that matched only the title and the location scored
 * 100 whatever its evidence: 34 of 78 evaluations in execs 2040-2069, which the
 * model itself scored anywhere from 35 to 100. Replayed on those 78: 6 stay at
 * 100 (no role model sent, or every competency judged positive), title and
 * location alone land at 85, evidence lifts that to 88-98, and none crosses
 * the 50 bar.
 */
// Pair each answer with the candidate the model was asked about: exactly the items
// Has Match? passed on in this batch (its output 0). Map Candidate Fields' own list
// also holds rows Has Match? drops - a profile with a title but no name - and taking
// its last N rows moved every answer before such a row onto the wrong person. None
// of the 260 recorded evaluations had such a row; synthetic tests reproduce it.
const inputs = $input.all();
const candidates = $('Has Match?').all(0);
const wh = $('Webhook').first().json.body || {};

/** The rubric the prompt states, in one place. */
const CRITERION_WEIGHTS = { position: 35, location: 30, years: 15, other: 20 };

/** A set criterion the profile is silent on: neither a match nor a mismatch. */
const SILENT_CREDIT = 0.5;

/**
 * Filled in on the search. The prompt shows an empty field to the model as
 * "not specified" (notes as "none"), so a recruiter who typed exactly that has,
 * in the model's eyes, set nothing — and is treated the same way here.
 */
function isSet(v) {
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return s !== '' && s !== 'not specified' && s !== 'none';
  }
  return v != null && v !== false;
}

/**
 * What the recruiter set on this search — the fields the backend puts in the
 * webhook payload (routes/headHunter.ts) AND the prompt asks the model to judge.
 *
 * Two filters are recognised below but never scored:
 *  - company: the filter was removed on 2026-09-28 and is no longer sent.
 *  - industry: the backend sends `industryType`, but the prompt never asks the
 *    model to judge industry (it appears only inside the `options:` summary),
 *    so scoring it would hand every candidate a silent half on a question
 *    nobody asked. Score it in the same change that adds it to the prompt.
 * Their labels stay recognised so a "company:" or "industry:" line is never
 * mistaken for a competency.
 */
const SET = {
  position: isSet(wh.position),
  location: isSet(wh.location),
  years: isSet(wh.yearsOfExperience),
};
const OTHER_SET = {
  age: isSet(wh.ageRange),
  notes: isSet(wh.query),
  languages: isSet(wh.requiredLanguages),
  skills: isSet(wh.requiredSkills),
  certifications: isSet(wh.certifications),
  gender: isSet(wh.gender),
};

/**
 * Letters-only label → the part of the "other" 20% it belongs to. Matched
 * exactly, not by prefix: a prefix like "age" would also claim a competency
 * such as "Agency management". The model copies the prompt's own names and
 * sometimes puts "Required" in front of them, so both forms are listed.
 */
const OTHER_LABELS = {
  age: 'age', agerange: 'age', estimatedage: 'age',
  notes: 'notes', note: 'notes', additionalnotes: 'notes',
  languages: 'languages', language: 'languages', requiredlanguages: 'languages', requiredlanguage: 'languages',
  languageproficiency: 'languages',
  skills: 'skills', skill: 'skills', requiredskills: 'skills', requiredskill: 'skills',
  certifications: 'certifications', certification: 'certifications', certificates: 'certifications', certificate: 'certifications',
  requiredcertifications: 'certifications', requiredcertification: 'certifications',
  requiredcertificates: 'certifications', requiredcertificate: 'certifications',
  gender: 'gender', genderpreference: 'gender',
  company: 'company', companypreference: 'company',
  industry: 'industry', industrytype: 'industry',
};

function criterionOfPart(part) {
  const k = String(part || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!k) return null;
  if (k.startsWith('position') && !k.startsWith('positioning')) return 'position';
  if (k.startsWith('location')) return 'location';
  if (k.startsWith('years')) return 'years';
  return OTHER_LABELS[k] ? 'other.' + OTHER_LABELS[k] : null;
}

/**
 * The criteria an insight label names, or [] when it is a competency.
 * Real labels seen in production include "position", "Location", "years of
 * experience", "yearsOfExperience", "ageRange", "Gender and Age", "location
 * (final cap)" and "Required skills, certifications, company, gender". The
 * caller has already removed bracketed qualifiers ("Required Languages
 * (English)" arrives as languages). A combined label is split only when EVERY
 * part of it is a criterion; otherwise the whole label is read as one — so
 * "Position and seniority" stays position, while "Territory & Location
 * Planning" and "Positioning & Messaging" stay competencies.
 */
function criteriaOf(label) {
  const parts = String(label || '').split(/,|&|\/|\band\b/i).map((p) => p.trim()).filter(Boolean);
  const keys = parts.map(criterionOfPart);
  if (parts.length > 1 && keys.every(Boolean)) return [...new Set(keys)];
  const whole = criterionOfPart(label);
  return whole ? [whole] : [];
}

function tookSide(kinds) {
  return kinds.some((k) => k === 'positive' || k === 'warning');
}

/** Share of positive among the judgements that took a side; half when none did. */
function creditOf(kinds) {
  const sided = kinds.filter((k) => k === 'positive' || k === 'warning');
  if (!sided.length) return SILENT_CREDIT;
  return sided.filter((k) => k === 'positive').length / sided.length;
}

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Round to a whole score; exact halves always round up, whatever the float error. */
function roundScore(x) {
  return Math.round(Number(x.toFixed(6)));
}

/**
 * Score from the insights.
 *
 * Returns null — "nothing to compute from" — unless at least one criterion the
 * recruiter set was actually judged positive or warning. Without that guard an
 * unparseable answer would come out at exactly 50 and be delivered, which is
 * the bare-50 default this node was written to remove.
 */
function scoreFromInsights(insights) {
  const marks = { position: [], location: [], years: [] };
  const otherMarks = {};
  const competencies = [];
  for (const ins of insights) {
    // Brackets go before the label is cut at the first colon, so a qualifier
    // like "(e.g.: Excel)" cannot cut the label short.
    const label = String(ins.text || '').replace(/\([^)]*\)/g, ' ').split(':')[0];
    const keys = criteriaOf(label);
    if (!keys.length) {
      competencies.push(ins.kind);
      continue;
    }
    // A verdict on a combined label ("Gender and Age: ...") applies to every
    // criterion it names: a positive means all of them match, a warning at
    // worst that all fail. A separate judgement on one of them is still counted,
    // and the share of positive decides. Marks on criteria the recruiter did not
    // set are collected and never read below.
    for (const key of keys) {
      if (key.startsWith('other.')) {
        const sub = key.slice(6);
        (otherMarks[sub] = otherMarks[sub] || []).push(ins.kind);
      } else {
        marks[key].push(ins.kind);
      }
    }
  }

  let judged = false;
  let earned = 0;
  let possible = 0;
  const active = [];
  for (const key of ['position', 'location', 'years']) {
    if (!SET[key]) continue;
    earned += CRITERION_WEIGHTS[key] * creditOf(marks[key]);
    possible += CRITERION_WEIGHTS[key];
    if (tookSide(marks[key])) judged = true;
    active.push(key);
  }
  const otherSet = Object.keys(OTHER_SET).filter((sub) => OTHER_SET[sub]);
  if (otherSet.length) {
    const kindsBySub = otherSet.map((sub) => otherMarks[sub] || []);
    earned += CRITERION_WEIGHTS.other * mean(kindsBySub.map(creditOf));
    possible += CRITERION_WEIGHTS.other;
    if (kindsBySub.some(tookSide)) judged = true;
    active.push('other');
  }
  if (!judged) return null;
  const criteriaPct = (earned / possible) * 100;

  if (!competencies.length) {
    return { score: roundScore(criteriaPct), criteriaPct, competencyPct: null, active };
  }
  // Positive = 1, warning = 0, silent (neutral) = half.
  const competencyCredit = competencies.map((k) => (k === 'positive' ? 1 : k === 'warning' ? 0 : SILENT_CREDIT));
  const competencyPct = mean(competencyCredit) * 100;
  return {
    score: roundScore(0.7 * criteriaPct + 0.3 * competencyPct),
    criteriaPct,
    competencyPct,
    active,
  };
}

return inputs.map((item, index) => {
  const llmOut = item.json;
  const candidate = candidates[index]?.json || {};

  const raw = String(llmOut.text || llmOut.output || '').trim();
  let llmScore = null;
  let match_insights = [];

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      if (parsed.match_score != null && Number.isFinite(Number(parsed.match_score))) {
        llmScore = Math.max(0, Math.min(100, Math.round(Number(parsed.match_score))));
      }
      if (Array.isArray(parsed.match_insights)) {
        match_insights = parsed.match_insights
          .filter((x) => x && typeof x === 'object')
          .map((x) => ({
            kind: ['positive', 'warning', 'neutral'].includes(String(x.kind)) ? String(x.kind) : 'neutral',
            text: String(x.text || x.message || '').trim(),
          }))
          .filter((x) => x.text);
      }
    } catch (e) {}
  }

  /**
   * Fall back to the model's own number only when there is nothing to compute
   * from — a parse failure or an answer with no judged criterion. The old code
   * defaulted to a bare 50 here, which silently delivered unjudged candidates.
   */
  const computed = scoreFromInsights(match_insights);
  const match_score = computed ? computed.score : (llmScore == null ? 0 : llmScore);
  const score_source = computed ? 'computed' : (llmScore == null ? 'none' : 'llm-fallback');

  const { location_priority, __skip, ...rest } = candidate || {};

  return {
    json: {
      ...rest,
      match_score,
      llm_match_score: llmScore,
      score_source,
      ai_analysis: '',
      match_insights,
    },
  };
});
