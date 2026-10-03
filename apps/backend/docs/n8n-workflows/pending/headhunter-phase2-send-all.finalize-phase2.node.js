const wh = $('Webhook').first().json.body || {};
const searchId = String(wh.searchId || '');
const locationSearch = String(wh.location || '').toLowerCase();
const sd = $getWorkflowStaticData('global');
// Finalize ONCE per phase per search (2026-10): see Finalize Top N Send. A repeat run
// here found the pool gone and reported the phase-1 count as the total - 21 repeat
// completions in the 9 saved runs, 18 of them lower than the one posted - and
// overwrote hhSendProgress on the way. It now returns before touching anything else.
sd.hhFinalized = sd.hhFinalized || {};
const hhFin = sd.hhFinalized[searchId] || (sd.hhFinalized[searchId] = {});
if (hhFin.p2) return [];
hhFin.p2 = true;
const tier = $('Resolve Search Tier').first().json || {};
const minTarget = Number(tier.minCount) || 40;
const pool = sd.hhCandidates && sd.hhCandidates[searchId] ? [...sd.hhCandidates[searchId]] : [];
const sentKeys = new Set((sd.hhSentKeys && sd.hhSentKeys[searchId]) || []);

const isIraqSearch =
  locationSearch.includes('iraq') ||
  locationSearch.includes('baghdad') ||
  locationSearch.includes('عراق') ||
  locationSearch.includes('بغداد');

const US_EXCLUDE = [
  'united states', 'u.s.', 'usa', 'america', 'california', 'texas', 'new york', 'florida', 'orange county',
];
const NON_IRAQ_EXCLUDE = [
  'iran', 'tehran', 'turkey', 'uae', 'dubai', 'saudi', 'jordan', 'kuwait', 'qatar', 'egypt',
];

function norm(s) {
  return String(s || '').toLowerCase();
}

function profileKey(j) {
  const url = String(j.linkedin_url || '').trim().toLowerCase().split('?')[0];
  if (url) return url;
  return `name:${String(j.name || '').trim().toLowerCase()}`;
}

function isBadLocation(j) {
  const loc = norm(j.location);
  if (!loc) return false;
  if (US_EXCLUDE.some((t) => loc.includes(t))) return true;
  if (NON_IRAQ_EXCLUDE.some((t) => loc.includes(t)) && !loc.includes('iraq') && loc !== 'iq') return true;
  return false;
}

function rankScore(j) {
  let score = Number(j.match_score) || 0;
  if (Number(j.location_priority) === 1) score += 8;
  if (locationSearch.includes('baghdad') && norm(j.location).includes('baghdad')) score += 5;
  return score;
}

const ranked = pool.map((j) => ({ ...j }));
ranked.sort((a, b) => rankScore(b) - rankScore(a));

let shortlist = ranked.filter((j) => (Number(j.match_score) || 0) >= 50);
if (shortlist.length === 0) shortlist = ranked.filter((j) => (Number(j.match_score) || 0) >= 45);
if (shortlist.length === 0) shortlist = ranked.filter((j) => (Number(j.match_score) || 0) >= 40);
if (shortlist.length === 0) shortlist = ranked;

if (isIraqSearch) {
  const cleaned = shortlist.filter((j) => !isBadLocation(j));
  if (cleaned.length > 0) shortlist = cleaned;
}

shortlist.sort((a, b) => rankScore(b) - rankScore(a));
// EVERY new qualified candidate, not only the shortfall (owner decision 2026-10-03:
// "More than N" is a minimum, and each delivered candidate is billed as usual). The
// shortfall cut sent only enough to reach the target and dropped qualified people
// it had already paid to fetch and evaluate - 2 of the 5 found in exec 2069. Phase 1
// never capped. The phase-2 fetch cap (20 / 40) and the shared ceiling bound it.
const toSend = shortlist.filter((j) => !sentKeys.has(profileKey(j)));

if (sd.hhCandidates) delete sd.hhCandidates[searchId];
if (sd.hhExpansionActive) delete sd.hhExpansionActive[searchId];
if (sd.hhPhase2) delete sd.hhPhase2[searchId];

const phase1Count = (sd.hhPhase1SentCount && sd.hhPhase1SentCount[searchId]) || 0;
const totalAfter = phase1Count + toSend.length;

sd.hhSendProgress = sd.hhSendProgress || {};
sd.hhSendProgress[searchId] = {
  expected: toSend.length,
  sent: 0,
  phase: 2,
  phase1Count,
  minTarget,
  totalAfter,
};

if (toSend.length === 0) {
  return [
    {
      json: {
        searchId,
        searchComplete: true,
        __completeOnly: true,
        phase1Count,
        totalSent: phase1Count,
        minTarget,
        targetMet: phase1Count >= minTarget,
        expansionRan: true,
      },
    },
  ];
}

return toSend.map((j) => {
  const { location_priority, __skip, ...rest } = j;
  const key = profileKey(j);
  if (!sd.hhSentKeys) sd.hhSentKeys = {};
  if (!sd.hhSentKeys[searchId]) sd.hhSentKeys[searchId] = [];
  sd.hhSentKeys[searchId].push(key);
  return {
    json: {
      ...rest,
      __finalPhase: true,
      phase1Count,
      minTarget,
    },
  };
});
