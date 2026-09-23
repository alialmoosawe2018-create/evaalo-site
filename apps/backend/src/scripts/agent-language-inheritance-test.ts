/**
 * The interview agent is told what language to speak — it never guesses, and the
 * CAMPAIGN is the only thing that decides.
 *
 * 🔴 DEFECT ONE (production, 2026-09-18, Sales Manager / Baghdad). An Arabic
 * interview opened with:
 *
 *     ai agent: Hello علي محمود let's begin.
 *               Walk me through your sales process from prospecting to close.
 *     user:     Can we speak in Arabic? Please?
 *
 * `/start` read the language from the REQUEST BODY alone; a freshly created
 * campaign's link carries no `lang`, so `metadata.language` was omitted and the
 * agent fell back to its own `INITIAL_GREETING_LANGUAGE` secret.
 *
 * 🔴 DEFECT TWO (2026-09-23). The fix added a chain — link → blueprint →
 * criteria — and the LINK still won, because every link builder stamped the
 * recruiter's browser locale (`en` by default) into `?language=`. Two Arabic
 * campaigns were interviewed in English. Worse, the criteria fallback was never
 * reachable on the normal path: the campaign was loaded ONLY inside the
 * `public_screening` branch, so the link was the sole non-empty input.
 *
 * ✅ THE RULE NOW (owner, 2026-09-23): the language is chosen when the job is
 * created and lives on the campaign. Not the link, not the recruiter's browser,
 * not the candidate's. The language changes the SHAPE of the interview, so two
 * candidates in one campaign must not be interviewed in two languages and then
 * ranked against each other.
 *
 * ⚠️ REPORT language is a different question and is deliberately untouched:
 * `/end` still sends n8n `session.language || blueprintSnapshot.language ||
 * 'auto'`. An Arabic interview with an English report is a legitimate request.
 *
 * ⚠️ Why this file mixes two kinds of check: L1–L3 CALL the real resolver, so
 * they test behaviour. L4–L8 read the route source, because the handler cannot
 * be invoked without Express and Mongo. The source checks are written to catch
 * the specific way this defect returns — a correct resolver that is not what
 * reaches the agent. Comments are stripped before matching, so commenting a
 * guard out does not satisfy a check.
 *
 * Run: npm run test:agent-language-inheritance
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCampaignInterviewLanguage } from '../services/interviewLanguage.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTE = join(HERE, '..', 'routes', 'videoInterview.ts');
const ENSURE = join(HERE, '..', 'services', 'expertise', 'ensureBlueprint.ts');

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
function stripComments(source: string): string {
    const NL = String.fromCharCode(10);
    let out = '';
    let inBlock = false;
    for (const line of source.split(NL)) {
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

const src = stripComments(readFileSync(ROUTE, 'utf8'));
const ensureSrc = stripComments(readFileSync(ENSURE, 'utf8'));

// ── Behaviour: the rule itself, executed ─────────────────────────────────────

check('L1 the campaign field decides, and it is reported as the source', () => {
    const en = resolveCampaignInterviewLanguage({ interviewLanguage: 'en' });
    if (en.language !== 'en' || en.source !== 'campaign') {
        throw new Error(`expected en/campaign, got ${en.language}/${en.source}`);
    }
    const ar = resolveCampaignInterviewLanguage({ interviewLanguage: 'ar' });
    if (ar.language !== 'ar' || ar.source !== 'campaign') {
        throw new Error(`expected ar/campaign, got ${ar.language}/${ar.source}`);
    }
});

check('L2 🔴 the campaign OVERRIDES the legacy report language, never the reverse', () => {
    // The whole point: an English campaign whose report is Arabic is a valid
    // combination, and the interview must follow the campaign.
    const r = resolveCampaignInterviewLanguage({
        interviewLanguage: 'en',
        criteria: { evaluationLanguage: 'ar' },
    });
    if (r.language !== 'en') {
        throw new Error(`the report language won over the campaign field (${r.language})`);
    }
});

check('L3 a campaign from before the field keeps the language it has behaved with', () => {
    const legacy = resolveCampaignInterviewLanguage({ criteria: { evaluationLanguage: 'en' } });
    if (legacy.language !== 'en' || legacy.source !== 'legacy_evaluation_language') {
        throw new Error(`expected en/legacy_evaluation_language, got ${legacy.language}/${legacy.source}`);
    }
    // And with nothing at all, Arabic — the same default the agent falls to.
    const bare = resolveCampaignInterviewLanguage(null);
    if (bare.language !== 'ar' || bare.source !== 'default') {
        throw new Error(`expected ar/default, got ${bare.language}/${bare.source}`);
    }
});

// ── Wiring: what actually reaches the agent ──────────────────────────────────

const SITES = [
    { name: '/start', variable: 'startAgentLanguage', campaignId: 'normalizedCampaignId' },
    { name: '/prepare', variable: 'prepareAgentLanguage', campaignId: 'prepareCampaignId' },
];

for (const site of SITES) {
    check(`L4 ${site.name} resolves the language from the CAMPAIGN`, () => {
        const decl = `const { language: ${site.variable}, source:`;
        if (!src.includes(decl)) {
            throw new Error(
                `${site.variable} is no longer built by destructuring the shared resolver. ` +
                    `If it is back to reading the request body, the link decides again.`
            );
        }
        const at = src.indexOf(decl);
        const stmt = src.slice(at, src.indexOf(';', at));
        if (!stmt.includes('loadCampaignInterviewLanguage(')) {
            throw new Error(`${site.name} does not call loadCampaignInterviewLanguage`);
        }
        if (!stmt.includes(site.campaignId)) {
            throw new Error(
                `${site.name} resolves the language for some other campaign than ${site.campaignId}`
            );
        }
    });

    check(`L5 ${site.name} sends the language UNCONDITIONALLY`, () => {
        /*
         * This is the check that matters most. `worker.py`'s session_language()
         * falls back to INITIAL_GREETING_LANGUAGE only when the key is ABSENT,
         * and a conditional spread is exactly how it went missing. A resolver
         * can be correct, tested, and still never reach the agent.
         */
        if (!src.includes(`language: ${site.variable},`)) {
            throw new Error(`the agent metadata no longer carries ${site.variable}`);
        }
        if (src.includes(`...(${site.variable} ? { language: ${site.variable} } : {})`)) {
            throw new Error(
                `${site.name} sends the language conditionally again. When the key is omitted ` +
                    `the agent greets in its env default — which on production is not Arabic.`
            );
        }
    });
}

check('L6 🔴 the share link is not an input to the agent language any more', () => {
    /*
     * `sessionLanguage` and `prepareLanguage` still exist — they are the REPORT
     * language and the /prepare request echo. What must never return is either
     * one feeding the agent's language.
     */
    if (/resolveAgentLanguage|normalizeAgentLanguage/.test(src)) {
        throw new Error(
            'the old link-first resolver is back in videoInterview.ts. The campaign is the ' +
                'only authority; a per-route resolver is how the two stages drifted apart.'
        );
    }
    /*
     * Scoped to the two LiveKit metadata literals on purpose. `language:
     * prepareLanguage` also appears as a `req.body` DESTRUCTURING rename, and
     * `...(sessionLanguage ? ...)` is the session row that feeds the REPORT —
     * both legitimate. Only what is handed to the agent is forbidden.
     */
    for (const site of SITES) {
        const at = src.indexOf(`language: ${site.variable},`);
        if (at < 0) continue;
        const literalStart = src.lastIndexOf('const metadata', at);
        if (literalStart < 0) continue;
        const block = src.slice(literalStart, at);
        for (const linkVar of ['sessionLanguage', 'prepareLanguage']) {
            if (new RegExp(`language:\\s*${linkVar}\\b`).test(block)) {
                throw new Error(
                    `${linkVar} (the link) is being sent to the agent as its language again, ` +
                        `in the ${site.name} metadata`
                );
            }
        }
    }
});

check('L7 the blueprint is generated in the interview language', () => {
    /*
     * Not cosmetic. `detectLanguage` in blueprintGenerator.ts is literally
     * `? 'ar' : 'ar'`, so without an explicit language EVERY blueprint is
     * Arabic. An English campaign would then have an English-speaking agent
     * holding Arabic competency objectives, anchors and evidence.
     */
    if (!ensureSrc.includes('resolveCampaignInterviewLanguage(')) {
        throw new Error('ensureBlueprint no longer resolves the campaign language');
    }
    /*
     * Scoped to the CALL, not the file. `const { language: interviewLanguage }`
     * is the destructuring of the resolver's own result and matches any naive
     * search — so a version that resolves the language and then forgets to pass
     * it would still look correct.
     */
    const callAt = ensureSrc.indexOf('await generateExpertiseAndBlueprint(');
    if (callAt < 0) throw new Error('could not find the generation call in ensureBlueprint');
    const call = ensureSrc.slice(callAt, ensureSrc.indexOf('\n    );', callAt));
    if (!/language:\s*interviewLanguage/.test(call)) {
        throw new Error(
            'the resolved language is not passed into generateExpertiseAndBlueprint, so the ' +
                'blueprint falls back to detectLanguage — which returns Arabic for every input'
        );
    }
});

check('L8 /end keeps its own report-language chain — the two must not drift', () => {
    /*
     * The scorer's chain is what proved the interviewer was the odd one out, and
     * it is deliberately NOT the campaign rule: the report may be in a different
     * language than the interview. If it is ever removed, the transcript is
     * scored in the wrong language and this family of defects returns from the
     * other end.
     */
    if (!/session as any\)\?\.blueprintSnapshot\?\.language/.test(src)) {
        throw new Error(
            '/end no longer falls back to the blueprint language when sending the transcript ' +
                'to n8n — the scorer is now guessing too'
        );
    }
    if (!/session as any\)\?\.language/.test(src)) {
        throw new Error('/end no longer prefers the session (link) language for the REPORT');
    }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
