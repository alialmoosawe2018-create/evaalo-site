const wh = $('Webhook').first().json.body || {};
const searchId = String(wh.searchId || '');
const t = $('Apply Translation').first().json || {};
const position = String(t.position || wh.position || '').trim();
const location = String(t.location || wh.location || '').trim();
const posLower = position.toLowerCase();
const sd = $getWorkflowStaticData('global');

sd.hhPhase2 = sd.hhPhase2 || {};
// Scale the second wave to the tier. (maxEnrich is recorded here but enforces
// nothing: the Limit Candidates expression that should read it calls
// $getWorkflowStaticData, which does not exist in n8n expressions, so it
// resolves to undefined and the limit keeps every item. queryVariants is
// carried for readability only. The planned list below is sliced at three;
// phase-1 queries SerpAPI gave up on are retried on top of it.)
const tierMin = Number($('Resolve Search Tier').first().json?.minCount) || 40;
sd.hhPhase2[searchId] =
  tierMin >= 40
    ? { pagesPerQuery: 1, maxEnrich: 40, queryVariants: 3 } // page 1 only: see Resolve Search Tier
    : { pagesPerQuery: 1, maxEnrich: 20, queryVariants: 3 }; // page 1 only: see Resolve Search Tier

function buildLocFilter(loc) {
  const l = String(loc || '').trim();
  if (!l) return '("Iraq")';
  const city = l.split(',')[0].trim();
  const terms = [];
  if (city) terms.push('"' + city + '"');
  terms.push('"Iraq"');
  return '(' + terms.join(' OR ') + ')';
}
const iraqLoc = buildLocFilter(location);

const queries = [];
function add(q) {
  const s = String(q || '').trim();
  if (s && queries.indexOf(s) === -1) queries.push(s);
}

if (position) add(`site:linkedin.com/in/ "${position}" AND ${iraqLoc}`);

const words = position
  .split(/\s+/)
  .map((w) => w.trim())
  .filter((w) => w.length > 2)
  .slice(0, 5);
if (words.length) {
  add(`site:linkedin.com/in/ (${words.map((w) => `"${w}"`).join(' OR ')}) AND ${iraqLoc}`);
}

if (posLower.includes('support') || posLower.includes('helpdesk') || posLower.includes('it ')) {
  add(
    `site:linkedin.com/in/ ("IT Support" OR "Helpdesk" OR "Technical Support" OR "Desktop Support") AND ${iraqLoc}`
  );
}

if (posLower.includes('engineer')) {
  add(
    `site:linkedin.com/in/ ("Engineer") ("${words[0] || position.split(/\s+/)[0] || 'Engineer'}") AND ${iraqLoc}`
  );
}

const city = location.split(',')[0].trim();
if (city && position) {
  add(`site:linkedin.com/in/ "${position}" ("${city}" OR "Iraq")`);
}

const planned = queries.slice(0, 3);

// Both tiers (Tier 40 joined on 2026-10-01, after its two measured runs: in
// exec 2040 SerpAPI gave up on two of its page-1 queries and neither was ever
// sent again; in exec 2044 one was, only because phase 2 happened to repeat it).
//
// Phase 1 already asked Google some of these queries. Asking again inside
// SerpAPI's one-hour cache returns the identical cached copy: 26 of the 29 exact
// repeats in the retained runs (to exec 2044) carried the same search id and
// added no profile; the other 3 re-sent calls that had come back as a 503.
// So a query phase 1 got an ANSWER for is not sent again. A phase-1 query that
// got NO answer - SerpAPI's HTTP 503 "Service unavailable", returned when it
// gives up after ~90 s ("We couldn't get valid results for this search"); a
// Google "no results" IS an answer - is sent once more here: in execs 2024 and
// 2044 such a re-send brought 9 and 10 profiles, and SerpAPI does not bill an
// errored search. n8n's own retryOnFail is no substitute: with
// continueRegularOutput it only inspects the FIRST item's json.error, so a
// per-call 503 is retried only by
// accident - when item 0 happens to be a Google "no results" answer, which
// then re-runs the whole node against SerpAPI's cache. This retry fires only
// when phase 2 starts, i.e. phase 1 delivered at least one candidate.
const phase1 = (sd.hhPhase1Serp && sd.hhPhase1Serp[searchId]) || {};
const answered = new Set(Array.isArray(phase1.answered) ? phase1.answered : []);
const failed = Array.isArray(phase1.failed) ? phase1.failed : [];
let toSend = [];
for (const q of [...failed, ...planned]) {
  if (!answered.has(q) && toSend.indexOf(q) === -1) toSend.push(q);
}
// Never hand phase 2 an empty list: no node downstream would run at all. If
// every planned query was already answered, keep the old behaviour - the first
// planned query, a free cache hit. (Parity only: a phase 2 that finds no new
// profile still ends without a completion, as it always has.)
if (!toSend.length && planned.length) toSend = [planned[0]];
if (sd.hhPhase1Serp) delete sd.hhPhase1Serp[searchId];

return toSend.map((q) => ({ json: { q, __phase2: true, searchId } }));