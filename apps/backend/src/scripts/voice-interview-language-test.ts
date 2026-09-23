/**
 * Who decides the language the voice agent speaks.
 *
 * Measured 2026-09-23, sessions 6cfb7d62 and 2718fd5f: both interviews were
 * conducted ENTIRELY IN ENGLISH while both campaigns carried
 * `criteria.evaluationLanguage: 'ar'`, and one candidate answered in Arabic
 * throughout («نعم», «عربي عند انقلش», «فوق بروبلم») and was scored on his
 * English. The chain, verified end to end in code:
 *
 *   LanguageContext.jsx        readStoredLang() returns 'en' for any visitor
 *                              with no saved preference — including the recruiter
 *   NewInterviewSidebar.jsx    the share link took `currentLang`, i.e. THAT default
 *   PublicScreeningCall.jsx    the page turned it into the session language
 *   useVoiceInterview.js       and sent `language=en` on the socket, always
 *   voiceSessionCore.ts        `=== 'en' ? 'en' : 'ar'` — no campaign, no fallback
 *
 * The precedence rule itself was never wrong, and the video path states it in
 * writing: an explicit choice in the link outranks the campaign; the campaign is
 * the fallback for silence. What was wrong is that THE LINK WAS NEVER SILENT — a
 * browser locale was being promoted to an explicit choice. So the fix is not "the
 * campaign wins"; it is that silence became possible, and the server now asks the
 * campaign when it hears it.
 *
 * ⚠️ Honest limit, recorded so nobody reads more into this than it does: the
 * campaign's own `evaluationLanguage` is itself derived from `body.language` at
 * creation (recruitmentCampaigns.ts ~307), which one of the two creation flows
 * fills from the recruiter's browser too, and which defaults to 'ar' when absent.
 * This change makes the two sources CONSISTENT — it does not make either of them
 * DELIBERATE. A real interview-language chooser is still missing, and that is a
 * product decision, not a bug fix.
 *
 * Run: npx tsx src/scripts/voice-interview-language-test.ts
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLinkLanguage, resolveInterviewLanguage } from '../evaalo-only-voice/interviewConfig.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (...p: string[]) => readFileSync(join(HERE, '..', ...p), 'utf8');
const front = (...p: string[]) => readFileSync(join(HERE, '..', '..', '..', 'frontend', 'src', ...p), 'utf8');

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
    if (actual === expected) {
        console.log(`ok   ${name}`);
    } else {
        failures += 1;
        console.error(`FAIL ${name}: expected ${String(expected)}, got ${String(actual)}`);
    }
}

/* ── 1. silence is a value, and it is distinct from "Arabic" ───────────────── */
check('an empty link language is silence', parseLinkLanguage(''), null);
check('a missing link language is silence', parseLinkLanguage(undefined), null);
check('so is a junk value', parseLinkLanguage('klingon'), null);
check('"en" is a choice', parseLinkLanguage('en'), 'en');
check('"english" too', parseLinkLanguage('english'), 'en');
check('"ar" is a choice', parseLinkLanguage('ar'), 'ar');
check('and Kurdish is served by the Arabic voice', parseLinkLanguage('ku'), 'ar');
check('case does not matter', parseLinkLanguage('  EN '), 'en');

/* ── 2. precedence: the link if it spoke, else the campaign, else Arabic ───── */
check('an explicit English link wins over an Arabic campaign', resolveInterviewLanguage('en', 'ar'), 'en');
check('an explicit Arabic link wins over an English campaign', resolveInterviewLanguage('ar', 'en'), 'ar');
check('a silent link hands the decision to the campaign', resolveInterviewLanguage(null, 'en'), 'en');
check('…in the other direction too', resolveInterviewLanguage(null, 'ar'), 'ar');
check('a silent link and a silent campaign fall back to Arabic', resolveInterviewLanguage(null, undefined), 'ar');
check('an unreadable campaign value falls back to Arabic', resolveInterviewLanguage(null, 'klingon'), 'ar');
check('a Kurdish campaign is served in Arabic', resolveInterviewLanguage(null, 'ku'), 'ar');
/* The two production sessions, replayed: link silent (after this change) and
   campaign 'ar' — which is what both campaigns actually carry. */
check('6cfb7d62 / 2718fd5f would now be conducted in Arabic', resolveInterviewLanguage(null, 'ar'), 'ar');

/* ── 3. the server actually uses it, before it speaks ─────────────────────── */
const core = src('evaalo-only-voice', 'voiceSessionCore.ts');
check('the server parses the link language instead of a ternary',
    /const linkLanguage = parseLinkLanguage\(language\);/.test(core), true);
check('and no longer decides it with the old ternary',
    /language === 'en' \|\| language === 'english' \? 'en' : 'ar'/.test(core), false);
check('the campaign is consulted when the link is silent',
    /if \(linkLanguage === null\)[\s\S]{0,400}await campaignContextPromise/.test(core), true);
check('…and the value it reads is evaluationLanguage',
    /evaluationLanguage/.test(core), true);
/* The greeting and the TTS voice both follow `interviewLanguage`, so the
   resolution must happen BEFORE the greeting is built — otherwise the agent
   says hello in one language and continues in another. */
const resolveAt = core.indexOf('if (linkLanguage === null)');
const greetAt = core.indexOf('let greetingMsg: string;');
check('the language is resolved before the greeting is built', resolveAt > 0 && resolveAt < greetAt, true);
check('and the resolution is logged with its source', /\[LANG\][\s\S]{0,200}source=/.test(core), true);

/* ⚠️ DATA FLOW, not ordering. The check above proves the language is resolved
   BEFORE the greeting — and it passed while the greeting still read the RAW
   `language`. Once V1 made the link silent, that raw value was `undefined`, and
   getInitialGreetingMessage treats anything but an explicit 'ar' as English: the
   candidate was greeted in English and then interviewed in Arabic in an Arabic
   voice. A correct order with the wrong variable is a dead fix. So these read the
   arguments actually handed over at each consumer. */
function callBody(source: string, fn: string): string {
    const at = source.indexOf(fn + '(');
    if (at < 0) return '';
    let depth = 0;
    for (let i = at + fn.length; i < source.length; i += 1) {
        if (source[i] === '(') depth += 1;
        else if (source[i] === ')') {
            depth -= 1;
            if (depth === 0) return source.slice(at, i + 1);
        }
    }
    return '';
}
const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
const greetingCall = stripComments(callBody(core, 'getInitialGreetingMessage'));
check('the greeting is handed the RESOLVED language', /language:\s*interviewLanguage\b/.test(greetingCall), true);
check('…and not the raw link value', /language\s*[,}]/.test(greetingCall.replace(/language:\s*interviewLanguage/, '')), false);
const sttCall = stripComments(callBody(core, 'createSTTRouterConnection'));
check('speech-to-text is handed the resolved language', /\binterviewLanguage\b/.test(sttCall), true);
check('…and not the raw link value', /^\s*language,\s*$/m.test(sttCall), false);

/* ── 4. the frontend no longer manufactures a choice ──────────────────────── */
const sidebar = front('components', 'NewInterviewSidebar.jsx');
/* Scoped to the VOICE builder's own block: a bare substring search over the whole
   file matches this fix's own explanatory comment and the video builder below it,
   and the first version of this check did exactly that. */
function voiceLinkBlock(source: string): string {
    const end = source.indexOf('/screening-call?${params.toString()}');
    if (end < 0) throw new Error('the voice link builder moved — this test must be re-aimed');
    const start = source.lastIndexOf('const params = new URLSearchParams();', end);
    return source
        .slice(start, end)
        .split(/\r?\n/)
        .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('/*') && !l.trim().startsWith('//'))
        .join('\n');
}
check('the public voice link no longer injects the browser locale',
    /params\.set\('language'/.test(voiceLinkBlock(sidebar)), false);
check('and it is still the /screening-call builder that was touched',
    sidebar.includes('/screening-call?${params.toString()}'), true);

const hook = front('hooks', 'useVoiceInterview.js');
check('the socket sends a language only when there is one',
    /if \(lang\) params\.set\('language', lang\);/.test(hook), true);
check('…and no longer defaults it to Arabic on the client',
    hook.includes("params.set('language', lang || 'ar')"), false);

const publicPage = front('pages', 'PublicScreeningCall.jsx');
check('the candidate page takes the session language from the URL, not the page',
    publicPage.includes('const voiceLang = voiceSessionLanguage(currentLang);'), false);

const interviewPage = front('pages', 'Interview.jsx');
check('the per-candidate page no longer forces Arabic locally',
    interviewPage.includes("const language = urlLang || 'ar';"), false);

/* ── 4b. EVERY voice-link builder, found by scanning — not by a list ───────────
   ⚠️ The first version of this fix silenced two builders and missed two others
   (WrittenInterview.jsx — the Stage 1 share button — and RecentInterviewsCard.jsx),
   because the sites were enumerated by hand. And both 2026-09-23 sessions ran with
   `mode=direct`, i.e. through an `/interview` link: the path those candidates took
   was among the ones left unfixed. So this section finds the builders itself. A
   fifth builder added tomorrow is caught here without anyone remembering it. */
function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(jsx?|tsx?)$/.test(name)) out.push(p);
    }
    return out;
}
const FRONT_SRC = join(HERE, '..', '..', '..', 'frontend', 'src');
const VOICE_SITE = /absoluteAppUrl\(`\/(?:interview|screening-call)\?\$\{/g;
const builders: { file: string; block: string }[] = [];
for (const file of walk(FRONT_SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(VOICE_SITE)) {
        const at = m.index ?? 0;
        // the params object this link is built from: the nearest preceding builder
        const starts = [
            text.lastIndexOf('buildCandidateInterviewQuery({', at),
            text.lastIndexOf('new URLSearchParams', at),
        ];
        const start = Math.max(...starts);
        const block = text
            .slice(start, at)
            .split(/\r?\n/)
            .filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l))
            .join('\n');
        builders.push({ file: file.slice(FRONT_SRC.length + 1).replace(/\\/g, '/'), block });
    }
}
console.log(`   voice-link builders found by scan: ${builders.length} — ${builders.map((b) => b.file).join(', ')}`);
check('the scan finds at least the four known voice-link builders', builders.length >= 4, true);
for (const b of builders) {
    const injects =
        /language:\s*currentLang\s*[,}\n]/.test(b.block) ||
        /\.set\(\s*'language'\s*,\s*currentLang/.test(b.block);
    check(`${b.file}: the voice link does not carry the recruiter's browser locale`, injects, false);
}

/* ── 5. what this change deliberately does NOT touch ──────────────────────── */
/* The video link is another session's scope (plan: hidden-wibbling-puddle.md) and
   another window is editing that path — leaving it alone is the point, not an
   oversight. Asserted so a later edit here has to be deliberate. */
check('the video share link is left exactly as it was',
    /\/video-interview-call\?\$\{q\.toString\(\)\}`\);/.test(sidebar) && sidebar.includes('language: currentLang,'), true);
/* The site-wide default locale is a product decision, not a voice bug. */
const langCtx = front('contexts', 'LanguageContext.jsx');
check('the site-wide default locale is untouched', /return 'en';/.test(langCtx), true);

if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
}
console.log('\nall checks passed');
