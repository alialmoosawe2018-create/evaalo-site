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
 * Two stages, recorded because the first one was not enough:
 *
 *   V1 (e9b2cb1, 15b788a) kept the video path's rule — "an explicit link outranks
 *   the campaign, the campaign is the fallback for silence" — and made the link
 *   silent. That left every link ALREADY SENT still deciding the interview, since
 *   each one carried the recruiter's browser locale; and there was still nowhere a
 *   recruiter actually chose a language.
 *
 *   The owner then decided (2026-09-23): the language is set when the job is
 *   created — a required field, no default — and the campaign is the ONLY
 *   authority. The link is not an input at all (services/interviewLanguage.ts).
 *   The REPORT language is a separate question and is deliberately unchanged.
 *
 * And one regression V1 caused and this file now pins: the greeting read the RAW
 * link value, which V1 had made `undefined`, so it came out in English before an
 * Arabic interview (4475f69). Hence the data-flow checks, not just ordering.
 *
 * Run: npx tsx src/scripts/voice-interview-language-test.ts
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLinkLanguage } from '../evaalo-only-voice/interviewConfig.js';
import { resolveCampaignInterviewLanguage } from '../services/interviewLanguage.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (...p: string[]) => readFileSync(join(HERE, '..', ...p), 'utf8');
const front = (...p: string[]) => readFileSync(join(HERE, '..', '..', '..', 'frontend', 'src', ...p), 'utf8');

/** Body of the first call to `fn(` in `source`, parenthesis-balanced. */
function callBodyOf(source: string, fn: string): string {
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

/* ── 2. the campaign is the ONLY authority (owner, 2026-09-23) ───────────────
   V1 shipped "an explicit link wins, the campaign is the fallback for silence".
   That left every OLD link — each one carrying the recruiter's browser locale —
   still deciding the interview. The owner then made the campaign the sole
   authority: the link is not an input at all. */
check('the campaign field decides', resolveCampaignInterviewLanguage({ interviewLanguage: 'en' }).language, 'en');
check('…and says so', resolveCampaignInterviewLanguage({ interviewLanguage: 'en' }).source, 'campaign');
check('the field outranks the old report language',
    resolveCampaignInterviewLanguage({ interviewLanguage: 'ar', criteria: { evaluationLanguage: 'en' } }).language, 'ar');
check('a campaign older than the field keeps its report language',
    resolveCampaignInterviewLanguage({ criteria: { evaluationLanguage: 'en' } }).language, 'en');
check('…labelled as the legacy path',
    resolveCampaignInterviewLanguage({ criteria: { evaluationLanguage: 'en' } }).source, 'legacy_evaluation_language');
check('no campaign at all ⇒ Arabic', resolveCampaignInterviewLanguage(null).language, 'ar');
check('…labelled as the default', resolveCampaignInterviewLanguage(null).source, 'default');
check('a junk field value falls through, it is not trusted',
    resolveCampaignInterviewLanguage({ interviewLanguage: 'klingon', criteria: { evaluationLanguage: 'ar' } }).source,
    'legacy_evaluation_language');
check('a Kurdish campaign is served in Arabic', resolveCampaignInterviewLanguage({ interviewLanguage: 'ku' }).language, 'ar');
/* The two production sessions, replayed against their real campaigns: no field
   yet, `evaluationLanguage: 'ar'` — and their links said `en`, which is now
   simply not read. */
check('6cfb7d62 / 2718fd5f would now be conducted in Arabic',
    resolveCampaignInterviewLanguage({ criteria: { evaluationLanguage: 'ar' } }).language, 'ar');

/* ── 3. the server uses the campaign, and never the link ──────────────────── */
const core = src('evaalo-only-voice', 'voiceSessionCore.ts');
const exec = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
const coreCode = exec(core);
check('the session decides with the shared campaign resolver',
    /interviewLanguage = resolved\.language;/.test(coreCode) && /resolveCampaignInterviewLanguage\(\{/.test(coreCode), true);
check('the language starts from Arabic, not from the link',
    /let interviewLanguage: 'ar' \| 'en' = 'ar';/.test(coreCode), true);
check('the link-first resolver is gone from the code',
    /resolveInterviewLanguage\(/.test(coreCode), false);
check('the link is read ONLY inside the voice-test branch',
    (coreCode.match(/linkLanguage \?\? 'ar'/g) || []).length === 1 &&
        /if \(isVoiceTest\) \{[\s\S]{0,200}linkLanguage \?\? 'ar'/.test(coreCode), true);
check('the campaign field is loaded with the campaign',
    /\.select\("criteria jobAdvertisement campaignId interviewLanguage"\)/.test(coreCode), true);
/* The greeting and the TTS voice both follow `interviewLanguage`, so the
   decision must be made BEFORE the greeting is built. (Ordering alone is not
   enough — see the data-flow checks below — but it is still necessary.) */
const decideAt = core.indexOf('resolveCampaignInterviewLanguage({');
const greetAt = core.indexOf('let greetingMsg: string;');
check('the language is decided before the greeting is built', decideAt > 0 && decideAt < greetAt, true);
check('and the decision is logged with its source', /\[LANG\][\s\S]{0,200}source=\$\{resolved\.source\}/.test(core), true);
/* The report language is a different question and must not move: the n8n
   payload still carries the raw link value, exactly as before, and n8nService
   resolves the report from the campaign's evaluationLanguage first. Pinned. */
const n8nCall = exec(callBodyOf(core, 'finalizeAndSendVoiceTranscriptToN8N'));
check('the REPORT language line in the n8n payload is untouched (raw `language`)',
    /^\s*language,\s*$/m.test(n8nCall), true);

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
