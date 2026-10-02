const seen = {};
const merged = [];
let total = 0;
let failed = 0;

// Which query each call was sent for: the item Prepare Serp Pages emitted for it
// (exactly one per SerpAPI call, in order) - the same string phase 2 compares
// against. SerpAPI's echo in search_parameters is only a fallback.
let prepared = [];
try { prepared = $('Prepare Serp Pages').all(); } catch (e) {}
// One line per SerpAPI call, kept in this node's output (execution data) so the
// health of every page can be read back later: answered or not, how many
// results, how many of them LinkedIn profiles, and Google's own error string.
const serpStats = [];
const answeredQ = [];
const failedQ = [];

const inputItems = $input.all();
for (let idx = 0; idx < inputItems.length; idx++) {
  const item = inputItems[idx];
  total++;
  const json = item.json || {};
  const sentFor = (prepared[idx] && prepared[idx].json) || {};
  const q = String(sentFor.q || (json.search_parameters && json.search_parameters.q) || json.q || '').trim();
  const start = Number((json.search_parameters && json.search_parameters.start) || sentFor.start || 0);
  const organic = Array.isArray(json.organic_results) ? json.organic_results : [];
  const callAnswered = Boolean(json.search_metadata) || Array.isArray(json.organic_results);
  serpStats.push({
    q,
    start,
    answered: callAnswered && !item.error,
    organic: organic.length,
    linkedin: organic.filter((r) => /linkedin\.com\/in\//i.test(String((r && (r.link || r.url)) || ''))).length,
    totalResults: (json.search_information && json.search_information.total_results) ?? null,
    error: String(json.error || (item.error && item.error.message) || '') || null,
  });
  if (q) (callAnswered && !item.error ? answeredQ : failedQ).push(q);
  // Count a page as SUCCESSFUL only when it actually looks like a SerpApi answer.
  // A negative test is not enough, because the two failure shapes differ:
  //   per-item failure  -> n8n pushes { json: {}, error }        (routing-node.js)
  //   whole-node failure -> continueRegularOutput re-emits this node's INPUT
  //                         items, i.e. { q, start, __phase2 } — non-empty json
  //                         and NO error, which a negative test would score as a
  //                         successful empty search while the execution goes green.
  const answered = Boolean(json.search_metadata) || Array.isArray(json.organic_results);
  if (!answered || item.error) {
    failed++;
    continue;
  }
  const results = json.organic_results;
  if (!Array.isArray(results)) continue; // answered, found nothing — not a failure
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const link = String(r.link || r.url || '').trim();
    if (!link) continue;
    const key = link.toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    merged.push(r);
  }
}

// Phase 2 re-enters this node (Expand Phase 2 Queries -> Prepare Serp Pages ->
// Google SerpAPI Search -> here). It is an EXPANSION of a search that may have
// already sent candidates, so a total failure there must NOT be reported as a
// failed search — that would overwrite a partial success with an error.
// Decided exactly the way Prepare Serp Pages decides it, so the two cannot drift.
const wh = $('Webhook').first().json.body || {};
const searchId = String(wh.searchId || 'default');
const sd = $getWorkflowStaticData('global');
const isPhase2 = Boolean(sd.hhPhase2 && sd.hhPhase2[searchId]);

// EVERY page of PHASE 1 failed: a SerpApi outage or an exhausted quota, NOT an
// empty market. Report a failed search through the normal callback so the
// recruiter sees an error instead of reading "no candidates found".
// Partial failure (some pages fine) deliberately continues with what we have.
if (!isPhase2 && total > 0 && failed === total) {
  return [
    {
      json: {
        __completeOnly: true,
        searchFailed: true,
        errorMessage:
          'Search engine unavailable: all ' + total + ' page request(s) to SerpAPI failed.',
      },
    },
  ];
}

// PHASE 1 found no LinkedIn profile at all. Nothing downstream runs on an empty
// list, so the search would end without a completion and the recruiter would
// watch a spinner until the page gives up (10 minutes). Page 2 used to be the
// backup here - exec 2024 got 0 profiles from page 1 and 19 from page 2 - and
// neither tier asks for it any more, so close the search explicitly instead.
if (!isPhase2) {
  const profiles = merged.filter((r) => /linkedin\.com\/in\//i.test(String((r && (r.link || r.url)) || ''))).length;
  if (!profiles) {
    return [
      {
        json: {
          __completeOnly: true,
          searchFailed: failed > 0,
          errorMessage:
            failed > 0
              ? 'No LinkedIn profiles found: ' + failed + ' of ' + total + ' search request(s) to SerpAPI failed and the rest returned no profiles. Please try again.'
              : 'No LinkedIn profiles found for this search.',
          serpStats,
        },
      },
    ];
  }
}

// PHASE 2 found no LinkedIn profile at all: every call failed, Google answered "no
// results", or it ignored site:linkedin.com/in/. Split Out / Filter LinkedIn URLs
// would pass on an empty list and n8n runs nothing after an empty list: the search
// ended with no completion (record `submitted`, the page polling for 10 minutes)
// unless a late phase-1 loop-back happened to re-run the finalize nodes, which first
// re-sent the whole phase-1 shortlist. Phase 1 has already delivered, so this is not
// a failure: Phase 2 Found Nothing? hands the search to Finalize Phase 2 Send, which
// reports the phase-1 totals exactly as it does when phase 2 finds nobody new. The
// LinkedIn test is the one Filter LinkedIn URLs applies; a test pins the two together.
if (isPhase2 && !merged.some((r) => /linkedin\.com\/in\//i.test(String((r && (r.link || r.url)) || '')))) {
  return [{ json: { __completeOnly: true, __nothingToEnrich: true, __phase2: true, serpStats } }];
}

// Remember what phase 1 asked and whether it got an answer, so phase 2 does not
// pay for the same question again and retries only a call that got no answer
// (a SerpAPI 503)
// (read and cleared by Expand Phase 2 Queries; stale entries expire after 24 h).
if (!isPhase2) {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  sd.hhPhase1Serp = sd.hhPhase1Serp || {};
  for (const [id, rec] of Object.entries(sd.hhPhase1Serp)) {
    if (!rec || typeof rec.at !== 'number' || now - rec.at > DAY_MS) delete sd.hhPhase1Serp[id];
  }
  const answeredSet = [...new Set(answeredQ)];
  sd.hhPhase1Serp[searchId] = {
    at: now,
    answered: answeredSet,
    failed: [...new Set(failedQ)].filter((q) => answeredSet.indexOf(q) === -1),
  };
}

// __completeOnly is set explicitly (never left undefined) so the IF node that
// follows evaluates it under strict type validation without erroring.
return [{ json: { organic_results: merged, __completeOnly: false, serpStats } }];