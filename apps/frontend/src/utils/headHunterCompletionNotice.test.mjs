/**
 * The note a Head Hunter search ends with — only when it fell short of the target.
 *
 * Pins the owner's rules (2026-10-02):
 * - a note ONLY when fewer candidates arrived than were asked for (0 included);
 * - the sentence no longer claims "there are no further matches" — the page
 *   cannot know that;
 * - when the workflow reports that part of the search did not run normally
 *   (`serpHealth`), the counts are added as facts: only the non-zero parts, no
 *   cause claimed, and never "try again" (billing is per search).
 *
 * Calls the real helper with the real translation table, so a missing or
 * mismatched Arabic/Kurdish key fails here rather than on a recruiter's screen.
 * All figures are synthetic.
 *
 * Run: node src/utils/headHunterCompletionNotice.test.mjs   (from apps/frontend)
 */
import { headHunterCompletionNotice } from './headHunterCompletionNotice.js';
import { translations } from '../translations.js';

let failed = 0;
let passed = 0;

function check(name, fn) {
    try {
        fn();
        console.log('  ✓', name);
        passed += 1;
    } catch (err) {
        console.error('  ✗', name, '\n     ', err.message);
        failed += 1;
    }
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

/** The same lookup order as LanguageContext: the language, then English, then the key. */
const tFor = (lang) => (key) => translations[lang]?.[key] ?? translations.en[key] ?? key;
const t = tFor('en');

const notice = (input, tr = t) => headHunterCompletionNotice(input, tr);
const textOf = (input, tr = t) => notice(input, tr)?.text;

const SHORT = { status: 'completed', candidateCount: 3, wanted: 20 };
const OPENING_3_OF_20 =
    'The search widened itself automatically and found only 3 matching candidate(s) of the 20 you asked for.';
const FAILED_1_OF_4 = '1 of 4 search requests got no answer from the search engine';
const IGNORED_2_OF_4 = '2 of 4 search requests came back from Google with no LinkedIn profiles';
const DEGRADED = 'This search did not run normally:';

// ── when a note appears at all ───────────────────────────────────────────────

check('a search that met its target gets no note', () => {
    assert(notice({ status: 'completed', candidateCount: 20, wanted: 20 }) === null, 'count == wanted must be null');
    assert(notice({ status: 'completed', candidateCount: 27, wanted: 20 }) === null, 'count > wanted must be null');
});

check('a search that met its target gets no note even when part of it degraded', () => {
    const n = notice({
        status: 'completed',
        candidateCount: 20,
        wanted: 20,
        serpHealth: { calls: 4, failed: 2, ignoredFilter: 1 },
    });
    assert(n === null, 'owner rule: only short results get a note');
});

check('a short search gets a warn note', () => {
    const n = notice(SHORT);
    assert(n && n.type === 'warn', `expected a warn note, got ${JSON.stringify(n)}`);
});

check('zero candidates is short too, and gets its own opening (never "found only 0")', () => {
    assert(
        textOf({ status: 'completed', candidateCount: 0, wanted: 20 }) === 'The search found none of the 20 matching candidates you asked for.',
        `got: ${textOf({ status: 'completed', candidateCount: 0, wanted: 20 })}`,
    );
    assert(textOf({ status: 'completed', wanted: 40 }) === 'The search found none of the 40 matching candidates you asked for.', 'a missing count must read as 0');
});

check('a failed search gets the note only when the workflow counts came with it (the search engine was asked)', () => {
    assert(notice({ ...SHORT, status: 'failed' }) === null, 'failed without health must be null (its own path keeps its message)');
    assert(notice({ ...SHORT, status: 'failed', serpHealth: { calls: 0, failed: 0, ignoredFilter: 0 } }) === null, 'failed + 0 calls must be null (nothing was asked)');
    assert(notice({ ...SHORT, status: 'failed', serpHealth: 'degraded' }) === null, 'failed + a malformed report must be null');
    const n = notice({ status: 'failed', candidateCount: 0, wanted: 20, serpHealth: { calls: 2, failed: 2, ignoredFilter: 0 } });
    assert(n && n.type === 'warn', `failed + degraded must give a note, got ${JSON.stringify(n)}`);
    assert(notice({ status: 'failed', candidateCount: 20, wanted: 20, serpHealth: { calls: 2, failed: 2, ignoredFilter: 0 } }) === null, 'a target met is never noted, even when failed');
});

check('0 candidates, a clean search (nobody qualified, status failed): the zero note alone — owner decision 2026-10-03', () => {
    const text = textOf({ status: 'failed', candidateCount: 0, wanted: 20, serpHealth: { calls: 6, failed: 0, ignoredFilter: 0 } });
    assert(text === 'The search found none of the 20 matching candidates you asked for.', `got: ${text}`);
    const ar = textOf({ status: 'failed', candidateCount: 0, wanted: 40, serpHealth: { calls: 6, failed: 0, ignoredFilter: 0 } }, tFor('ar'));
    assert(ar === 'لم نعثر على أيّ مرشّح مطابق من أصل 40 طلبتهم.', `ar got: ${ar}`);
});

check('an unfinished search gets no note', () => {
    assert(notice({ ...SHORT, status: 'submitted' }) === null, 'submitted must be null');
    assert(notice({ ...SHORT, status: null }) === null, 'null status must be null');
    assert(notice({ ...SHORT, status: 'submitted', serpHealth: { calls: 2, failed: 2, ignoredFilter: 0 } }) === null, 'submitted + degraded must be null');
});

check('a result read back from durable storage (the live record is gone) gets no note', () => {
    assert(notice({ ...SHORT, source: 'durable' }) === null, 'durable must be null');
    assert(notice({ ...SHORT, source: 'durable', serpHealth: { calls: 2, failed: 2, ignoredFilter: 0 } }) === null, 'durable + degraded must be null');
    assert(notice({ ...SHORT, source: 'memory' })?.text === OPENING_3_OF_20, 'a live (memory) result keeps its note');
});

check('no target means nothing to fall short of', () => {
    assert(notice({ ...SHORT, wanted: 0 }) === null, 'wanted 0 must be null');
    assert(notice({ ...SHORT, wanted: undefined }) === null, 'wanted undefined must be null');
    assert(notice({ ...SHORT, wanted: 'abc' }) === null, 'non-numeric wanted must be null');
    assert(notice({}, t) === null, 'empty input must be null');
});

check('the target may arrive as a string', () => {
    assert(textOf({ ...SHORT, wanted: '20' }) === OPENING_3_OF_20, `got: ${textOf({ ...SHORT, wanted: '20' })}`);
});

// ── what the note says ───────────────────────────────────────────────────────

check('short without health: the reworded sentence, no "no further matches" claim', () => {
    const text = textOf(SHORT);
    assert(text === OPENING_3_OF_20, `got: ${text}`);
    assert(!/no further matches/i.test(text), 'the unprovable claim is back');
});

check('a clean health report adds nothing', () => {
    const text = textOf({ ...SHORT, serpHealth: { calls: 4, failed: 0, ignoredFilter: 0 } });
    assert(text === OPENING_3_OF_20, `got: ${text}`);
});

check('failed requests only: the failed part, no ignored part, no separator', () => {
    const text = textOf({ ...SHORT, serpHealth: { calls: 4, failed: 1, ignoredFilter: 0 } });
    assert(
        text === `${OPENING_3_OF_20} ${DEGRADED} ${FAILED_1_OF_4}.`,
        `got: ${text}`,
    );
});

check('ignored filter only: the ignored part, no failed part, no separator', () => {
    const text = textOf({ ...SHORT, serpHealth: { calls: 4, failed: 0, ignoredFilter: 2 } });
    assert(
        text === `${OPENING_3_OF_20} ${DEGRADED} ${IGNORED_2_OF_4}.`,
        `got: ${text}`,
    );
});

check('both: failed part, separator, ignored part — each with its own count', () => {
    const text = textOf({ ...SHORT, serpHealth: { calls: 4, failed: 1, ignoredFilter: 2 } });
    assert(
        text === `${OPENING_3_OF_20} ${DEGRADED} ${FAILED_1_OF_4}; ${IGNORED_2_OF_4}.`,
        `got: ${text}`,
    );
});

check('every request failed, zero candidates (the search ends failed): the zero opening and the failed part', () => {
    const want = 'The search found none of the 20 matching candidates you asked for. This search did not run normally: 2 of 2 search requests got no answer from the search engine.';
    for (const status of ['failed', 'completed']) {
        const text = textOf({ status, candidateCount: 0, wanted: 20, serpHealth: { calls: 2, failed: 2, ignoredFilter: 0 } });
        assert(text === want, `${status}: ${text}`);
    }
});

check('a malformed health report costs only the detail, never a garbled sentence', () => {
    const bad = [
        null,
        'degraded',
        [1, 2, 3],
        { calls: 4, failed: -1, ignoredFilter: 0 },
        { calls: 4, failed: 1.5, ignoredFilter: 0 },
        { calls: 4, failed: '1', ignoredFilter: 0 },
        { calls: 4, failed: 3, ignoredFilter: 2 }, // more problems than calls
        { calls: 4, failed: 1 }, // ignoredFilter missing
        { calls: Number.NaN, failed: 1, ignoredFilter: 0 },
    ];
    for (const serpHealth of bad) {
        const text = textOf({ ...SHORT, serpHealth });
        assert(text === OPENING_3_OF_20, `serpHealth ${JSON.stringify(serpHealth)} gave: ${text}`);
    }
});

check("the workflow's English errorMessage never reaches the note", () => {
    const text = textOf({
        ...SHORT,
        errorMessage: 'Expanded search completed: sent 3 qualified candidate(s); target was 20.',
        serpHealth: { calls: 4, failed: 1, ignoredFilter: 0 },
    });
    assert(!text.includes('Expanded search completed'), `workflow text leaked: ${text}`);
});

// ── Arabic and Kurdish ───────────────────────────────────────────────────────

/** Exact renderings (distinct counts, so a swapped {failed}/{calls}/{ignored} cannot pass). */
const RENDERED = {
    ar: {
        both: 'وسّعنا البحث تلقائياً ووجدنا 3 فقط من أصل 20 مرشّحاً مطابقاً طلبتهم. لم يجرِ هذا البحث بشكل طبيعي: لم يُجب محرّك البحث على 1 من طلبات البحث (من أصل 5)، وأعاد Google نتائج خالية من ملفات LinkedIn في 2 من طلبات البحث (من أصل 5).',
        zero: 'لم نعثر على أيّ مرشّح مطابق من أصل 20 طلبتهم. لم يجرِ هذا البحث بشكل طبيعي: لم يُجب محرّك البحث على 2 من طلبات البحث (من أصل 2).',
    },
    ku: {
        both: 'گەڕانەکە خۆکارانە فراوان کرا و تەنها 3 کەسی گونجاو دۆزرایەوە لە 20 ی داواکراو. ئەم گەڕانە بە شێوەیەکی ئاسایی کاری نەکرد: بۆ 1 لە 5 داواکاریی گەڕان هیچ وەڵامێک لە بزوێنەری گەڕانەوە نەهات و لە 2 لە 5 داواکاریی گەڕاندا هیچ پڕۆفایلێکی LinkedIn لە ئەنجامەکانی Google دا نەبوو.',
        zero: 'هیچ کەسێکی گونجاو نەدۆزرایەوە لە 20 ی داواکراو. ئەم گەڕانە بە شێوەیەکی ئاسایی کاری نەکرد: بۆ 2 لە 2 داواکاریی گەڕان هیچ وەڵامێک لە بزوێنەری گەڕانەوە نەهات.',
    },
};
/** The old unprovable clause, as each language wrote it. */
const NO_FURTHER = { ar: /لا مزيد|لا يوجد المزيد/, ku: /زیاتر نییە/ };

const NOTE_KEYS = [
    'aiHeadHunterShortResult',
    'aiHeadHunterShortResultNone',
    'aiHeadHunterSerpDegraded',
    'aiHeadHunterSerpFailedPart',
    'aiHeadHunterSerpIgnoredPart',
    'aiHeadHunterSerpPartSep',
];
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

for (const lang of ['ar', 'ku']) {
    check(`${lang}: every note key exists with the same {placeholders} as English`, () => {
        for (const key of NOTE_KEYS) {
            const own = translations[lang][key];
            assert(typeof own === 'string' && own.length > 0, `${lang}.${key} missing`);
            assert(own !== translations.en[key] || key === 'aiHeadHunterSerpPartSep', `${lang}.${key} is untranslated English`);
            assert(
                placeholders(own) === placeholders(translations.en[key]),
                `${lang}.${key} placeholders {${placeholders(own)}} != en {${placeholders(translations.en[key])}}`,
            );
        }
    });

    check(`${lang}: a degraded short note renders fully, in the language, with every count`, () => {
        const text = textOf({ ...SHORT, serpHealth: { calls: 5, failed: 1, ignoredFilter: 2 } }, tFor(lang));
        assert(!/[{}]/.test(text), `unfilled placeholder: ${text}`);
        assert(!/\bThe search\b|did not run normally|search requests/.test(text), `English leaked into ${lang}: ${text}`);
        assert(text === RENDERED[lang].both, `${lang} rendering changed:\n  got  ${text}\n  want ${RENDERED[lang].both}`);
    });
    check(`${lang}: zero candidates after failed requests renders exactly`, () => {
        const text = textOf({ status: 'failed', candidateCount: 0, wanted: 20, serpHealth: { calls: 2, failed: 2, ignoredFilter: 0 } }, tFor(lang));
        assert(text === RENDERED[lang].zero, `${lang} rendering changed:\n  got  ${text}\n  want ${RENDERED[lang].zero}`);
    });
    check(`${lang}: the old "no further matches" clause is gone in this language too`, () => {
        for (const key of NOTE_KEYS) assert(!NO_FURTHER[lang].test(translations[lang][key]), `${lang}.${key} claims no further matches: ${translations[lang][key]}`);
    });
}

check('no language tells the recruiter to search again (billing is per search)', () => {
    const again = {
        en: /try again|search again|re-?run/i,
        ar: /حاول|مرة أخرى|مرّة أخرى|أعد البحث|إعادة البحث/,
        ku: /دووبارە|هەوڵ|جارێکی تر/,
    };
    for (const [lang, re] of Object.entries(again)) {
        for (const key of NOTE_KEYS) {
            assert(!re.test(translations[lang][key]), `${lang}.${key} suggests a re-run: ${translations[lang][key]}`);
        }
    }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
