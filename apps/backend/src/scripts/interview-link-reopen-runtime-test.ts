/**
 * Reopening a spent interview link — proven on every path by RUNNING it.
 *
 * The owner's rule (2026-09-23): the VOICE link is reopened from Stage 2, the
 * VIDEO link from Stage 3. Until then the voice button sat on Stage 1 and the
 * Stage 2 button reopened the video link — so a candidate from the PUBLIC voice
 * link (`entryStage: 'audio'`, never shown on Stage 1) had no reopen button
 * anywhere. Production's audit log agreed: 15 reopens in the product's history,
 * none of them on a public voice application.
 *
 * Each scenario walks the chain the way it really runs: a spent link is refused
 * by the REAL voice server (4001) → the row the board would draw
 * (`applicationToStageListRow`) passes the board's REAL split function → HR's
 * reopen (`reopenInterviewLink`, the body of the reset route) runs on that row's
 * id → the same socket is now greeted. The video half stops at
 * `isVideoLinkConsumedById`, the exact check `/prepare` and `/start` make —
 * a LiveKit room is not something a test can open.
 *
 * Run: npx tsx --experimental-test-module-mocks src/scripts/interview-link-reopen-runtime-test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChecker, out, setupVoiceRuntime } from './lib/voiceRuntimeHarness.js';

/* The harness installs the recorders BEFORE any application module loads —
   every application import below must stay after this line. */
const { resetRecorders, runSession, stop } = await setupVoiceRuntime();
const { Types } = await import('mongoose');
const Candidate = (await import('../models/Candidate.js')).default;
const CandidateApplication = (await import('../models/CandidateApplication.js')).default;
const RecruitmentCampaign = (await import('../models/RecruitmentCampaign.js')).default;
const { DEFAULT_ORG_ID } = await import('../config/multiTenant.js');
const { applicationToStageListRow } = await import('../services/candidateApplicationService.js');
const { reopenInterviewLink, isVideoLinkConsumedById, isVoiceLinkConsumedById, INTERVIEW_LINK_ALREADY_USED } =
    await import('../services/interviewLinkAccess.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONT = join(HERE, '..', '..', '..', 'frontend', 'src');
const frontUrl = (rel: string) => new URL(`file:///${join(FRONT, rel).replace(/\\/g, '/')}`).href;
// The boards' own split functions — the rule that decides who a page shows.
const { splitVoiceCandidates } = await import(frontUrl('utils/voiceCampaigns.js'));
const { splitVideoCandidates } = await import(frontUrl('utils/videoCampaigns.js'));
const { splitScreeningCandidates } = await import(frontUrl('utils/screeningCampaigns.js'));

const { check, summary } = createChecker();
const ORG = DEFAULT_ORG_ID;
const SPENT = new Date('2026-09-20T10:00:00Z');
const EVAL = { recommendation: 'Consider', overall_score: 60, summary: 'evaluated' };

await RecruitmentCampaign.collection.insertMany(
    [
        { campaignId: 'rl-voice', interviewType: 'audio', interviewLanguage: 'ar', criteria: { position: 'محاسب', evaluationLanguage: 'ar' } },
        { campaignId: 'rl-form', interviewType: 'form', interviewLanguage: 'ar', criteria: { position: 'محاسب', evaluationLanguage: 'ar' } },
        { campaignId: 'rl-video', interviewType: 'video', interviewLanguage: 'ar', criteria: { position: 'محاسب', evaluationLanguage: 'ar' } },
        { campaignId: 'rl-other', interviewType: 'audio', interviewLanguage: 'ar', criteria: { position: 'محاسب', evaluationLanguage: 'ar' } },
    ].map((c) => ({ ...c, organizationId: ORG, createdAt: new Date() }))
);

let seq = 0;
type Seeded = { person: Record<string, any>; app: Record<string, any>; row: Record<string, any> };
async function seedPerson(name: string) {
    seq += 1;
    const _id = new Types.ObjectId();
    await Candidate.collection.insertOne({
        _id,
        organizationId: ORG,
        full_name: name,
        email: `rl${seq}@example.com`,
        phone: '07800000000',
        position_applied_for: 'محاسب',
        createdAt: new Date(),
    });
    return _id;
}
async function seedApplication(
    personId: InstanceType<typeof Types.ObjectId>,
    a: {
        campaignId: string;
        entryStage: 'screening' | 'audio' | 'video';
        sourceType?: string;
        voiceSpent?: boolean;
        videoSpent?: boolean;
        voiceEval?: boolean;
        videoEval?: boolean;
    }
): Promise<Seeded> {
    seq += 1;
    const doc = {
        _id: new Types.ObjectId(),
        organizationId: ORG,
        candidateId: personId,
        applicationId: `RL-APP-${seq}`,
        campaignId: a.campaignId,
        emailDenorm: `rl${seq}@example.com`,
        position_applied_for: 'محاسب',
        entryStage: a.entryStage,
        ...(a.sourceType ? { sourceType: a.sourceType } : {}),
        voiceInterviewLinkConsumedAt: a.voiceSpent ? SPENT : null,
        voiceInterviewResumableUntil: null,
        videoInterviewLinkConsumedAt: a.videoSpent ? SPENT : null,
        ...(a.voiceEval ? { voiceInterviewEvaluation: EVAL } : {}),
        ...(a.videoEval ? { videoInterviewEvaluation: EVAL } : {}),
        createdAt: new Date(),
        updatedAt: new Date(),
    };
    await CandidateApplication.collection.insertOne(doc);
    const person = (await Candidate.collection.findOne({ _id: personId })) as Record<string, any>;
    const app = (await CandidateApplication.collection.findOne({ _id: doc._id })) as Record<string, any>;
    // Exactly the row GET /api/candidates hands the boards.
    const row = applicationToStageListRow(app, person);
    return { person, app, row };
}
const onBoard = (split: (c: unknown[]) => { evaluated: unknown[]; pending: unknown[] }, row: Record<string, any>) => {
    const { evaluated, pending } = split([row]);
    return evaluated.includes(row) || pending.includes(row);
};
/** What the reset button sends: the row's id, and its application and campaign. */
const reopenFromRow = (row: Record<string, any>, stage: 'voice' | 'video', organizationId = ORG) =>
    reopenInterviewLink({
        id: String(row._id),
        stage,
        applicationId: row.applicationId,
        campaignId: row.campaignId,
        organizationId,
    });
/** Open the voice socket and report whether the interview started. */
async function voiceSession(query: Record<string, string | undefined>) {
    resetRecorders();
    const r = await runSession(query, { turns: 0, answer: () => '', end: 'none' });
    if (!r.client.closed) {
        r.client.ws.close(1000, 'test done');
        await r.client.waitClosed();
    }
    return { greeted: typeof r.greeting === 'string', refusedAsUsed: r.errors[0]?.code === INTERVIEW_LINK_ALREADY_USED, code: r.client.closeCode };
}

/* ── 1. the PUBLIC voice link — the path that had no button anywhere ─────────── */
out('▶ public voice link (/screening-call) — spent, then reopened from Stage 2');
{
    const pid = await seedPerson('علي حسن');
    const s = await seedApplication(pid, {
        campaignId: 'rl-voice',
        entryStage: 'audio',
        sourceType: 'public_screening',
        voiceSpent: true,
        voiceEval: true,
    });
    // A returning candidate gets APPLICATION_EXISTS + their id, and the page
    // opens the socket exactly like this (useVoiceInterview defaults language=ar).
    const q = { candidateId: String(pid), language: 'ar', mode: 'public', position: 'محاسب', campaignId: 'rl-voice' };
    const before = await voiceSession(q);
    check('spent: the voice server refuses it as already used', before.refusedAsUsed, true);
    check('…and closes with 4001', before.code, 4001);
    check('Stage 1 never shows a public voice candidate — why the old button could not reach it',
        onBoard(splitScreeningCandidates, s.row), false);
    check('Stage 2 shows it', onBoard(splitVoiceCandidates, s.row), true);
    const r = await reopenFromRow(s.row, 'voice');
    check('reopen from the Stage 2 row succeeds', r.ok, true);
    const after = await voiceSession(q);
    check('the same public link now starts the interview', after.greeted, true);
    check('…and is not refused', after.refusedAsUsed, false);
}

/* ── 2. form → voice link, spent with no evaluation to show for it ──────────── */
out('\n▶ form → voice link — spent, the evaluation never arrived');
{
    const pid = await seedPerson('زينب كريم');
    const s = await seedApplication(pid, { campaignId: 'rl-form', entryStage: 'screening', voiceSpent: true });
    const q = { candidateId: String(pid), campaignId: 'rl-form', applicationId: s.row.applicationId, language: 'ar' };
    check('spent: refused', (await voiceSession(q)).refusedAsUsed, true);
    check('Stage 2 shows it although it has no voice evaluation', onBoard(splitVoiceCandidates, s.row), true);
    check('reopen from Stage 2 succeeds', (await reopenFromRow(s.row, 'voice')).ok, true);
    check('the /interview link now starts the interview', (await voiceSession(q)).greeted, true);
}

/* ── 3. the PUBLIC video link ─────────────────────────────────────────────────── */
out('\n▶ public video link (/video-screening-call) — spent, then reopened from Stage 3');
{
    const pid = await seedPerson('Omar Nabil');
    const s = await seedApplication(pid, { campaignId: 'rl-video', entryStage: 'video', sourceType: 'public_screening', videoSpent: true });
    // The public video page navigates with candidateId + campaignId only.
    const scope = { campaignId: 'rl-video' };
    check('spent: /prepare and /start would refuse it', await isVideoLinkConsumedById(String(pid), scope), true);
    check('Stage 3 shows it', onBoard(splitVideoCandidates, s.row), true);
    check('reopen from the Stage 3 row succeeds', (await reopenFromRow(s.row, 'video')).ok, true);
    check('/prepare and /start now let it through', await isVideoLinkConsumedById(String(pid), scope), false);
}

/* ── 4. a voice-path candidate whose video session was too short to score ───── */
out('\n▶ voice → video link — one sentence spent it, nothing to evaluate');
{
    const pid = await seedPerson('Sara Ahmed');
    const s = await seedApplication(pid, {
        campaignId: 'rl-voice',
        entryStage: 'audio',
        voiceEval: true,
        videoSpent: true,
    });
    check('Stage 3 shows it although it has no video evaluation', onBoard(splitVideoCandidates, s.row), true);
    const scope = { applicationId: s.row.applicationId, campaignId: 'rl-voice' };
    check('Stage 2\'s voice reopen does NOT open the video link',
        (await reopenFromRow(s.row, 'voice')).ok && (await isVideoLinkConsumedById(String(pid), scope)), true);
    check('reopen from Stage 3 opens it', (await reopenFromRow(s.row, 'video')).ok, true);
    check('the video link is open', await isVideoLinkConsumedById(String(pid), scope), false);
}

/* ── 5. scope: one campaign's reopen never opens another campaign's link ───── */
out('\n▶ the same person in two campaigns');
{
    const pid = await seedPerson('Maya Stone');
    const a = await seedApplication(pid, { campaignId: 'rl-voice', entryStage: 'audio', voiceSpent: true, voiceEval: true });
    await seedApplication(pid, { campaignId: 'rl-other', entryStage: 'audio', voiceSpent: true, voiceEval: true });
    check('reopen of campaign A succeeds', (await reopenFromRow(a.row, 'voice')).ok, true);
    check('campaign A is open', await isVoiceLinkConsumedById(String(pid), { campaignId: 'rl-voice' }), false);
    check('campaign B stays spent', await isVoiceLinkConsumedById(String(pid), { campaignId: 'rl-other' }), true);
}

/* ── 6. tenancy: another organization cannot reopen it ─────────────────────── */
out('\n▶ another organization');
{
    const pid = await seedPerson('Lana Aziz');
    const s = await seedApplication(pid, { campaignId: 'rl-voice', entryStage: 'audio', voiceSpent: true, voiceEval: true });
    const r = await reopenFromRow(s.row, 'voice', 'org_someone_else');
    check('refused as not found', r.ok === false && r.status === 404, true);
    check('the link stays spent', await isVoiceLinkConsumedById(String(pid), { campaignId: 'rl-voice' }), true);
}

/* ── 7. which page carries which button — read from the pages themselves ──── */
out('\n▶ the three boards');
{
    const code = (rel: string) =>
        readFileSync(join(FRONT, rel), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split(/\r?\n/)
            .filter((l) => !/^\s*\/\//.test(l))
            .join('\n');
    const resetBlock = (text: string) => {
        const at = text.indexOf('interviewLinkReset={{');
        return at < 0 ? '' : text.slice(at, text.indexOf('}}', at));
    };
    const stage1 = code('pages/WrittenInterview.jsx');
    const stage2 = code('pages/VoiceInterview.jsx');
    const stage3 = code('pages/VideoInterview.jsx');
    check('Stage 1 carries no reopen button', stage1.includes('interviewLinkReset='), false);
    check('Stage 2 reopens the VOICE link', /stage: 'voice'/.test(resetBlock(stage2)), true);
    check('…and shows the voice link\'s state', /consumedAt: candidate\.voiceInterviewLinkConsumedAt/.test(resetBlock(stage2)), true);
    check('Stage 3 reopens the VIDEO link', /stage: 'video'/.test(resetBlock(stage3)), true);
    check('…and shows the video link\'s state', /consumedAt: candidate\.videoInterviewLinkConsumedAt/.test(resetBlock(stage3)), true);
    check('Stage 3 refreshes when a link is spent or reopened', /'InterviewLinkAccessChanged'/.test(stage3), true);
    const button = code('components/screening/InterviewLinkResetButton.jsx');
    check('the button names which link it reopens',
        /stage === 'voice' \? 'interviewLinkReset_btnVoice' : 'interviewLinkReset_btnVideo'/.test(button), true);
    const route = code(join('..', '..', 'backend', 'src', 'routes', 'candidates.ts'));
    check('the reset route runs the same reopen this test runs', /await reopenInterviewLink\(\{/.test(route), true);
}

await stop();
const { passes, failures } = summary();
out(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
