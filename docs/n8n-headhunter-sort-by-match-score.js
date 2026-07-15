const webhook = $('Webhook').first().json.body || {};
const locationSearch = String(webhook.location || '').toLowerCase();
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

const items = $input.all().map((i) => i.json);
items.sort((a, b) => rankScore(b) - rankScore(a));

let pool = items.filter((j) => (Number(j.match_score) || 0) >= 50);
if (pool.length === 0) pool = items.filter((j) => (Number(j.match_score) || 0) >= 45);
if (pool.length === 0) pool = items.filter((j) => (Number(j.match_score) || 0) >= 40);
if (pool.length === 0) pool = items;

if (isIraqSearch) {
  const cleaned = pool.filter((j) => !isBadLocation(j));
  if (cleaned.length > 0) pool = cleaned;
}

pool.sort((a, b) => rankScore(b) - rankScore(a));

return pool.map((j) => {
  const { location_priority, __skip, ...rest } = j;
  return { json: rest };
});
