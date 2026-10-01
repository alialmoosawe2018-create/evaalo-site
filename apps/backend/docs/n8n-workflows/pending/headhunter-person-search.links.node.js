/**
 * Person Search Links - read the Person Search answer and pick the phase-1 route.
 *
 * The request asked for links only (enrich_profiles=skip), as many as the search wants.
 * EnrichLayer bills 3 credits per result returned (measured 2026-10-01: 11 single-result
 * calls cost 33 credits). Results without a usable URL were never seen; they are billed
 * here too, to keep the spend record on the high side.
 *
 *   route 'ps'     - the links alone fill the search (>= 20 / 40): Google's phase 1 is
 *                    skipped; Google stays the phase-2 backup if candidates fall short.
 *   route 'google' - fewer links than the search wants, an error, 403/503 or nothing:
 *                    Google's phase 1 runs exactly as before, and whatever links we did
 *                    get are put in front of Google's (Add Person Search Links).
 *
 * Every link is rewritten to https://www.linkedin.com/in/<slug>: the search already
 * filtered by country=IQ, and Filter New URLs would otherwise drop a two-letter country
 * subdomain (ae., qa. ...) AFTER the route was chosen on it - a 'ps' route left with no
 * profile would end the search with no completion.
 *
 * A request that never got an answer (timeout, network) books the worst case, 3 x the
 * links asked for: EnrichLayer may still have billed it. If the Person Search node failed
 * as a whole, n8n passes this node its INPUT (the plan item): no request went out, nothing
 * is booked, and the reason is recorded. Links are kept in static data for this execution;
 * Add Person Search Links hands them on once and deletes them. This node never throws.
 */
let out = { __psRoute: 'google', links: 0, returned: 0, total: null, status: 0, error: '' };
try {
  const wh = $('Webhook').first().json.body || {};
  const searchId = String(wh.searchId || '');
  const plan = $('Person Search Plan').first().json || {};
  const target = Number(plan.target) >= 40 ? 40 : 20;
  const res = $input.first().json || {};
  const status = Number(res.statusCode || 0);
  const body = res.body && typeof res.body === 'object' ? res.body : {};
  const results = Array.isArray(body.results) ? body.results : null;
  const now = Date.now();
  let error = '';
  let booked = 0;
  if (res.error) {
    error = String(res.error.message || res.error).slice(0, 200);
    booked = 3 * target;
  } else if (!status && Object.prototype.hasOwnProperty.call(res, 'usePs')) {
    error = 'person search node failed (its input was passed on)';
  } else if (status !== 200) {
    error = 'person search answered ' + status;
  }

  const links = [];
  const seen = new Set();
  if (status === 200 && results) {
    for (const r of results) {
      const m = String((r && r.linkedin_profile_url) || '').trim().match(/linkedin\.com\/in\/([^?#/]+)/i);
      if (!m) continue;
      let slug = m[1];
      try { slug = decodeURIComponent(slug); } catch (e) {}
      slug = slug.trim().toLowerCase();
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      links.push('https://www.linkedin.com/in/' + m[1]);
    }
    booked = 3 * results.length;
  }
  const returned = status === 200 && results ? results.length : 0;
  const route = links.length >= target ? 'ps' : 'google';
  const total = typeof body.total_result_count === 'number' ? body.total_result_count : null;

  const sd = $getWorkflowStaticData('global');
  if (searchId) {
    if (sd.hhSpend && sd.hhSpend[searchId]) {
      sd.hhSpend[searchId].spent = Number(sd.hhSpend[searchId].spent || 0) + booked;
    }
    sd.hhPsLinks = sd.hhPsLinks || {};
    if (links.length) sd.hhPsLinks[searchId] = { at: now, links };
    else delete sd.hhPsLinks[searchId];
    sd.hhPersonSearch = sd.hhPersonSearch || {};
    sd.hhPersonSearch[searchId] = { at: now, status, total, returned, links: links.length, route, booked, error };
  }
  out = { __psRoute: route, links: links.length, returned, total, status, booked, error };
} catch (e) {
  out = { __psRoute: 'google', links: 0, returned: 0, total: null, status: 0, error: 'links error: ' + String((e && e.message) || e).slice(0, 200) };
}

return [{ json: out }];
