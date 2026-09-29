/**
 * Apply AI Analysis — the score is COMPUTED here, not taken from the model.
 *
 * WHY (measured on execs 2035 and 2036, 2026-09-30):
 * the model was returning 35 for candidates whose own insights said
 * `position: positive` and `location: positive`. The prompt's own rubric is
 * Position 35% + Location 30% + Years 15% + other 20%, so positive on the two
 * heaviest criteria is at least 65 before anything else — 35 is arithmetically
 * impossible under it. In exec 2036, 10 of the 14 candidates who were actually
 * in Iraq scored exactly 35, five of them physically in Baghdad, and the whole
 * search delivered 2 instead of 20.
 *
 * The only number in the prompt is the location cap ("cap match_score at 35"),
 * written for candidates OUTSIDE Iraq/the Middle East, and the model anchored
 * on it for everyone. Two insights said so in words: "the system caps score at
 * 35 for Baghdad, Iraq location" and "Erbil (Northern Iraq), not Baghdad".
 *
 * The per-criterion JUDGEMENTS are sound — 46 real candidates were reviewed and
 * each carries specific, distinct reasoning. It is only the arithmetic that is
 * unreliable. So the model keeps judging and this node does the arithmetic,
 * which is exactly how the Stage 1 screener was fixed.
 *
 * The prompt is deliberately NOT changed by this patch: it already emits one
 * insight per active criterion with a `kind`, which is the whole input needed.
 * The model's own number is kept as `llm_match_score` so the two can be
 * compared in production instead of argued about.
 *
 * No location cap is applied here. `Map Candidate Fields` now decides residence
 * from the current country and drops the rest before scoring (version d9583254),
 * so for an Iraq search every candidate reaching this node is already in Iraq.
 */
const mapValid = $('Map Candidate Fields').all().filter((item) => !item.json.__skip);
const inputs = $input.all();
const candidates = mapValid.slice(-inputs.length);

/** The rubric the prompt states, in one place. */
const CRITERION_WEIGHTS = { position: 35, location: 30, years: 15, other: 20 };

/**
 * Which criterion an insight belongs to, or null when it is a competency.
 * Real labels seen in production include "position", "Location", "years of
 * experience", "yearsOfExperience", "Gender and Age" and "location (final cap)",
 * so matching is on letters only.
 */
function criterionOf(label) {
  const k = String(label || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!k) return null;
  if (k.startsWith('position')) return 'position';
  if (k.startsWith('location')) return 'location';
  if (k.startsWith('years')) return 'years';
  if (
    k === 'requiredlanguages' || k === 'languages' ||
    k === 'requiredskills' || k === 'skills' ||
    k === 'certifications' || k === 'company' ||
    k === 'gender' || k === 'age' || k === 'genderandage' || k === 'notes'
  ) return 'other';
  return null;
}

/**
 * Score from the insights.
 *
 * A criterion with no insight, or only neutral ones, is NOT counted at all —
 * the prompt promises "Unspecified criteria = neutral, no penalty", and leaving
 * it in the denominator would break that promise. Competencies that say nothing
 * are dropped for the same reason, and when every competency is neutral the
 * competency half is skipped entirely rather than scored as zero.
 */
function scoreFromInsights(insights) {
  const buckets = { position: [], location: [], years: [], other: [] };
  const competencies = [];
  for (const ins of insights) {
    const label = String(ins.text || '').split(':')[0];
    const key = criterionOf(label);
    if (key) buckets[key].push(ins.kind);
    else competencies.push(ins.kind);
  }

  let earned = 0;
  let possible = 0;
  const active = [];
  for (const [key, kinds] of Object.entries(buckets)) {
    const judged = kinds.filter((k) => k === 'positive' || k === 'warning');
    if (!judged.length) continue;
    const w = CRITERION_WEIGHTS[key];
    possible += w;
    earned += w * (judged.filter((k) => k === 'positive').length / judged.length);
    active.push(key);
  }
  if (!possible) return null;
  const criteriaPct = (earned / possible) * 100;

  const judgedComp = competencies.filter((k) => k === 'positive' || k === 'warning');
  if (!judgedComp.length) {
    return { score: Math.round(criteriaPct), criteriaPct, competencyPct: null, active };
  }
  const competencyPct = (judgedComp.filter((k) => k === 'positive').length / judgedComp.length) * 100;
  return {
    score: Math.round(0.7 * criteriaPct + 0.3 * competencyPct),
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
