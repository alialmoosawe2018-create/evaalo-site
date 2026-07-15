const wh = $('Webhook').first().json.body || {};
const searchId = String(wh.searchId || '');
const sd = $getWorkflowStaticData('global');
sd.hhSendProgress = sd.hhSendProgress || {};
const prog = sd.hhSendProgress[searchId] || { expected: 0, sent: 0, phase: 1 };
prog.sent = (prog.sent || 0) + 1;
sd.hhSendProgress[searchId] = prog;

const pending = Boolean(sd.hhExpansionPending?.[searchId]);
const phase2Active = Boolean(sd.hhExpansionActive?.[searchId]);

if (pending && !phase2Active && prog.phase === 1 && prog.sent >= prog.expected) {
  delete sd.hhExpansionPending[searchId];
  sd.hhExpansionActive = sd.hhExpansionActive || {};
  sd.hhExpansionActive[searchId] = true;
  return [{ json: { __startPhase2: true, searchId } }];
}

if (prog.phase === 2 && prog.sent >= prog.expected) {
  const phase1Count = (sd.hhPhase1SentCount && sd.hhPhase1SentCount[searchId]) || prog.phase1Count || 0;
  const totalSent = phase1Count + prog.sent;
  return [
    {
      json: {
        __completeSearch: true,
        searchId,
        phase1Count,
        totalSent,
        minTarget: prog.minTarget || 40,
        targetMet: totalSent >= (prog.minTarget || 40),
        expansionRan: true,
      },
    },
  ];
}

if (!pending && !phase2Active && prog.phase === 1 && prog.sent >= prog.expected) {
  return [
    {
      json: {
        __completeSearch: true,
        searchId,
        phase1Count: prog.sent,
        totalSent: prog.sent,
        minTarget: $('Resolve Search Tier').first().json?.minCount || 20,
        targetMet: prog.sent >= ($('Resolve Search Tier').first().json?.minCount || 20),
        expansionRan: false,
      },
    },
  ];
}

return [];
