const webhook = $('Webhook').first().json.body || {};
const searchId = String(webhook.searchId || 'default');
const sd = $getWorkflowStaticData('global');
if (!sd.hhStats) sd.hhStats = {};
sd.hhStats[searchId] = { enrichOk: 0, enrichErr: 0 };
if (!sd.hhCandidates) sd.hhCandidates = {};
sd.hhCandidates[searchId] = [];

const raw = Number(webhook.minCandidateCount) || 20;
const minCount = raw >= 40 || raw === 30 ? 40 : 20;
const isFull = minCount >= 40;

return [
  {
    json: {
      minCount,
      queryVariants: isFull ? 4 : 2,
      pagesPerQuery: isFull ? 5 : 2,
      maxEnrich: isFull ? 55 : 35,
      streamBatchSize: 20,
    },
  },
];
