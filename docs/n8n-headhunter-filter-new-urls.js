const wh = $('Webhook').first().json.body || {};
const searchId = String(wh.searchId || '');
const sd = $getWorkflowStaticData('global');
const seen = new Set((sd.hhSeenUrls && sd.hhSeenUrls[searchId]) || []);

return $input.all().filter((item) => {
  const link = String(item.json.link || item.json.url || '').trim().toLowerCase();
  if (!link) return false;
  const key = link.split('?')[0];
  return !seen.has(key) && !seen.has(link);
});
