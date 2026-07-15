const wh = $('Webhook').first().json.body || {};
const searchId = String(wh.searchId || 'default');
const sd = $getWorkflowStaticData('global');
if (!sd.hhStats) sd.hhStats = {};
if (!sd.hhStats[searchId]) sd.hhStats[searchId] = { enrichOk: 0, enrichErr: 0 };

for (const item of $input.all()) {
  const p = item.json || {};
  if (p.error) sd.hhStats[searchId].enrichErr += 1;
  else if (p.full_name || p.headline || p.occupation || p.public_identifier || p.linkedin_profile_url) {
    sd.hhStats[searchId].enrichOk += 1;
  }
}

return $input.all();
