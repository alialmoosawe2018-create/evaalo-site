/**
 * Regression for the video-interview blueprint start path (2026-09-13).
 *
 * What broke on 2026-09-12: the first interview of a campaign ran with NO
 * competency model (generation was gated on a field the real flow never sets and
 * took ~100 s at /prepare while /start waited 30 s), the agent received only 6 of
 * 10 competencies (positional slice, no priority sort), and /end reached the
 * scorer twice for one transcript. These pin the pure pieces of the fix.
 *
 * Run: npm run test:blueprint-start-path
 */
import {
    MAX_AGENT_COMPETENCIES,
    buildBlueprintMetadata,
    orderCompetenciesForAgent,
} from '../services/expertise/blueprintMetadata.js';
import { blueprintStartFastModel, dedupeInFlight } from '../services/expertise/ensureBlueprint.js';
import { claimOnce, withTimeout } from '../services/videoStartGuards.js';

let failed = 0;
let passed = 0;
function ok(name: string, cond: unknown, extra?: string): void {
    if (cond) {
        passed++;
        console.log(`ok   ${name}${extra ? `  [${extra}]` : ''}`);
    } else {
        failed++;
        console.error(`FAIL ${name}${extra ? `  [${extra}]` : ''}`);
    }
}
const keys = (list: Array<{ competencyKey?: string; key?: string }>) =>
    list.map((c) => c.competencyKey || c.key).join(',');

async function main(): Promise<void> {
    // ── 1. priority order — the real stored order of the C&B blueprint (exec 1821)
    const stored = ['critical', 'high', 'critical', 'high', 'high', 'high', 'medium', 'medium', 'high', 'medium']
        .map((priority, i) => ({ priority, competencyKey: `k${i + 1}` }));
    const ordered = orderCompetenciesForAgent(stored);
    ok('criticals come first, in stored order', keys(ordered.slice(0, 2)) === 'k1,k3', keys(ordered.slice(0, 2)));
    ok('highs next, in stored order', keys(ordered.slice(2, 7)) === 'k2,k4,k5,k6,k9', keys(ordered.slice(2, 7)));
    ok('mediums last', keys(ordered.slice(7)) === 'k7,k8,k10', keys(ordered.slice(7)));
    ok('the input list is not mutated', keys(stored) === 'k1,k2,k3,k4,k5,k6,k7,k8,k9,k10');
    ok(
        'an unknown priority sorts after medium',
        keys(orderCompetenciesForAgent([{ priority: 'weird', competencyKey: 'x' }, { priority: 'medium', competencyKey: 'm' }])) === 'm,x'
    );
    ok('the old positional slice would have dropped a high (k9)', keys(stored.slice(0, 6)).includes('k9') === false);
    ok('the ordered slice keeps every critical and high', keys(ordered.slice(0, 7)).includes('k9'));

    // ── 2. buildBlueprintMetadata sends all ten, ordered
    const comp = (i: number, priority: string) => ({
        competencyKey: `k${i}`,
        title: `عنوان ${i}`,
        priority,
        questionObjective: 'اطلب مثالاً محدداً عن موقفٍ من العمل ونتيجته.',
        expectedEvidence: ['دليل أ', 'دليل ب', 'دليل ج'],
        redFlags: ['علامة أ', 'علامة ب'],
        followUpRules: ['شنو النتيجة؟', 'شلون قست الأثر؟'],
        scoreRubric: { '1': 'a', '2': 'b', '3': 'c', '4': 'd', '5': 'e' },
    });
    const twelve = ['medium', 'high', 'critical', 'high', 'medium', 'high', 'high', 'medium', 'critical', 'high', 'medium', 'high']
        .map((p, i) => comp(i + 1, p));
    const bundle = {
        blueprint: { language: 'ar', anchorQuestions: ['س١؟', 'س٢؟', 'س٣؟'], competencies: twelve },
        profile: null,
    } as any;
    const meta = buildBlueprintMetadata(bundle);
    ok('metadata is built', !!meta && typeof meta!.blueprint === 'string');
    const parsed = JSON.parse(meta!.blueprint) as { competencies: Array<{ key: string; objective: string }> };
    ok('the agent receives MAX_AGENT_COMPETENCIES = 10', MAX_AGENT_COMPETENCIES === 10 && parsed.competencies.length === 10, String(parsed.competencies.length));
    ok('both criticals lead the list', keys(parsed.competencies.slice(0, 2)) === 'k3,k9', keys(parsed.competencies.slice(0, 2)));
    ok('the two dropped are mediums, never a critical/high', keys(parsed.competencies).split(',').filter((k) => ['k1', 'k5', 'k8', 'k11'].includes(k)).length === 2);
    ok('objective survives the trim', parsed.competencies[0].objective.startsWith('اطلب مثالاً'));
    ok('payload is far below LiveKit\'s 512 KiB dispatch-metadata limit', Buffer.byteLength(meta!.blueprint, 'utf8') < 64 * 1024, `${Buffer.byteLength(meta!.blueprint, 'utf8')} bytes`);

    // ── 3. fast-model switch
    const savedFast = process.env.BLUEPRINT_START_FAST_MODEL;
    delete process.env.BLUEPRINT_START_FAST_MODEL;
    ok('the fast path is OFF by default (gpt-4o-mini cannot finish inside a start wait either)', blueprintStartFastModel() === '');
    process.env.BLUEPRINT_START_FAST_MODEL = '';
    ok('an empty BLUEPRINT_START_FAST_MODEL keeps it off', blueprintStartFastModel() === '');
    process.env.BLUEPRINT_START_FAST_MODEL = '  gpt-4.1-mini ';
    ok('a custom fast model is trimmed', blueprintStartFastModel() === 'gpt-4.1-mini');
    if (savedFast === undefined) delete process.env.BLUEPRINT_START_FAST_MODEL;
    else process.env.BLUEPRINT_START_FAST_MODEL = savedFast;

    // ── 4. one generation per campaign per process
    const registry = new Map<string, Promise<string>>();
    let starts = 0;
    const slow = () => {
        starts++;
        return new Promise<string>((resolve) => setTimeout(() => resolve('bundle'), 30));
    };
    const [a, b] = await Promise.all([
        dedupeInFlight(registry, 'camp:default', slow),
        dedupeInFlight(registry, 'camp:default', slow),
    ]);
    ok('two concurrent callers share one generation', starts === 1 && a === 'bundle' && b === 'bundle', `starts=${starts}`);
    ok('the entry is released once settled', registry.size === 0);
    await dedupeInFlight(registry, 'camp:default', slow);
    ok('a later caller starts a fresh generation', starts === 2);
    starts = 0;
    await Promise.all([
        dedupeInFlight(registry, 'camp:fast', slow),
        dedupeInFlight(registry, 'camp:default', slow),
    ]);
    ok('fast and default runs are independent', starts === 2);
    const boom = () => Promise.reject(new Error('generator down'));
    const rejected = await dedupeInFlight(registry, 'camp:err', boom).then(() => false, () => true);
    ok('a failed generation rejects the caller', rejected);
    ok('and is released too', registry.size === 0);

    // ── 5. /end sends one interview to the scorer once
    const sent = new Map<string, number>();
    ok('the first /end claims the dispatch', claimOnce(sent, 'session-1', 1_000));
    ok('the second /end 200 ms later is refused', claimOnce(sent, 'session-1', 1_200) === false);
    ok('another session is unaffected', claimOnce(sent, 'session-2', 1_300));
    ok('an expired claim can be taken again', claimOnce(sent, 'session-1', 1_000 + 7 * 3_600_000));
    ok('expired claims were swept', sent.has('session-2') === false);

    // ── 6. the start-path bound
    ok('a fast task returns its value', (await withTimeout(Promise.resolve(7), 50)) === 7);
    ok('a slow task yields null at the bound', (await withTimeout(new Promise<number>((r) => setTimeout(() => r(1), 150)), 20)) === null);
    ok('a rejected task yields null, never throws', (await withTimeout(Promise.reject(new Error('x')), 50)) === null);

    console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
}

main().catch((err) => {
    console.error('test crashed:', err);
    process.exit(1);
});
