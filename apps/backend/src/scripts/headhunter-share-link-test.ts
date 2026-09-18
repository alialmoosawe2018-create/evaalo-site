/**
 * A Head Hunter share link must name the campaign it interviews for.
 *
 * 🔴 THE DEFECT. The builder wrote `if (campaignId) params.set('campaignId', …)`,
 * and both Head Hunter pages forgot to pass the prop. Every link went out
 * without a campaign and nothing complained — the candidate found out, after
 * filling in the whole form, as
 * `Validation error: Path 'organizationId' is required`. The server derives the
 * organization from the campaign and from nothing else, so a link without one
 * is not a link with fewer parameters; it is a link that cannot work.
 *
 * ⚠️ This imports the REAL frontend module, not a copy of its rule. The previous
 * test for this area (`headHunterInviteRole.test.mjs`) hand-copied a `linkParams`
 * helper, which is the same dead-check shape the defect hid behind.
 *
 * The specifier is built at runtime for the reason `stage1-parity-test` records:
 * the backend tsconfig sets `rootDir: ./src` with `allowJs` off, so a static
 * import of a sibling workspace's .js fails type-check, while Node/tsx resolves
 * a computed one normally — which is what makes this parity rather than a copy.
 *
 * Run: npm run test:headhunter-share-link
 */
import assert from 'node:assert/strict';

const FRONTEND_UTILS = new URL('../../../frontend/src/utils/', import.meta.url).href;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mod: any = await import(`${FRONTEND_UTILS}publicVideoScreeningUrl.js`);
const buildPublicVideoScreeningQuery = mod.buildPublicVideoScreeningQuery;

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

/** What the caller passes on the happy path. */
const CAMPAIGN = 'b1e2d3c4a5f60718293a4b5c6d7e8f90';

function params(opts: Record<string, unknown>): URLSearchParams {
    return new URLSearchParams(buildPublicVideoScreeningQuery(opts));
}

check('🔴 refuses to build a link with no campaign', () => {
    assert.throws(
        () => buildPublicVideoScreeningQuery({ position: 'HR Manager' }),
        /campaignId is required/,
        'a link without a campaign was produced — the candidate would be refused ' +
            'after filling in the whole form'
    );
});

check('🔴 …and an empty or whitespace campaign is no campaign', () => {
    for (const bad of ['', '   ', null, undefined]) {
        assert.throws(
            () => buildPublicVideoScreeningQuery({ campaignId: bad as any }),
            /campaignId is required/,
            `campaignId=${JSON.stringify(bad)} slipped through`
        );
    }
});

check('the campaign is always carried, never conditionally', () => {
    assert.equal(params({ campaignId: CAMPAIGN }).get('campaignId'), CAMPAIGN);
    // …and with everything else absent, it is the ONLY parameter
    assert.deepEqual([...params({ campaignId: CAMPAIGN }).keys()], ['campaignId']);
});

check('the campaign id is trimmed, not passed through raw', () => {
    assert.equal(params({ campaignId: `  ${CAMPAIGN}  ` }).get('campaignId'), CAMPAIGN);
});

check('no role ⇒ no `position` at all — never a guess', () => {
    // The contract `headHunterInviteRole` exists to protect: a campaign that
    // names no role gives the server nothing to repair towards, so saying
    // nothing beats saying something wrong.
    assert.equal(params({ campaignId: CAMPAIGN, position: '' }).has('position'), false);
    assert.equal(params({ campaignId: CAMPAIGN, position: '   ' }).has('position'), false);
});

check('the role is carried RAW — localizing it here would corrupt the record', () => {
    // `reconcileIntakePosition` compares this against the stored campaign role.
    // A translated title never matches, and every Head Hunter application would
    // be recorded as "the candidate declared something else".
    const q = params({ campaignId: CAMPAIGN, position: 'HR Manager' });
    assert.equal(q.get('position'), 'HR Manager');
});

check('the sourcing context and language ride along when present', () => {
    const q = params({
        campaignId: CAMPAIGN,
        headHunterContextId: 'deadbeefdeadbeefdeadbeef',
        position: 'HR Manager',
    });
    assert.equal(q.get('hh'), 'deadbeefdeadbeefdeadbeef');
    assert.equal(q.get('position'), 'HR Manager');
});

check('the language hook is called with the caller\'s language', () => {
    let seen: unknown = '__unset__';
    const qs = buildPublicVideoScreeningQuery(
        { campaignId: CAMPAIGN, language: 'ar' },
        (p: URLSearchParams, lang: string | undefined) => {
            seen = lang;
            if (lang) p.set('language', lang);
        }
    );
    assert.equal(seen, 'ar');
    assert.equal(new URLSearchParams(qs).get('language'), 'ar');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
