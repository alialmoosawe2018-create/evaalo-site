return $input.all().map((item) => {
  const llmOut = item.json;
  const candidate = $('Map Candidate Fields').itemMatching(item).json;

  const raw = String(llmOut.text || llmOut.output || '').trim();
  let match_score = 50;
  let match_insights = [];

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      if (parsed.match_score != null && Number.isFinite(Number(parsed.match_score))) {
        match_score = Math.max(0, Math.min(100, Math.round(Number(parsed.match_score))));
      }
      if (Array.isArray(parsed.match_insights)) {
        match_insights = parsed.match_insights
          .filter((x) => x && typeof x === 'object')
          .map((x) => ({
            kind: ['positive', 'warning', 'neutral'].includes(String(x.kind)) ? String(x.kind) : 'neutral',
            text: String(x.text || x.message || '').trim(),
          }))
          .filter((x) => x.text);
      }
    } catch (e) {}
  }

  const { location_priority, __skip, ...rest } = candidate || {};

  // Smart Match only. The verbose ai_analysis paragraph is no longer generated;
  // sent empty to keep the downstream payload shape stable.
  return {
    json: {
      ...rest,
      match_score,
      ai_analysis: '',
      match_insights,
    },
  };
});
