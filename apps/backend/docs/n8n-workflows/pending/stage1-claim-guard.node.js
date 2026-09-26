/*
 * Stage 1 Claim Guard — PROPOSED, NOT LIVE. Sits between "Stage 1 Assessment LLM" and
 * "Stage 1 Scoring" (workflow 93b459bc, base version ec1f1214). See ../README.md.
 *
 * A claim is not evidence, and missing evidence is not evidence of failure.
 *  - A verifiable criterion (experience, skills, education, career level, management
 *    track, industry, employer, certifications, languages, employer-written customs)
 *    that the assessor marked met/partial on an application field or the cover letter
 *    ALONE becomes not_assessed: 0 points, stored as insufficient_evidence.
 *  - Mixed evidence (the CV or certificate text also supports it) is never touched.
 *  - Never touched: position (the job applied for), location, the application-native
 *    keys (salary, availability, gender, age), routing meta keys, "missing", and an
 *    experience criterion whose months were counted from CV dates.
 *  - An integrity concern that quotes the job applied for (S24), or a typed skill the CV
 *    merely does not mention, is dropped; injection-looking concerns are always kept, and so
 *    is a quote that goes on past the title with a figure or a concern about years, and a
 *    skill concern that names a contradiction.
 *  - Employer-written custom criteria (keys not in the tables below) are SHADOW only: the
 *    guard records what it would do and changes nothing — the code has no metadata saying
 *    whether such a criterion needs a document or is the candidate's own declaration.
 *  - When nothing changes, the ORIGINAL item passes through, so Scoring is byte-identical.
 *
 * FAIL CLOSED (owner, 2026-09-26). A technical failure is never a hiring judgment. The node
 * THROWS — which stops the run before the callback, so no verdict is recorded — when:
 *  - the campaign criteria cannot be read (missing, unparseable, not a list);
 *  - the evaluator output cannot be parsed, or - for a non-empty rubric - carries no criteria
 *    list or returns no criteria (this also closes S26: such output used to reach Scoring as
 *    {} and come back as insufficient_data / Consider);
 *  - anything inside the guard itself fails.
 * A campaign whose criteria list is genuinely EMPTY is not a failure: whatever criteria the
 * evaluator returns (or omits), it passes through and Scoring handles it exactly as today;
 * only an unparseable evaluator output still stops it; a list holding only routing meta keys
 * counts as empty. Error texts avoid the colon-space sequence because n8n shows only what
 * follows the last one, and name the candidate and application ids (never personal data):
 * n8n has already answered "Accepted", so the backend marked the dispatch delivered, and the
 * owner re-sends it by resetting that outbox row (see ../README.md).
 *
 * Rules for this file: it is pasted into an n8n Code node through the API later, so it
 * contains NO backslash, NO backtick and no dollar-brace sequence.
 */
var GUARD_VERSION = 'claim-guard/1';
var MODE = 'enforce'; // 'shadow' = audit only; Scoring input untouched
var CUSTOM_POLICY = 'shadow'; // employer-written custom criteria: audit only, never converted
var SKIP_META = { rolekey: 1, labelkey: 1, rolematchsource: 1, evaluationlanguage: 1 };
var DECLARATION = { salarymin: 1, salarymax: 1, salarycurrency: 1, availability: 1, gender: 1, age: 1 };
var EXEMPT = { location: 1, position: 1 };
var VERIFIABLE = { experienceyears: 1, skills: 1, careerlevel: 1, managementtrack: 1, educationlevel: 1, certifications: 1, industrytype: 1, languages: 1, company: 1, job: 1 };
var DISPLAY = { experienceyears: 'relevant experience', educationlevel: 'education', careerlevel: 'career level', managementtrack: 'management track', industrytype: 'industry', company: 'employer', job: 'job level' };
var INJECTION = ['ignore', 'instruction', 'prompt', 'disregard', 'override', 'recommend', 'system', 'give me', 'تجاهل', 'تعليمات'];
var NOTE_HEAD = 'Candidate reported ';
var NOTE_TAIL = ', but no supporting CV or certificate evidence was available.';
var EDGE = String.fromCharCode(32, 9, 10, 13, 42, 95, 35, 62, 45, 34, 39, 96, 91, 93, 40, 41, 46, 44, 59, 8220, 8221, 8216, 8217, 8226, 171, 187);

// The candidate and application ids ride in every stop message: the message is what the
// failure-alert email quotes, and it is how the owner finds the stuck outbox row to re-send.
var REF = '';
function stop(why) {
  throw new Error('Stage 1 claim guard stopped the run - ' + String(why).split(': ').join(' - ') + REF + ' - no verdict was sent');
}
var ID_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
function safeId(v) {
  var s = String(v == null ? '' : v), out = '';
  for (var n = 0; n < s.length && out.length < 64; n++) if (ID_CHARS.indexOf(s.charAt(n)) >= 0) out += s.charAt(n);
  return out || 'unknown';
}
var DIGITS = '0123456789' + String.fromCharCode(1632, 1633, 1634, 1635, 1636, 1637, 1638, 1639, 1640, 1641);
function hasDigit(s) {
  for (var n = 0; n < s.length; n++) if (DIGITS.indexOf(s.charAt(n)) >= 0) return true;
  return false;
}
function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(v) { return txt(v).toLowerCase(); }
function has(s, w) { return String(s).indexOf(w) >= 0; }
function trimEdge(s) {
  var a = 0, b = s.length;
  while (a < b && EDGE.indexOf(s.charAt(a)) >= 0) a++;
  while (b > a && EDGE.indexOf(s.charAt(b - 1)) >= 0) b--;
  return s.slice(a, b);
}
function squash(v) {
  var s = norm(v);
  [10, 13, 9].forEach(function (c) { s = s.split(String.fromCharCode(c)).join(' '); });
  return s.split(' ').filter(function (x) { return x; }).join(' ');
}
function toArray(v) { if (Array.isArray(v)) return v.filter(function (x) { return txt(x); }); var s = txt(v); return s ? [s] : []; }
/** A leading "label:" is taken only when the colon comes early (maxLabel chars); a colon
    deep inside a sentence is not a label. Quotes use a longer window because the vacancy
    line's own label is long. */
function splitLabel(v, maxLabel) {
  var t = trimEdge(squash(v));
  var c = t.indexOf(':');
  return (c >= 0 && c <= (maxLabel || 60)) ? { label: trimEdge(t.slice(0, c)), rest: trimEdge(t.slice(c + 1)) } : { label: '', rest: t };
}
function isRecordWord(s) {
  return s.indexOf('cv') === 0 || has(s, ' cv') || has(s, 'resume') || has(s, 'curriculum') || has(s, 'certificate text') ||
    has(s, 'certificate:') || s.indexOf('certificate') === 0 || has(s, 'uploaded certificate') || has(s, 'سيرة');
}
function labelKind(l) {
  var rec = isRecordWord(l);
  var cov = has(l, 'cover') || has(l, 'motivation letter') || has(l, 'رسالة') || has(l, 'خطاب');
  var app = has(l, 'application') || has(l, 'self-report') || has(l, 'self report') || has(l, 'typed') || has(l, 'form field') || has(l, 'حقل') || has(l, 'استمارة');
  if (rec && (cov || app)) return 'mixed';
  return rec ? 'record' : cov ? 'cover_letter' : app ? 'application' : 'unknown';
}
function enumKind(c) {
  var s = norm(c.source).split(' ').join('_').split('-').join('_');
  if (s === 'cv' || s === 'resume' || s === 'certificate' || s === 'certificates' || s === 'record') return 'record';
  if (s === 'cover_letter' || s === 'coverletter' || s === 'application' || s === 'application_field' || s === 'self_reported' || s === 'none') return 'claim';
  return '';
}
/** '' means convert; anything else is the reason to keep the assessor's status. */
function keepReason(c) {
  var e = enumKind(c);
  var p = splitLabel(c.evidence);
  var k = labelKind(p.label || p.rest.slice(0, 40));
  if (e === 'record') return 'record';
  if (e === 'claim') return (k === 'record' || k === 'mixed') ? 'conflict' : '';
  if (k === 'application' || k === 'cover_letter') return (isRecordWord(p.rest) || has(p.rest, 'cv')) ? 'mixed_unresolved' : '';
  return k === 'unknown' ? 'unlabelled' : 'record';
}
function idOf(c) { return txt(c && (c.criterionId != null ? c.criterionId : c.id)); }
function keyOf(r) { return norm(r && r.key) || norm(txt(r && r.id).split('__')[1] || ''); }
function policyOf(k) {
  if (!k || SKIP_META[k]) return 'skip';
  if (DECLARATION[k] || EXEMPT[k]) return 'keep';
  return VERIFIABLE[k] ? 'enforce' : CUSTOM_POLICY;
}
/** Mirrors Scoring's getAssessment without a regex: object, then top-level, then JSON in text. */
function parse(j) {
  if (j.output && typeof j.output === 'object') return { a: j.output, from: 'output' };
  if (j.criteria || j.integrity_concerns) return { a: j, from: 'top' };
  var raw = String(j.text || j.response || j.data || '');
  var s = raw.indexOf('{'), e = raw.lastIndexOf('}');
  if (s < 0 || e < s) return null;
  try { return { a: JSON.parse(raw.slice(s, e + 1)), from: 'text' }; } catch (err) { return null; }
}
function typedSkills(b) {
  var v = b.skills;
  if (typeof v === 'string') { try { var p = JSON.parse(v); if (Array.isArray(p)) v = p; } catch (e) {} }
  return squash(Array.isArray(v) ? v.join(', ') : v);
}
function isPositionLabel(l) {
  return l === 'position' || l.indexOf('position applied') === 0 || l.indexOf('job applied for') === 0 || l === 'applied for';
}
function dropReason(ic, applied, skills) {
  var q = squash(ic && ic.quote), c = squash(ic && ic.concern);
  if (!q || !c) return '';
  for (var n = 0; n < INJECTION.length; n++) if (has(q, INJECTION[n]) || has(c, INJECTION[n])) return '';
  var p = splitLabel(q, 120), body = trimEdge(p.rest);
  // S24. The quote is the vacancy itself: the whole quote, or a position / application-field
  // label followed by the exact applied-for title (execution 1940 quoted it as
  // "Application field (self-reported): 'Senior ... Specialist' - this title is not in the CV").
  var vacancyLabel = isPositionLabel(p.label) || labelKind(p.label) === 'application';
  if (applied && trimEdge(q) === applied) return 'position_is_the_job_applied_for';
  if (applied && vacancyLabel && body.indexOf(applied) === 0) {
    // Past the title the quote may only COMMENT on the title. A figure, or a concern about
    // years, means it also carries a real claim ("HR Assistant, 8 years") - keep that one.
    var tail = trimEdge(body.slice(applied.length));
    var yearsTalk = has(c, 'year') || has(c, 'experience') || has(c, 'سن') || has(c, 'خبر');
    if (!tail || (!hasDigit(tail) && !yearsTalk)) return 'position_is_the_job_applied_for';
  }
  var contradicted = has(c, 'contradict') || has(c, 'تناقض') || has(c, 'تعارض');
  if (p.label === 'skills' && body && skills && has(skills, body) && !contradicted && !has(q + ' ' + c, 'year') && !has(q + ' ' + c, 'سن')) return 'typed_skill_unverified_not_integrity';
  return '';
}
function passThrough(item, i, audit) {
  var j = Object.assign({}, item.json || {});
  j.claim_guard = audit;
  var o = { json: j, pairedItem: { item: i } };
  if (item.binary) o.binary = item.binary;
  return o;
}
function guardItem(item, i, body, rubric) {
  var j = item.json || {};
  var parsed = parse(j);
  if (!parsed || !parsed.a || typeof parsed.a !== 'object' || Array.isArray(parsed.a)) stop('the evaluator output could not be parsed');
  // With an EMPTY rubric the evaluator's criteria decide nothing, so their absence is not a failure.
  // Routing meta keys are not criteria (Scoring ignores them too): a list of only those is empty.
  var scored = rubric.filter(function (r) { return policyOf(keyOf(r)) !== 'skip'; }).length;
  if (scored > 0 && !Array.isArray(parsed.a.criteria)) stop('the evaluator output has no criteria list');
  if (scored > 0 && parsed.a.criteria.length === 0) stop('the evaluator returned no criteria for a non-empty rubric');
  var a = JSON.parse(JSON.stringify(parsed.a));
  var byId = {};
  rubric.forEach(function (r) { var id = txt(r && r.id); if (id) byId[id] = r; });
  var crit = Array.isArray(a.criteria) ? a.criteria : [];
  var converted = [], kept = [];
  crit.forEach(function (c) {
    if (!c || typeof c !== 'object') return;
    var id = idOf(c);
    var r = byId[id];
    if (!r) return;
    var key = keyOf(r), st = norm(c.status), pol = policyOf(key);
    if ((st !== 'met' && st !== 'partial') || pol === 'skip' || pol === 'keep') return;
    var why = keepReason(c);
    if (!why && key === 'experienceyears' && Number(c.months) > 0) why = 'months_reported';
    if (why) { if (why !== 'record') kept.push({ id: id, key: key, status: st, reason: why }); return; }
    var rec = { id: id, key: key, from: st, label: DISPLAY[key] || txt(r.label) || key, evidence: txt(c.evidence).slice(0, 300), shadow: pol === 'shadow' || MODE === 'shadow' };
    converted.push(rec);
    if (!rec.shadow) c.status = 'not_assessed'; // months deliberately untouched
  });
  var applied = trimEdge(squash(body.position_applied_for));
  var skills = typedSkills(body);
  var keepIc = [], dropped = [];
  (Array.isArray(a.integrity_concerns) ? a.integrity_concerns : []).forEach(function (ic) {
    var d = dropReason(ic, applied, skills);
    if (d) dropped.push({ reason: d, shadow: MODE === 'shadow', concern: txt(ic && ic.concern), quote: txt(ic && ic.quote) });
    if (!d || MODE === 'shadow') keepIc.push(ic);
  });
  if (Array.isArray(a.integrity_concerns)) a.integrity_concerns = keepIc;
  var labels = [];
  converted.forEach(function (x) { if (!x.shadow && labels.indexOf(x.label) < 0) labels.push(x.label); });
  dropped.forEach(function (d) { if (!d.shadow && d.reason === 'typed_skill_unverified_not_integrity' && labels.indexOf('skills') < 0) labels.push('skills'); });
  if (labels.length) {
    var w = toArray(a.weaknesses);
    if (!w.some(function (x) { return txt(x).indexOf(NOTE_HEAD) === 0 && has(x, NOTE_TAIL); })) w.push(NOTE_HEAD + labels.join(', ') + NOTE_TAIL);
    a.weaknesses = w;
  }
  var audit = { version: GUARD_VERSION, mode: MODE, parsedFrom: parsed.from, converted: converted, kept: kept, droppedConcerns: dropped };
  var changed = converted.some(function (x) { return !x.shadow; }) || dropped.some(function (d) { return !d.shadow; });
  if (!changed) return passThrough(item, i, audit);
  return { json: { output: a, text: j.text, claim_guard: audit }, pairedItem: { item: i } };
}

var out = [];
var items = $input.all();
var body = null;
var rubric = null;
try { body = $('Webhook').first().json.body; } catch (e) { stop('the campaign criteria could not be read'); }
if (!body || typeof body !== 'object') stop('the campaign criteria could not be read');
REF = ' - candidate ' + safeId(body.id) + ' campaign ' + safeId(body.campaignId) + ' application ' + safeId(body.applicationId);
var rr = body.evaluationRubric;
if (rr === undefined || rr === null) stop('the campaign criteria are missing from the request');
if (typeof rr === 'string') { try { rr = JSON.parse(rr); } catch (e) { stop('the campaign criteria could not be parsed'); } }
if (!Array.isArray(rr)) stop('the campaign criteria are not a list');
rubric = rr; // an EMPTY list is legitimate: a campaign without criteria goes on to Scoring as today
for (var i = 0; i < items.length; i++) {
  try {
    out.push(guardItem(items[i], i, body, rubric));
  } catch (err) {
    var msg = String((err && err.message) || err);
    if (msg.indexOf('Stage 1 claim guard stopped the run') === 0) throw err;
    stop('internal error (' + msg + ')');
  }
}
return out;
