const wh = $('Webhook').first().json.body || {};
const searchId = String(wh.searchId || 'default');
const sd = $getWorkflowStaticData('global');
if (!sd.hhCandidates) sd.hhCandidates = {};
if (!sd.hhCandidates[searchId]) sd.hhCandidates[searchId] = [];

const item = $json || {};
const score = Number(item.match_score) || 0;

// Preliminary filter only — final Top N ranking happens after the full pool is collected.
if (score >= 25 && item.name) {
  sd.hhCandidates[searchId].push(item);
}

return {
  json: {
    accumulated: true,
    searchId,
    score,
    poolSize: sd.hhCandidates[searchId].length,
  },
};
