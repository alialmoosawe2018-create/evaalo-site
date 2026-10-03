/**
 * Person Search Plan - should this search ask EnrichLayer Person Search first?
 *
 * Owner-approved design (2026-10-01, measured the same day: 10 of 10 profiles in Iraq,
 * 80-90% passed our evaluation against 43-58% on the Google path, and 0 of 20 overlapped
 * with what Google had found). Person Search returns profile LINKS only (3 credits per
 * result returned); they join the existing path in front of Filter New URLs, so dedupe,
 * the enrichment cap, the loop, the evaluation, sending and billing all stay as they are -
 * the one addition is the shared ceiling below, which Filter New URLs enforces.
 *
 *   - Iraq searches only (the same four location words Map Candidate Fields uses), with
 *     a plain-English title: the recruiter's own, or for an Arabic title its English
 *     translation (Apply Translation, the text Google's queries use; 2026-10-03).
 *   - It asks for as many links as the search wants (20 / 40). Google's phase 1 is skipped
 *     only when Person Search fills that number by itself; otherwise both run together.
 *   - It opens a spend record: the WHOLE search may use at most 120 (Tier 20) / 240
 *     (Tier 40) EnrichLayer credits. Filter New URLs enforces it in both phases.
 *   - CONFIG.orgAllowlist empty means EVERY organisation. Switched on for every organisation
 *     on 2026-10-03 (owner decision: few subscribers yet, so no allowlist).
 *
 * Any failure here falls back to the Google path exactly as it was. This node never throws.
 */
const CONFIG = {
  enabled: true, // on for every organisation since 2026-10-03 (owner decision: few subscribers yet)
  orgAllowlist: [], // empty = every organisation; otherwise only these organizationIds
  ceiling: { 20: 120, 40: 240 }, // EnrichLayer credits for the whole search
};
const DAY_MS = 24 * 60 * 60 * 1000;
// Same definition `Map Candidate Fields` uses.
const IRAQ_WORDS = ['iraq', 'baghdad', 'عراق', 'بغداد'];

let decision = { usePs: false, reason: '', target: 20, query: null };
try {
  const wh = $('Webhook').first().json.body || {};
  const searchId = String(wh.searchId || '');
  const tier = $('Resolve Search Tier').first().json || {};
  const target = Number(tier.minCount) >= 40 ? 40 : 20;
  const ascii = (s) => /^[\x20-\x7e]*$/.test(s);
  // The recruiter's own title when it is plain English. An Arabic title searches by its
  // English translation - the one Google's queries are built from - instead of skipping.
  const rawPosition = String(wh.position || '');
  let titleSource = rawPosition;
  if (!ascii(rawPosition)) {
    try {
      titleSource = String($('Apply Translation').first().json.position || '');
    } catch (e) {
      titleSource = '';
    }
  }
  const location = String(wh.location || '').toLowerCase();
  const title = titleSource
    .replace(/["“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 80)
    .trim();
  const org = String(wh.organizationId || '');
  decision.target = target;

  if (!CONFIG.enabled) decision.reason = 'disabled';
  else if (!searchId) decision.reason = 'no searchId';
  else if (CONFIG.orgAllowlist.length && !CONFIG.orgAllowlist.includes(org)) decision.reason = 'organisation not in the allowlist';
  else if (!IRAQ_WORDS.some((w) => location.includes(w))) decision.reason = 'not an Iraq search';
  else if (!title || !/[a-z]/.test(title) || !ascii(title) || !ascii(titleSource)) decision.reason = 'title is not plain English';
  else {
    decision.usePs = true;
    decision.reason = 'person search first';
    decision.query = {
      country: 'IQ',
      current_role_title: '"' + title + '"',
      enrich_profiles: 'skip',
      page_size: String(target),
    };
    const sd = $getWorkflowStaticData('global');
    const now = Date.now();
    for (const key of ['hhSpend', 'hhPersonSearch', 'hhPsLinks']) {
      sd[key] = sd[key] || {};
      for (const [id, rec] of Object.entries(sd[key])) {
        const at = rec && typeof rec.at === 'number' ? rec.at : 0;
        if (now - at > DAY_MS) delete sd[key][id];
      }
    }
    sd.hhSpend[searchId] = { ceiling: CONFIG.ceiling[target], spent: 0, at: now };
  }
} catch (e) {
  decision = { usePs: false, reason: 'plan error: ' + String((e && e.message) || e).slice(0, 200), target: decision.target, query: null };
}

return [{ json: decision }];
