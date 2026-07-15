const wh = $('Webhook').first().json.body || {};
const searchId = String(wh.searchId || '');
const position = String(wh.position || '').trim();
const location = String(wh.location || '').trim();
const posLower = position.toLowerCase();
const locLower = location.toLowerCase();
const sd = $getWorkflowStaticData('global');

sd.hhPhase2 = sd.hhPhase2 || {};
sd.hhPhase2[searchId] = {
  pagesPerQuery: 3,
  maxEnrich: 40,
  queryVariants: 3,
};

const queries = [];
function add(q) {
  const s = String(q || '').trim();
  if (s && queries.indexOf(s) === -1) queries.push(s);
}

const iraqLoc =
  '("Baghdad" OR "Iraq" OR "بغداد" OR "العراق" OR "Basra" OR "Erbil" OR "Mosul" OR "Kirkuk" OR "Najaf")';

add(`site:linkedin.com/in/ "${position}" AND ${iraqLoc}`);

const words = position
  .split(/\s+/)
  .map((w) => w.trim())
  .filter((w) => w.length > 2)
  .slice(0, 5);
if (words.length) {
  add(`site:linkedin.com/in/ (${words.map((w) => `"${w}"`).join(' OR ')}) AND ${iraqLoc}`);
}

if (posLower.includes('support') || posLower.includes('helpdesk') || posLower.includes('it ')) {
  add(`site:linkedin.com/in/ ("IT Support" OR "Helpdesk" OR "Technical Support" OR "Desktop Support") AND ${iraqLoc}`);
}

if (posLower.includes('engineer')) {
  add(`site:linkedin.com/in/ ("Engineer" OR "مهندس") ("${words[0] || position.split(/\s+/)[0] || 'Engineer'}") AND ${iraqLoc}`);
}

if (locLower.includes('baghdad') || locLower.includes('بغداد')) {
  add(`site:linkedin.com/in/ "${position}" ("Baghdad" OR "بغداد")`);
}

return queries.slice(0, 3).map((q) => ({ json: { q, __phase2: true, searchId } }));
