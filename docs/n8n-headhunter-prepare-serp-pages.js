const wh = $('Webhook').first().json.body || {};
const searchId = String(wh.searchId || 'default');
const sd = $getWorkflowStaticData('global');
const tier = $('Resolve Search Tier').first().json || {};
const phase2 = sd.hhPhase2 && sd.hhPhase2[searchId];
const pagesPerQuery = phase2 ? Number(phase2.pagesPerQuery) || 3 : Number(tier.pagesPerQuery) || 2;

const out = [];
for (const item of $input.all()) {
  const q = String(item.json.q || '').trim();
  if (!q) continue;
  for (let p = 0; p < pagesPerQuery; p++) {
    out.push({ json: { q, start: p * 10, __phase2: Boolean(phase2) } });
  }
}
return out;
