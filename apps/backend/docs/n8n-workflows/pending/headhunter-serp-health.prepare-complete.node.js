const wh = $('Webhook').first().json.body || {};
const searchId = String(wh.searchId || '');
const input = $input.first().json || {};

// One searchId => exactly one completion callback, and it must be the CORRECT one.
//
// The done branch of `Split In Batches` fires several times per search (5x in exec 2024)
// because `Stream Batch Done` has two inbound branches and runs once per branch. Each
// extra firing reaches a finalize node that has already deleted sd.hhCandidates, so it
// returns __completeOnly and lands here with values recomputed from destroyed state.
// exec 2024 posted 7 callbacks, 6 of them wrong ("No candidates passed..." and
// totalSent: 4 for a search that had delivered 13).
//
// Do NOT decide this by arrival order - that only moves the race, it does not remove it.
// `Track Send Progress` already produces the authoritative terminal as __completeSearch,
// once prog.sent >= prog.expected for the final phase, carrying the right counts.
// So: if anything was ever sent, __completeSearch is the real completion and any
// __completeOnly is a repeat -> drop it before it can claim the search.
// If nothing was ever sent (a genuinely empty search, or the all-SERP-pages-failed
// path) there will be no __completeSearch, so __completeOnly must be allowed through.
const sd = $getWorkflowStaticData('global');
const prog = (sd.hhSendProgress && sd.hhSendProgress[searchId]) || null;
const anythingSent = Boolean(prog && (Number(prog.expected || 0) > 0 || Number(prog.sent || 0) > 0));
if (input.__completeOnly && anythingSent) return [];

// Second line: never post twice even for genuine terminals. The backend's own
// idempotency guard stays in place behind this, it is no longer the only defence.
if (searchId) {
  sd.hhCompleted = sd.hhCompleted || {};
  if (sd.hhCompleted[searchId]) return [];
  sd.hhCompleted[searchId] = true;
}

// Search-engine health, written by Merge Serp Results: counts only - never the query
// text - so the page can tell the recruiter, when the search falls short, how many
// search requests got no answer or came back without LinkedIn profiles. Read once, by
// the run that posts the completion.
let serpHealth = null;
if (searchId && sd.hhSerpHealth && sd.hhSerpHealth[searchId]) {
  const states = Object.values(sd.hhSerpHealth[searchId].calls || {});
  delete sd.hhSerpHealth[searchId];
  if (states.length) {
    serpHealth = {
      calls: states.length,
      failed: states.filter((s) => s === 'failed').length,
      ignoredFilter: states.filter((s) => s === 'ignored').length,
    };
  }
}

if (input.__completeOnly) {
  const body = { searchId, searchComplete: true };
  if (input.searchFailed) body.searchFailed = true;
  if (input.errorMessage) body.errorMessage = input.errorMessage;
  if (input.phase1Count != null) body.phase1Count = input.phase1Count;
  if (input.totalSent != null) body.totalSent = input.totalSent;
  if (input.minTarget != null) body.minTarget = input.minTarget;
  if (input.targetMet != null) body.targetMet = input.targetMet;
  if (input.expansionRan != null) body.expansionRan = input.expansionRan;
  if (input.expansionRan && !input.targetMet && input.totalSent != null && input.minTarget != null) {
    body.errorMessage =
      body.errorMessage ||
      `Expanded search completed: sent ${input.totalSent} qualified candidate(s); target was ${input.minTarget}.`;
  }
  if (serpHealth) body.serpHealth = serpHealth;
  return [{ json: body }];
}

if (input.__completeSearch) {
  const body = {
    searchId,
    searchComplete: true,
    phase1Count: input.phase1Count,
    totalSent: input.totalSent,
    minTarget: input.minTarget,
    targetMet: input.targetMet,
    expansionRan: input.expansionRan,
  };
  if (input.expansionRan && !input.targetMet) {
    body.errorMessage = `Expanded search completed: sent ${input.totalSent} qualified candidate(s); target was ${input.minTarget}.`;
  }
  if (serpHealth) body.serpHealth = serpHealth;
  return [{ json: body }];
}

return [{ json: serpHealth ? { searchId, searchComplete: true, serpHealth } : { searchId, searchComplete: true } }];
