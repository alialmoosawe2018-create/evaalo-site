/**
 * The interview agent is told what language to speak — it never guesses.
 *
 * 🔴 THE DEFECT THIS GUARDS (production, 2026-09-18, Sales Manager / Baghdad).
 * An Arabic interview opened with:
 *
 *     ai agent: Hello علي محمود let's begin.
 *               Walk me through your sales process from prospecting to close.
 *     user:     Can we speak in Arabic? Please?
 *
 * Nothing was misconfigured in the campaign. The blueprint's language was "ar",
 * its ten competencies, anchor questions and rubrics were Arabic, and the
 * criteria carried evaluationLanguage "ar". The agent was simply never told:
 * `/start` read the language from the REQUEST BODY alone, the share link for a
 * freshly created campaign carries no `lang`, so `metadata.language` was omitted
 * and the agent fell back to its own `INITIAL_GREETING_LANGUAGE` secret.
 *
 * ⚠️ The cruel part: that fallback chain already existed — for the SCORER.
 * `/end` sends n8n `session.language || blueprintSnapshot.language || 'auto'`,
 * which is why the transcript was scored as Arabic while the interviewer spoke
 * English. Same file, same session, two different rules. These checks exist so
 * the two cannot drift apart again.
 *
 * ⚠️ Comments are stripped before matching, so commenting a guard out does not
 * satisfy a check.
 *
 * Read-only. Exits non-zero when the wiring is broken.
 *
 * Run: npm run test:agent-language-inheritance
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTE = join(HERE, '..', 'routes', 'videoInterview.ts');

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

const src = stripComments(readFileSync(ROUTE, 'utf8'));

function bodyOf(opener: string, closer: string): string {
    const start = src.indexOf(opener);
    if (start < 0) throw new Error(`could not find "${opener}" — has it been renamed?`);
    const end = src.indexOf(closer, start);
    if (end < 0) throw new Error(`could not find the end of "${opener}"`);
    return src.slice(start, end + closer.length);
}

check('L1 the agent language has one resolver, and it consults the blueprint', () => {
    const body = bodyOf('function resolveAgentLanguage', '\n}');
    /*
     * ⚠️ The USE, not the parameter name. A first version searched for the bare
     * identifier and stayed green when the blueprint line was deleted outright —
     * the signature still declared it. Found by mutation M3, not by reading.
     */
    if (!/normalizeAgentLanguage\(blueprintLanguage\)/.test(body)) {
        throw new Error(
            'resolveAgentLanguage no longer looks at the blueprint language. That is the ' +
                'whole point: the campaign knows the interview is Arabic even when the link ' +
                'is silent.'
        );
    }
    if (!/normalizeAgentLanguage\(criteriaLanguage\)/.test(body)) {
        throw new Error('the campaign criteria (evaluationLanguage) are no longer the last resort');
    }
});

check('L2 🔴 the link wins, then the blueprint, then the criteria — in that order', () => {
    const body = bodyOf('function resolveAgentLanguage', '\n}');
    const order = ['linkLanguage', 'blueprintLanguage', 'criteriaLanguage'].map((n) =>
        body.indexOf(`normalizeAgentLanguage(${n})`)
    );
    if (order.some((i) => i < 0)) {
        throw new Error('one of the three sources is no longer normalized through the same funnel');
    }
    if (!(order[0] < order[1] && order[1] < order[2])) {
        throw new Error(
            'the precedence changed. A recruiter who explicitly chooses English must still get ' +
                'English — the blueprint is a fallback for silence, never an override.'
        );
    }
    /*
     * ⚠️ `||` specifically. A first version of this check only asserted the
     * ORDER of the three names, which `Math.min`, an array `.find`, or a
     * reversed ternary would all satisfy while changing the semantics.
     */
    const chain = body.match(/normalizeAgentLanguage\(linkLanguage\)\s*\|\|/);
    if (!chain) throw new Error('the sources are no longer short-circuited with || — read this again');
});

for (const site of [
    { name: 'L3 /start', variable: 'startAgentLanguage', link: 'sessionLanguage' },
    { name: 'L4 /prepare', variable: 'prepareAgentLanguage', link: 'prepareLanguage' },
]) {
    check(`${site.name} dispatches the agent with the RESOLVED language`, () => {
        const decl = src.indexOf(`const ${site.variable} = resolveAgentLanguage(`);
        if (decl < 0) {
            throw new Error(
                `${site.variable} is not built by resolveAgentLanguage. This dispatch site is ` +
                    `back to whatever the request happened to carry.`
            );
        }
        if (!src.includes(`{ language: ${site.variable} }`)) {
            throw new Error(`the agent metadata no longer carries ${site.variable}`);
        }
        /*
         * ⚠️ And the OLD form must be gone. Keeping `normalizeAgentLanguage(link)`
         * at a dispatch site is exactly the defect — the resolver can exist,
         * be tested, and never be the thing that actually ships to the agent.
         */
        if (src.includes(`{ language: normalizeAgentLanguage(${site.link})! }`)) {
            throw new Error(
                `${site.name} still passes the link language straight through. A link without ` +
                    `lang then sends NOTHING and the agent greets in its env default — which on ` +
                    `production is not Arabic.`
            );
        }
    });
}

check('L5 the resolver runs after the blueprint is known, not before', () => {
    /*
     * Ordering, not presence. `sessionLanguage` is computed near the top of
     * /start from the request body; the blueprint is only resolved hundreds of
     * lines later. A resolver call hoisted above `buildBlueprintSnapshot` would
     * compile, read `undefined`, and silently restore the old behaviour.
     */
    const snapshot = src.indexOf('const blueprintSnapshot = buildBlueprintSnapshot(');
    const resolved = src.indexOf('const startAgentLanguage = resolveAgentLanguage(');
    if (snapshot < 0 || resolved < 0) throw new Error('could not locate both statements in /start');
    if (resolved < snapshot) {
        throw new Error(
            'startAgentLanguage is computed BEFORE the blueprint snapshot exists, so the ' +
                'blueprint fallback reads undefined and the fix is dead code'
        );
    }
});

check('L6 /end keeps its own blueprint fallback — the two must not drift', () => {
    /*
     * The scorer's chain is what proved the interviewer was the odd one out. If
     * it is ever removed, the transcript would be scored in the wrong language
     * and this whole family of defects returns from the other end.
     */
    if (!/session as any\)\?\.blueprintSnapshot\?\.language/.test(src)) {
        throw new Error(
            '/end no longer falls back to the blueprint language when sending the transcript ' +
                'to n8n — the scorer is now guessing too'
        );
    }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
