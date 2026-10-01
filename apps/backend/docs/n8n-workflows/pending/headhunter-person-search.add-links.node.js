/**
 * Add Person Search Links - put the Person Search links in front of the phase-1 list.
 *
 * Sits between Filter LinkedIn URLs and Filter New URLs, and is reached two ways in
 * phase 1 (only one per search):
 *   - from Skip Google? when Person Search filled the search by itself: the input is a
 *     control item, the output is the Person Search links alone;
 *   - from Filter LinkedIn URLs after Google's phase 1: the Person Search links (if any)
 *     go FIRST - they passed our evaluation far more often - then Google's.
 * Each Person Search link is marked __ps so Enrichlayer Profile Fetch asks for the
 * cached profile (use_cache=if-present, 1 credit instead of 2). The links are handed on
 * once and deleted. Phase 2 passes through untouched.
 */
const wh = $('Webhook').first().json.body || {};
const searchId = String(wh.searchId || '');
const sd = $getWorkflowStaticData('global');
const items = $input.all();

if (sd.hhPhase2 && sd.hhPhase2[searchId]) return items;

const isLink = (j) => /linkedin\.com\/in\//i.test(String((j && (j.link || j.url)) || ''));
const rec = sd.hhPsLinks && sd.hhPsLinks[searchId];
const psLinks = rec && Array.isArray(rec.links) ? rec.links : [];
if (sd.hhPsLinks) delete sd.hhPsLinks[searchId];

const fromSearch = psLinks.map((link) => ({ json: { link, __ps: true } }));
return [...fromSearch, ...items.filter((i) => isLink(i.json))];
