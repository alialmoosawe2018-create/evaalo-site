/**
 * Filter New URLs — decide which LinkedIn profiles are worth paying EnrichLayer for.
 *
 * Every profile that passes this node is sent to EnrichLayer, which charges 2
 * credits per successful profile (1 base + 1 for the default `use_cache=if-recent`).
 * Measured on exec 2039 (HR Business Partner, Baghdad, 2026-09-29): 46 paid
 * profiles for 37 distinct people, and 24 of the 46 were people living outside
 * Iraq who the location filter then threw away. Two defects, both fixed here:
 *
 * 1. THE SAME PERSON WAS PAID FOR TWICE. The old code skipped only URLs in
 *    `sd.hhSeenUrls[searchId]`, which `Finalize Top N Send` fills from the
 *    SHORTLIST. Everyone enriched in phase 1 but rejected or not shortlisted was
 *    therefore "new" again in phase 2 — paid for, and rejected, a second time.
 *    9 of the 46 calls in exec 2039 were such repeats. Now every profile sent to
 *    EnrichLayer is remembered for the rest of the search, keyed by the slug in
 *    the URL we REQUESTED. Not by the id EnrichLayer returns: in 3 of 118
 *    measured profiles LinkedIn had renamed the profile, so the returned id no
 *    longer matches what Google hands us next time — one of those was a paid
 *    repeat in exec 2039. Duplicates inside one batch are dropped too.
 *
 * 2. FOREIGNERS WERE PAID FOR BEFORE BEING REJECTED. For an Iraq search, a result
 *    on a two-letter country subdomain (`ae.`, `qa.`, `ch.`, `eg.`, `in.` …) was
 *    measured foreign every time: 11 of 11 in exec 2039 and 22 of 22 across execs
 *    2035/2036, with no Iraqi among them. Those are now dropped before enrichment.
 *    Kept: `www.` (carries no country signal — 12 Americans came that way, a query
 *    problem, not a URL one), `iq.`, and `sy.` — twice a `sy.` profile turned out
 *    to be living in Erbil, Iraq, so Syria's code is not trusted as proof.
 *    Only for Iraq searches; for any other location nothing is filtered by URL.
 *
 * THIS NODE IS THE ONLY CAP ON PAID ENRICHMENT, in both phases (2026-10-01).
 * The built-in `Limit Candidates` node that follows has never cut anything: its
 * maxItems expression calls $getWorkflowStaticData, which exists only inside
 * Code nodes, not in n8n expressions, so it resolves to undefined and the limit
 * keeps every item - 27 of 27 retained Limit runs passed their input through
 * unchanged, up to 45 profiles in a phase 2 whose recorded cap was 20 or 40.
 * So the caps live here, where static data can be read:
 *   - phase 1: the tier's `maxEnrich` from Resolve Search Tier (35 / 55);
 *   - phase 2: the `maxEnrich` Expand Phase 2 Queries records in hhPhase2
 *     (20 for Tier 20, 40 for Tier 40) - set since 2026-09-17, applied only now.
 * A profile the cap leaves out is NOT remembered as fetched, so it is never
 * skipped later without having been evaluated. Profiles are taken in the order
 * Google returned them, query by query.
 *
 * The record lives in workflow static data for the length of one search and
 * prunes itself after 24 hours, so it cannot grow without bound.
 *
 * SHARED CEILING (Person Search first, 2026-10). When Person Search Plan opened a spend
 * record (sd.hhSpend[searchId] = {ceiling, spent}), the whole search may use at most
 * 120 (Tier 20) / 240 (Tier 40) EnrichLayer credits. Person Search Links has already
 * booked 3 per result returned; here every profile sent on books its enrichment - 1 for
 * a Person Search link (use_cache=if-present, per EnrichLayer's docs), 2 for any other
 * (if-recent). Phase 1 stops taking a profile that would leave less than 2 credits, so
 * phase 2 can always send at least one: an empty list here would end the search with no
 * completion. Phase 2 takes what the rest pays for. The record counts one request per
 * profile; n8n's whole-node retry of Enrichlayer Profile Fetch (retryOnFail) can bill a
 * batch again and is not seen here. Without a spend record nothing changes.
 */
const wh = $('Webhook').first().json.body || {};
const searchId = String(wh.searchId || '');
const locationSearch = String(wh.location || '').toLowerCase();
const sd = $getWorkflowStaticData('global');

// The old shortlist-based record is still honoured; it is a subset of the new one.
const legacySeen = new Set((sd.hhSeenUrls && sd.hhSeenUrls[searchId]) || []);

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.now();
sd.hhFetched = sd.hhFetched || {};
for (const [id, rec] of Object.entries(sd.hhFetched)) {
  if (!rec || typeof rec.at !== 'number' || now - rec.at > DAY_MS) delete sd.hhFetched[id];
}
const fetched = new Set((sd.hhFetched[searchId] && sd.hhFetched[searchId].slugs) || []);

function slugOf(link) {
  const m = String(link || '').match(/linkedin\.com\/in\/([^?#/]+)/i);
  if (!m) return '';
  let s = m[1];
  try { s = decodeURIComponent(s); } catch (e) {}
  return s.trim().toLowerCase();
}

function subdomainOf(link) {
  const m = String(link || '').match(/^https?:\/\/([a-z0-9-]+)\.linkedin\.com/i);
  return m ? m[1].toLowerCase() : '';
}

// Same definition `Map Candidate Fields` uses.
const isIraqSearch = ['iraq', 'baghdad', 'عراق', 'بغداد'].some((t) => locationSearch.includes(t));
const IRAQ_SEARCH_KEEP = new Set(['www', 'iq', 'sy']);

function foreignSubdomain(link) {
  if (!isIraqSearch) return false;
  const sub = subdomainOf(link);
  return /^[a-z]{2}$/.test(sub) && !IRAQ_SEARCH_KEEP.has(sub);
}

const inPhase2 = Boolean(sd.hhPhase2 && sd.hhPhase2[searchId]);
const tier = $('Resolve Search Tier').first().json || {};
const tierCap = Number(tier.maxEnrich);
const phase2Cap = inPhase2 ? Number(sd.hhPhase2[searchId].maxEnrich) : NaN;
const cap = inPhase2
  ? (phase2Cap > 0 ? phase2Cap : Infinity)
  : (tierCap > 0 ? tierCap : Infinity);
const spend = sd.hhSpend && sd.hhSpend[searchId];
const budgetCap = spend && inPhase2
  ? Math.max(1, Math.floor((Number(spend.ceiling) - Number(spend.spent || 0)) / 2))
  : Infinity;
const limit = Math.min(cap, budgetCap);
const costOf = (item) => (item.json && item.json.__ps === true ? 1 : 2);
let phase1Spent = spend ? Number(spend.spent || 0) : 0;

const out = [];
const taken = new Set();
for (const item of $input.all()) {
  const link = String(item.json.link || item.json.url || '').trim();
  if (!link) continue;
  const lower = link.toLowerCase();
  if (legacySeen.has(lower.split('?')[0]) || legacySeen.has(lower)) continue;
  const slug = slugOf(link);
  if (!slug) continue;
  if (fetched.has(slug) || taken.has(slug)) continue;
  if (foreignSubdomain(link)) continue;
  if (out.length >= limit) break;
  if (spend && !inPhase2) {
    if (phase1Spent + costOf(item) > Number(spend.ceiling) - 2) continue;
    phase1Spent += costOf(item);
  }
  taken.add(slug);
  out.push(item);
}

sd.hhFetched[searchId] = { at: now, slugs: [...fetched, ...taken] };
if (spend) spend.spent = Number(spend.spent || 0) + out.reduce((n, i) => n + costOf(i), 0);
return out;
