const wh = $('Webhook').first().json.body || {};
const searchId = String(wh.searchId || '');
const locationSearch = String(wh.location || '').toLowerCase();
const sd = $getWorkflowStaticData('global');
const tier = $('Resolve Search Tier').first().json || {};
const minTarget = Number(tier.minCount) || 20;
const stats = (sd.hhStats && sd.hhStats[searchId]) || { enrichOk: 0, enrichErr: 0 };
const pool = sd.hhCandidates && sd.hhCandidates[searchId] ? [...sd.hhCandidates[searchId]] : [];

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

function buildShortlist(sourcePool) {
  const ranked = sourcePool.map((j) => ({ ...j }));
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
  return shortlist;
}

const shortlist = buildShortlist(pool);
const needsExpansion =
  minTarget >= 40 && shortlist.length < minTarget && !sd.hhExpanded?.[searchId];

if (needsExpansion) {
  sd.hhExpanded = sd.hhExpanded || {};
  sd.hhExpanded[searchId] = true;
  sd.hhExpansionPending = sd.hhExpansionPending || {};
  sd.hhExpansionPending[searchId] = true;
  sd.hhSeenUrls = sd.hhSeenUrls || {};
  sd.hhSeenUrls[searchId] = shortlist
    .map((j) => String(j.linkedin_url || '').trim().toLowerCase().split('?')[0])
    .filter(Boolean);
  sd.hhSentKeys = sd.hhSentKeys || {};
  sd.hhSentKeys[searchId] = shortlist.map((j) => profileKey(j));
  sd.hhPhase1SentCount = sd.hhPhase1SentCount || {};
  sd.hhPhase1SentCount[searchId] = shortlist.length;
  sd.hhSendProgress = sd.hhSendProgress || {};
  sd.hhSendProgress[searchId] = { expected: shortlist.length, sent: 0, phase: 1 };
} else {
  if (sd.hhCandidates) delete sd.hhCandidates[searchId];
  sd.hhSendProgress = sd.hhSendProgress || {};
  sd.hhSendProgress[searchId] = { expected: shortlist.length, sent: 0, phase: 1 };
}

if (shortlist.length === 0) {
  let errorMessage = '';
  let searchFailed = false;

  if (stats.enrichOk === 0 && stats.enrichErr > 0) {
    searchFailed = true;
    errorMessage =
      'Enrichlayer: insufficient credits — all profile enrichments failed. Top up credits at enrichlayer.com and retry.';
  } else if (pool.length === 0) {
    errorMessage = 'No candidates passed the preliminary AI score threshold (25).';
  } else {
    errorMessage = 'No candidates available after final ranking.';
  }

  return [
    {
      json: {
        searchId,
        searchComplete: true,
        searchFailed,
        errorMessage,
        __completeOnly: true,
      },
    },
  ];
}

return shortlist.map((j) => {
  const { location_priority, __skip, ...rest } = j;
  return {
    json: {
      ...rest,
      __expansionPending: needsExpansion,
    },
  };
});
