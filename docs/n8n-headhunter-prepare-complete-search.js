const wh = $('Webhook').first().json.body || {};
const searchId = String(wh.searchId || '');
const input = $input.first().json || {};

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
  return [{ json: body }];
}

return [{ json: { searchId, searchComplete: true } }];
