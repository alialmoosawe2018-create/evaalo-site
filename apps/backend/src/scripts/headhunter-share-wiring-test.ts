/**
 * The Head Hunter share path is bound to a real RecruitmentCampaign — wired,
 * not merely written.
 *
 * 🔴 THE DEFECT THIS GUARDS. `HeadHunterResultsWorkspace` declared an OPTIONAL
 * `campaignId` prop and forwarded it; neither page passed one. The prop became
 * `undefined` in silence, the link builder dropped the parameter in silence, and
 * the candidate discovered it after filling in the whole form:
 * `Validation error: Path 'organizationId' is required`.
 *
 * Nothing in that chain was a wrong value. It was an absent one, and absence is
 * exactly what unit tests do not see: every unit involved behaved correctly on
 * the inputs it was given. So this file reads the code that runs.
 *
 * ⚠️ The structural cure is that the prop no longer EXISTS at the page boundary
 * — the workspace owns the choice — and W4 keeps it that way. A check that only
 * asked "is a campaign passed?" would have been satisfied by passing the Head
 * Hunter search-history `entryId`, which is a different entity entirely.
 *
 * ⚠️ Comments are stripped before matching. Without that, commenting a guard out
 * satisfies every check — proven on this repo the day the technique was added.
 *
 * Read-only. Exits non-zero when the wiring is broken.
 *
 * Run: npm run test:headhunter-share-wiring
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_SRC = join(HERE, '..');
const FRONTEND_SRC = join(HERE, '..', '..', '..', 'frontend', 'src');

let pass = 0;
let fail = 0;

function check(name: string, fn: () => void): void {
    try {
        fn();
        console.log('  ✓', name);
        pass += 1;
    } catch (err) {
        console.error('  ✗', name, '\n     ', (err as Error).message);
        fail += 1;
    }
}

/** Comments blanked out; newlines and offsets preserved. */
function stripComments(src: string): string {
    const NL = String.fromCharCode(10);
    let out = '';
    let inBlock = false;
    for (const line of src.split(NL)) {
        let kept = '';
        let i = 0;
        while (i < line.length) {
            if (inBlock) {
                const close = line.indexOf('*/', i);
                if (close < 0) {
                    i = line.length;
                    break;
                }
                inBlock = false;
                i = close + 2;
                continue;
            }
            if (line.startsWith('//', i)) break;
            if (line.startsWith('/*', i)) {
                inBlock = true;
                i += 2;
                continue;
            }
            kept += line[i];
            i += 1;
        }
        out += kept + NL;
    }
    return out;
}

/** Live code only. JSDoc checks read the RAW file instead — see W8. */
function code(...parts: string[]): string {
    return stripComments(readFileSync(join(...parts), 'utf8'));
}
function raw(...parts: string[]): string {
    return readFileSync(join(...parts), 'utf8');
}

function bodyOf(source: string, opener: string, closer: string): string {
    const start = source.indexOf(opener);
    if (start < 0) throw new Error(`could not find "${opener}" — has it been renamed?`);
    const end = source.indexOf(closer, start);
    if (end < 0) throw new Error(`could not find the end of "${opener}"`);
    return source.slice(start, end + closer.length);
}

/* ────────────────────────── the link builder ───────────────────────────── */

check('W1 🔴 the link builder refuses a campaign-less link, before building anything', () => {
    const src = code(FRONTEND_SRC, 'utils', 'publicVideoScreeningUrl.js');
    const thrown = src.indexOf('throw');
    const firstSet = src.indexOf('params.set(');
    if (thrown < 0) throw new Error('the builder no longer throws — it is back to producing a broken link');
    if (firstSet < 0) throw new Error('the builder no longer sets any parameter — read this again');
    if (thrown > firstSet) {
        throw new Error(
            'the refusal comes AFTER the first params.set() — a partial link is already ' +
                'being assembled before the check'
        );
    }
    if (/if\s*\(\s*campaignId\s*\)/.test(src)) {
        throw new Error(
            'the builder is conditional on campaignId again — that exact line is the defect'
        );
    }
});

/* ─────────────────────── the share popover and card ────────────────────── */

check('W2 the popover binds EVERY link it builds to the chosen campaign', () => {
    const src = code(FRONTEND_SRC, 'components', 'headhunter', 'HeadHunterCardVideoInvite.jsx');
    for (const gone of ['campaignPosition']) {
        if (src.includes(gone)) {
            throw new Error(`${gone} is back — the Head Hunter search's role is not the campaign's role`);
        }
    }
    // Counted, not merely present: the popover builds a link in two places
    // (copy, and free share) and fixing one would leave the other broken.
    const builds = src.split('buildPublicVideoScreeningUrl(').length - 1;
    if (builds < 2) {
        throw new Error(`buildPublicVideoScreeningUrl is called ${builds} time(s); expected copy and share`);
    }
    if (!src.includes('shareCampaign?.campaignId')) {
        throw new Error('the popover no longer reads the campaign from shareCampaign');
    }
});

check('W3 the workspace owns the choice and remounts cards when it changes', () => {
    const src = code(FRONTEND_SRC, 'components', 'headhunter', 'HeadHunterResultsWorkspace.jsx');
    if (!src.includes('HeadHunterCampaignPicker')) {
        throw new Error('the workspace no longer offers a campaign picker');
    }
    if (!/key=\{`[^`]*shareCampaign/.test(src)) {
        throw new Error(
            'the card key no longer includes the campaign — changing campaign would keep ' +
                'the memoized sourcing context bound to the OLD one, and the server would ' +
                'reject the submission with no one able to see why'
        );
    }
    if (/\bcampaignPosition\b/.test(src)) {
        throw new Error('campaignPosition is back on the workspace');
    }
});

check('W4 🔴 no page may hand the workspace a campaign — the prop is gone on purpose', () => {
    // This is the check that would have caught the original bug, AND the one
    // that blocks "fixing" it by passing a search-history entryId instead.
    for (const page of ['AIHeadHunter.jsx', 'HeadHunterCampaignPage.jsx']) {
        const src = code(FRONTEND_SRC, 'pages', page);
        const at = src.indexOf('<HeadHunterResultsWorkspace');
        if (at < 0) throw new Error(`${page} no longer renders HeadHunterResultsWorkspace`);
        const el = src.slice(at, src.indexOf('/>', at) + 2);
        for (const forbidden of ['campaignId=', 'campaignPosition=']) {
            if (el.includes(forbidden)) {
                throw new Error(
                    `${page} passes ${forbidden} to the workspace. The campaign is chosen ` +
                        `inside it; a page-level prop is how this broke, and the only id a ` +
                        `page has is a Head Hunter search entryId, which is NOT a campaign.`
                );
            }
        }
    }
});

/* ──────────────────────────── the server side ──────────────────────────── */

check('W5 /sourcing-context verifies ownership and takes the role from the campaign', () => {
    const src = code(BACKEND_SRC, 'routes', 'headHunter.ts');
    const body = bodyOf(src, "'/sourcing-context'", '\n);');
    if (!body.includes('orgScopedQuery(')) {
        throw new Error('ownership is no longer re-verified — the client\'s campaignId is trusted');
    }
    if (!body.includes('CAMPAIGN_REQUIRED')) {
        throw new Error('a context can be minted without a campaign again — that is the whole defect');
    }
    if (!body.includes('campaignRoleFromCampaign(')) {
        throw new Error('the stored role no longer comes from the campaign');
    }
    if (body.includes('body.position')) {
        throw new Error(
            'the route reads body.position again — commit 8083f02 exists because that is ' +
                'how the candidate\'s CURRENT job title became the role they "declared"'
        );
    }
});

check('W6 the org cross-check runs BEFORE the person is looked up or written', () => {
    const src = code(BACKEND_SRC, 'routes', 'candidates.ts');
    /*
     * ⚠️ The CALL, with its paren — not the bare name.
     *
     * A first version searched for the identifier alone, which the IMPORT line
     * at the top of the file satisfies. Renaming the call site therefore left
     * this ordering check green while the cross-check no longer ran at all.
     * Found by mutation.
     */
    const guard = src.indexOf('assertSourcingContextMatchesCampaign({');
    if (guard < 0) {
        throw new Error(
            '/api/candidates no longer CALLS assertSourcingContextMatchesCampaign — ' +
                'importing it is not running it'
        );
    }
    const lookup = src.indexOf('const existingPersonQuery');
    if (lookup < 0) throw new Error('existingPersonQuery was renamed — this ordering check is blind now');
    if (guard > lookup) {
        throw new Error('the cross-check moved below the person lookup — it must decide before any write');
    }
    if (!src.includes('CAMPAIGN_REQUIRED')) {
        throw new Error(
            'the explicit no-campaign rejection is gone; submissions fall through to a ' +
                'Mongoose validation error again'
        );
    }
});

check('W7 🔴 the server-side link builder — the twin — refuses too', () => {
    const src = code(BACKEND_SRC, 'services', 'messaging', 'messagingService.ts');
    const fn = bodyOf(src, 'export function buildInterviewLink', '\n}');
    if (/if\s*\(\s*opts\.campaignId\s*\)\s*params\.set/.test(fn)) {
        throw new Error(
            'the video branch is conditional on campaignId again. This is the twin of the ' +
                'frontend builder: closing one and leaving the other open buys nothing — ' +
                'the same mistake cost a full cycle with the blueprint recovery in n8nService.'
        );
    }
    if (!fn.includes('throw')) {
        throw new Error('buildInterviewLink no longer refuses a campaign-less video link');
    }
    const contact = code(BACKEND_SRC, 'routes', 'headHunter.ts');
    if (!contact.includes("interviewType === 'video'") || !contact.includes('CAMPAIGN_REQUIRED')) {
        throw new Error('the automated-send route no longer requires a campaign for video');
    }
});

check('W11 🔴 the application records WHICH invitation produced it', () => {
    const src = code(BACKEND_SRC, 'routes', 'candidates.ts');
    if (/headHunterContextId:\s*candidate\.headHunterContextId/.test(src)) {
        throw new Error(
            'the application reads the context from the PERSON again. The person never ' +
                'carries one — measured: zero documents in the whole production database ' +
                'held the field — so every head-hunted application was untraceable.'
        );
    }
    if (!/headHunterContextId:\s*headHunterContextId\s*\|\|\s*undefined/.test(src)) {
        throw new Error(
            'the application is no longer given the context id from the REQUEST; the relation ' +
                'CandidateApplication → HeadHunterSourcingContext is broken'
        );
    }
    // ⚠️ An ASSIGNMENT, not a comparison: `=` not followed by `=`. The first
    // version matched the `===` in the route's own type check and reported a
    // write that was only a read.
    if (/candidateData\.headHunterContextId\s*=(?!=)/.test(src)) {
        throw new Error(
            'the context is being written onto the PERSON. A person can be sourced ' +
                'through several campaigns and several contexts; one field there lets the ' +
                'newest application erase where the previous one came from.'
        );
    }
});

check('W12 the verified-binding log carries IDs and nothing else', () => {
    const src = code(BACKEND_SRC, 'routes', 'candidates.ts');
    const at = src.indexOf('head-hunter share verified');
    if (at < 0) {
        throw new Error(
            'the success line is gone — whether the cross-check RAN becomes unanswerable ' +
                'from the logs, which is exactly the gap this closed'
        );
    }
    const line = src.slice(at, at + 400);
    for (const leak of ['email', 'full_name', 'phone', 'candidateData', 'linkedin']) {
        if (line.includes(leak)) {
            throw new Error(`the log line includes ${leak} — it proves a binding, it does not describe a person`);
        }
    }
    for (const id of ['context=', 'campaign=', 'org=']) {
        if (!line.includes(id)) throw new Error(`the log line no longer carries ${id}`);
    }
});

/* ────────────── the picker's escape hatch: create a campaign ───────────── */

check('W9 🔴 "create a job" goes where a job can actually be created', () => {
    const src = code(FRONTEND_SRC, 'components', 'headhunter', 'HeadHunterCampaignPicker.jsx');
    /*
     * ⚠️ The exact key, closing quote included. Without it this matched the
     * PREFIX of `aiHeadHunterCampaignPickerCreateFromSearch` — a different
     * element entirely — and reported that the create action had stopped
     * being a link when nothing about it had changed.
     */
    const at = src.indexOf("aiHeadHunterCampaignPickerCreate')");
    if (at < 0) throw new Error('the create-a-campaign action is gone from the picker');
    // The anchor element wrapping that label.
    const open = src.lastIndexOf('<a', at);
    if (open < 0) throw new Error('the create action is no longer a link — read this again');
    const el = src.slice(open, at);

    if (/href=["'][^"']*video-interview/.test(el) || /href=["'][^"']*video-evaluation/.test(el)) {
        throw new Error(
            'the create action points at /video-interview (or /video-evaluation). That ' +
                'route REDIRECTS to a list of past video evaluations and does not mount ' +
                'NewInterviewSidebar at all — a button that says "create" landing where ' +
                'nothing can be created.'
        );
    }
    /*
     * ⚠️ The PATH as well as the query.
     *
     * A first version accepted any href containing `open=newCampaign`, and
     * `/?open=newCampaign` satisfied it — which is what shipped into the picker
     * and what a live check on production caught: `/` is the marketing `Home`
     * page, so the button landed on "Get Started Free". The effect that opens
     * the sidebar lives in Dashboard.jsx, mounted at `/dashboard`.
     */
    /*
     * ⚠️ Matches a quoted literal OR a template literal: the href became
     * `{`/dashboard?open=newCampaign${…&position=…}`}` when the search role
     * started travelling with it, and a check pinned to the quoted form failed
     * on correct code. The requirement is the PATH, not the syntax.
     */
    if (!/href=(?:["']|\{`)\/dashboard\?open=newCampaign/.test(el)) {
        throw new Error(
            'the create action does not point at /dashboard?open=newCampaign. The deep ' +
                'link only works on the Dashboard route — `/` is the marketing home page, ' +
                'and a button that says "create a job" must not land there.'
        );
    }
    if (!/target=["']_blank["']/.test(el)) {
        throw new Error(
            'the create action navigates in the same tab. A full navigation loses the live ' +
                'Head Hunter results (only the saved search history survives) and the ' +
                'campaign the user had already chosen here.'
        );
    }
    if (!/rel=["'][^"']*noopener/.test(el)) {
        throw new Error('target="_blank" without rel="noopener"');
    }
});

check('W10 the picker can refetch — the server has no cache, but the client did', () => {
    const src = code(FRONTEND_SRC, 'components', 'headhunter', 'HeadHunterCampaignPicker.jsx');
    /*
     * The campaign is created in the OTHER tab, so the list this tab is showing
     * was fetched before it existed. Without a way to refetch, the user comes
     * back, does not see their new job, and reasonably concludes the list is
     * cached — when the endpoint deliberately is not.
     *
     * Counted: the fetch must be reachable from BOTH mount and a control, which
     * is only true once it is a named function rather than an inline effect.
     */
    const fetches = src.split("apiClient.get('/api/recruitment-campaigns/shareable')").length - 1;
    if (fetches < 1) throw new Error('the picker no longer loads campaigns');
    if (!/const load = useCallback/.test(src)) {
        throw new Error(
            'the fetch is inline in the effect again — it can only run on mount, so a ' +
                'campaign created while the picker is open can never appear'
        );
    }
    if (!/onClick=\{load\}/.test(src)) {
        throw new Error('nothing calls load() from a control — there is no way to refresh');
    }
    if (!src.includes('aiHeadHunterCampaignPickerRefresh')) {
        throw new Error('the refresh control has no label of its own');
    }
});

/* ───── the job decides the language; the search decides the job ───── */

check('W13 🔴 the link takes its language from the JOB, not the recruiter', () => {
    const src = code(FRONTEND_SRC, 'components', 'headhunter', 'HeadHunterCardVideoInvite.jsx');
    if (/language:\s*currentLang/.test(src)) {
        throw new Error(
            'the share link carries the UI language of whoever copies it again. Measured: that sent ' +
                'an ENGLISH interview against a blueprint whose anchors are Arabic, and all ' +
                '54 locked blueprints in production are ar — there is nothing to translate to.'
        );
    }
    if (!/shareCampaign\?\.language/.test(src)) {
        throw new Error('the link no longer reads the language from the chosen campaign');
    }
    const uses = src.split('language: shareLanguage').length - 1;
    if (uses < 3) {
        throw new Error(
            `only ${uses} of the 3 link/send sites use the job's language; copy, free share ` +
                `and the automated send must all agree`
        );
    }
    const api = code(BACKEND_SRC, 'routes', 'recruitmentCampaigns.ts');
    if (!/status:\s*'locked'/.test(api) || !api.includes('languageByCampaign')) {
        throw new Error('/shareable no longer reports the locked blueprint language');
    }
});

check('W14 🔴 the picker offers the jobs of THIS search first', () => {
    const src = code(FRONTEND_SRC, 'components', 'headhunter', 'HeadHunterCampaignPicker.jsx');
    if (!src.includes('searchRole')) {
        throw new Error(
            'the picker no longer knows the search role — nothing stops searching for ' +
                '"HR Generalist" and interviewing against "Sales Manager"'
        );
    }
    if (!/normalizeRole\(r\.title\)\s*===\s*wantedRole/.test(src)) {
        throw new Error('the role filter is gone; every job is offered regardless of the search');
    }
    // The escape hatch must survive too: text matching is fragile, and a strict
    // filter that hides the real campaign pushes the user to create a duplicate.
    if (!src.includes('showAll')) {
        throw new Error(
            'there is no way to see non-matching jobs. Role names are fuzzy, and hiding ' +
                'the real campaign is worse than the mistake being prevented.'
        );
    }
    const ws = code(FRONTEND_SRC, 'components', 'headhunter', 'HeadHunterResultsWorkspace.jsx');
    if (!/searchRole=\{searchContext\?\.position\}/.test(ws)) {
        throw new Error('the workspace no longer hands the search role to the picker');
    }
});

check('W15 🔴 "create a job" carries the search role into the creation screen', () => {
    /*
     * Without this the recruiter searches for "Account Manager", lands on an
     * empty criteria form, and retypes it — which is what made the journey feel
     * broken. Measured the day it was reported: 12 campaigns in the org, all HR,
     * and the newest search was "Account Manager" with no such job existing.
     */
    const picker = code(FRONTEND_SRC, 'components', 'headhunter', 'HeadHunterCampaignPicker.jsx');
    if (!/position=\$\{encodeURIComponent/.test(picker)) {
        throw new Error(
            'the create-a-job link no longer carries the search role (and unencoded is not ' +
                'acceptable either — roles contain spaces)'
        );
    }
    const dash = code(FRONTEND_SRC, 'pages', 'Dashboard.jsx');
    if (!dash.includes("searchParams.get('position')")) {
        throw new Error('the dashboard no longer reads the seeded position out of the URL');
    }
    if (!dash.includes('initialPosition=')) {
        throw new Error('the dashboard no longer hands the seeded position to the sidebar');
    }
    if (!dash.includes("next.delete('position')")) {
        throw new Error(
            'the position is left in the URL — the sidebar would reopen on every later ' +
                'navigation, the same reason `open` is stripped'
        );
    }
    const side = code(FRONTEND_SRC, 'components', 'NewInterviewSidebar.jsx');
    if (!/initialPosition/.test(side)) {
        throw new Error('the sidebar no longer accepts a seeded position');
    }
    if (!/setJobDetails\(seeded \? \{ position: seeded \} : \{\}\)/.test(side)) {
        throw new Error(
            'the open-reset no longer seeds the role; it clears the form as before and the ' +
                'recruiter retypes what they just searched for'
        );
    }
});

check('W16 a saved Head Hunter search is not called a job', () => {
    // The word is what caused the confusion: a search "campaign" is not a
    // RecruitmentCampaign, and the two are different entities entirely.
    const tr = raw(FRONTEND_SRC, 'translations.js');
    for (const wrong of [
        'aiHeadHunterCampaignSavedTitle: "Saved campaign"',
        'aiHeadHunterCampaignSavedTitle: "حملة محفوظة"',
    ]) {
        if (tr.includes(wrong)) {
            throw new Error(
                `${wrong} — a saved SEARCH is labelled a campaign again, which is what led ` +
                    `a recruiter to expect their search to be a job`
            );
        }
    }
});

check('W17 🔴 one button: reuse the job if it exists, create it if it does not', () => {
    const src = code(FRONTEND_SRC, 'components', 'headhunter', 'HeadHunterCampaignPicker.jsx');
    if (!/apiClient\.post\('\/api\/recruitment-campaigns'/.test(src)) {
        throw new Error('the picker can no longer create a job from the search');
    }
    /*
     * ⚠️ REUSE FIRST, and this is the load-bearing half.
     *
     * Creating unconditionally means one campaign per search: this org already
     * had two "HR Manager" and three "HR Generalist" jobs before creation became
     * a single click. Each duplicate costs a full blueprint generation, makes
     * its first candidate wait 60–130s, and splits the candidates for one role
     * across several campaigns so the comparison screens fragment.
     */
    const reuse = src.indexOf('const existing = (rows || []).find');
    const create = src.indexOf("apiClient.post('/api/recruitment-campaigns'");
    if (reuse < 0) throw new Error('the button no longer reuses an existing job for the same role');
    if (reuse > create) {
        throw new Error('the reuse check runs AFTER creating — a duplicate is made every time');
    }
    if (!/onPick\(existing\)/.test(src)) {
        throw new Error('the reused job is not selected, so the click does nothing visible');
    }
    if (!/interviewType: 'video'/.test(src) || !/templateType: 'video'/.test(src)) {
        throw new Error('the created job is not a video campaign');
    }
    // The search already knows these; dropping them throws away real criteria.
    for (const field of ['location', 'experienceYears']) {
        if (!src.includes(`payload.${field}`)) {
            throw new Error(`the created job drops ${field}, which the search already has`);
        }
    }
    if (!/onPick\(\{ campaignId: result\.campaignId/.test(src)) {
        throw new Error('the new job is not selected after creation — the point was one click');
    }
    if (!/language: ''/.test(src)) {
        throw new Error(
            'the freshly created job is given a language. Its blueprint has not locked yet, ' +
                'so the link must omit the parameter rather than invent one.'
        );
    }
    // The manual list is an escape hatch, not the flow: a role worded differently
    // from the job ("Account Manager" vs "Key Account Manager") will not match.
    if (!src.includes('setBrowsing')) {
        throw new Error(
            'there is no way to pick a job by hand any more. Role matching is exact, so a ' +
                'differently worded job can never be reached and a duplicate is forced.'
        );
    }
});

/* ───────────── the class-level check: never an optional prop ───────────── */

check('W8 🔴 the campaign binding is REQUIRED, never an optional prop', () => {
    /*
     * The textual signature of the original defect was
     *   @param {string} [props.campaignId]
     * — a prop that is optional in the docs and undefined at runtime, with no
     * complaint from anything. Reads the RAW file: JSDoc lives in comments.
     */
    for (const file of ['HeadHunterCandidateCard.jsx', 'HeadHunterCardVideoInvite.jsx']) {
        const src = raw(FRONTEND_SRC, 'components', 'headhunter', file);
        if (!src.includes('props.shareCampaign')) {
            throw new Error(`${file} no longer documents shareCampaign`);
        }
        if (/\[\s*props\.shareCampaign[^\]]*\]/.test(src)) {
            throw new Error(
                `${file} documents shareCampaign as OPTIONAL — that is the 2026-09-18 defect ` +
                    `verbatim: an optional prop nobody passes fails silently`
            );
        }
        /*
         * ⚠️ Scoped to the PARAMETER destructuring. A first version searched the
         * whole file and matched the JSX attribute `shareCampaign={shareCampaign}`
         * — a false positive that would have taught whoever hit it to distrust
         * this file, which is worse than not having the check.
         */
        const live = stripComments(src);
        /*
         * ⚠️ Anchored on the COMPONENT's own signature. A first version took the
         * first `({` in the file — which in HeadHunterCardVideoInvite.jsx is a
         * little `IconShareLink({ className })` helper near the top — so it read
         * the wrong block and a real default value passed green. Found by
         * mutation, not by reading.
         */
        const sig = live.search(/(?:export default )?function \w*(?:Card|Invite)\w*\s*\(/);
        if (sig < 0) throw new Error(`${file}: could not find the component's signature`);
        const open = live.indexOf('({', sig);
        const close = live.indexOf('})', open);
        if (open < 0 || close < 0) throw new Error(`${file}: could not read the props destructuring`);
        const destructuring = live.slice(open, close);
        if (/shareCampaign\s*=/.test(destructuring)) {
            throw new Error(
                `${file} gives shareCampaign a default value — a default is how an absent ` +
                    `binding passes for a present one`
            );
        }
    }
});

/* ──────────────── one button says "create", not two ────────────────────── */

check('W18 🔴 the default picker screen offers ONE create action, not two', () => {
    const src = code(FRONTEND_SRC, 'components', 'headhunter', 'HeadHunterCampaignPicker.jsx');

    /*
     * 🔴 THE DEFECT. Two controls said "create a job": the one-click button at
     * the top (whose label is a full sentence) and a footer link styled as a
     * filled primary button reading exactly «أنشئ وظيفة» — which navigates to
     * the full creation screen instead of creating anything.
     *
     * The user pressed the footer twice, reported "pressing create job still
     * sends me to the create-job page", and diagnosed it himself: "probably
     * because the name matches". Both halves were working as written; the screen
     * was the bug.
     *
     * So the footer link is only mounted where the one-click button is not the
     * path: inside the folded list, or when there is no search role at all.
     */
    const at = src.indexOf("aiHeadHunterCampaignPickerCreate')");
    if (at < 0) throw new Error('the create-a-campaign action is gone from the picker');

    /*
     * ⚠️ Read what sits immediately before the ANCHOR ELEMENT, not before the
     * label and not the whole file.
     *
     * The whole file is no good: the one-click button carries its own
     * conditional, so a file-wide search for `showAdvanced` stays green with the
     * footer link ungated — the exact defect. And a window measured back from
     * the LABEL is arbitrary: the first version used 400 characters, the real
     * distance is 419, and it failed on correct code. The element's own opening
     * tag is the only stable landmark.
     */
    const anchorOpen = src.lastIndexOf('<a', at);
    if (anchorOpen < 0) throw new Error('the create action is no longer a link — read this again');
    const before = src.slice(Math.max(0, anchorOpen - 60), anchorOpen);
    if (!/showAdvanced\s*\?/.test(before)) {
        throw new Error(
            'the "create a job" footer link is mounted unconditionally again. It then sits ' +
                'beside the one-click button under a name the user reads as THE create ' +
                'button — and it navigates away instead of creating.'
        );
    }

    /*
     * ⚠️ And not via the `hidden` attribute.
     *
     * Both footer controls carried `hidden={…}` with a correct condition, and it
     * did nothing: `.headhunter-campaign-picker__foot .btn` sets
     * `display: inline-flex`, and an author rule beats the browser's own
     * `[hidden] { display: none }`. "Refresh list" was on screen in every state
     * while the code said it was hidden.
     */
    const foot = bodyOf(src, 'headhunter-campaign-picker__foot', '</div>');
    if (/hidden\s*=/.test(foot)) {
        throw new Error(
            'a picker footer control is hidden with the `hidden` attribute. That attribute ' +
                'is overridden here by `display: inline-flex` in design-styles.css, so the ' +
                'control stays visible. Do not mount it instead.'
        );
    }
});

check('W19 the one-click button does not promise to create when it will reuse', () => {
    const src = code(FRONTEND_SRC, 'components', 'headhunter', 'HeadHunterCampaignPicker.jsx');

    /*
     * The button reuses a job whose role matches and creates one otherwise, but
     * its label read "No job for this yet — create it and use it now" in BOTH
     * cases. A control whose text does not describe what it is about to do sends
     * the user looking for another control that does — which is how the footer
     * link got pressed.
     */
    if (!src.includes('aiHeadHunterCampaignPickerUseExisting')) {
        throw new Error(
            'the button has one label again. It says "no job for this yet — create it" even ' +
                'when a matching job exists and the click will reuse it.'
        );
    }
    if (!/matchedExisting/.test(src)) {
        throw new Error('nothing computes whether a matching job exists — the label cannot be honest');
    }
    /*
     * ⚠️ The label must follow the SAME rule the click follows. A separate,
     * looser test (`rows.length > 0`, say) would drift from `createOrReuse` and
     * put the screen back to lying, just differently.
     */
    const decl = bodyOf(src, 'const matchedExisting', ');');
    if (!/normalizeRole\(r\.title\)\s*===\s*wantedRole/.test(decl)) {
        throw new Error(
            'the label no longer asks the same question the click asks (exact normalized ' +
                'role match). The two will drift and the button will mislabel itself again.'
        );
    }
});

check('W20 the two create labels cannot be read as the same button', () => {
    const src = raw(FRONTEND_SRC, 'translations.js');
    const pick = (key: string): string[] => {
        const hits = [...src.matchAll(new RegExp(`${key}: "([^"]*)"`, 'g'))].map((m) => m[1]);
        if (hits.length !== 3) {
            throw new Error(`${key} is defined ${hits.length} times, expected 3 (en, ar, ku)`);
        }
        return hits;
    };
    /*
     * They appear together inside the folded list, so distinct wording is the
     * whole point: one creates in place, the other opens the full form.
     */
    const footer = pick('aiHeadHunterCampaignPickerCreate');
    const primary = pick('aiHeadHunterCampaignPickerCreateFromSearch');
    const reuse = pick('aiHeadHunterCampaignPickerUseExisting');
    for (let i = 0; i < 3; i += 1) {
        for (const other of [primary[i], reuse[i]]) {
            if (footer[i] === other) {
                throw new Error(`the footer link and the one-click button read identically: "${footer[i]}"`);
            }
        }
        /*
         * ⚠️ The footer label must SAY it opens the long form. "Create a job"
         * was distinct from the button's sentence and still read as the create
         * button — distinctness alone was never the requirement.
         */
        if (!footer[i].includes('…')) {
            throw new Error(
                `the footer create label "${footer[i]}" no longer marks itself as opening ` +
                    `another screen (an ellipsis). It reads as the button that creates here.`
            );
        }
    }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
