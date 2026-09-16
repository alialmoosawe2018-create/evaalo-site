/**
 * headhunter-competency-persistence-test
 *
 * The production defect this locks down (2026-09-16): the head-hunter competency
 * model lived in a process-local Map, so a search's ranking depended on whether
 * an unrelated background LLM call had already finished — and every deploy reset
 * every role to that cold first search.
 *
 * Measured in production: execution 1868 at 17:52:48 shipped NO competency model,
 * the background upgrade landed at 17:54:28, and execution 1869 at 17:59:34 — the
 * same role, the same criteria, the same English inputs — ranked against eight
 * competencies and returned fewer, better candidates. The recruiter read that as
 * "the Arabic search lost its competencies". Language had nothing to do with it.
 *
 * This test drives the LIFECYCLE, not the helpers: store a model, wipe the
 * in-memory cache the way a deploy does, and require the real entry point
 * `buildHeadHunterCompetencyModel` to still answer with it. No LLM call is made
 * anywhere in this file — every path is a cache hit or a deliberate miss.
 *
 * Run: npm run test:headhunter-persistence   (needs MONGODB_URI, e.g. -r dotenv/config)
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import HeadHunterCompetencyCache from '../models/HeadHunterCompetencyCache.js';
import {
    buildHeadHunterCompetencyModel,
    clearHeadHunterCompetencyCache,
    __seedPersistedCompetencyModelForTests,
    __readPersistedCompetencyModelForTests,
    __clearPersistedCompetencyModelForTests,
    __competencyCacheKeyForTests,
    type HeadHunterCompetencyInput,
    type HeadHunterCompetencyModel,
} from '../services/headHunterCompetencyModel.js';

let passed = 0;
const failures: string[] = [];

function check(label: string, cond: boolean): void {
    if (cond) {
        passed++;
        console.log(`  ok    ${label}`);
    } else {
        failures.push(label);
        console.log(`  FAIL  ${label}`);
    }
}

/** A title no pack and no LLM would ever produce, so a hit is unambiguous. */
const SENTINEL = 'PERSISTED-SENTINEL-COMPETENCY';

const INPUT: HeadHunterCompetencyInput = {
    position: 'Persistence Test Role 9f2a',
    location: 'Baghdad, Iraq',
    criteria: { yearsOfExperience: '5-10', industryType: 'Oil & Gas' },
};

const MODEL: HeadHunterCompetencyModel = {
    roleTitle: 'Persistence Test Role 9f2a',
    roleSummary: 'Fixture used only by the persistence lifecycle test.',
    domain: 'business',
    specialization: '',
    seniority: 'mid',
    requiredSkills: ['fixture skill'],
    toolsAndSystems: ['fixture tool'],
    competencies: [
        {
            key: 'persisted_sentinel',
            title: SENTINEL,
            priority: 'critical',
            evidence: ['fixture evidence'],
            redFlags: ['fixture red flag'],
        },
    ],
    source: 'llm',
    knowledgeDepth: 'taxonomy_generated',
    generatedAt: '2026-09-16T17:54:28.514Z',
};

function isSentinel(m: HeadHunterCompetencyModel | null): boolean {
    return !!m && m.competencies.some((c) => c.title === SENTINEL);
}

async function main(): Promise<void> {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is required for this test');
    await mongoose.connect(uri);
    console.log(`\nconnected to ${mongoose.connection.db?.databaseName}`);

    await __clearPersistedCompetencyModelForTests(INPUT);
    clearHeadHunterCompetencyCache();

    console.log('\n=== 1. a stored model survives the process ===');
    await __seedPersistedCompetencyModelForTests(INPUT, MODEL);
    check('the row is written', (await __readPersistedCompetencyModelForTests(INPUT)) !== null);

    // The deploy. This is exactly what wiped the model in production.
    clearHeadHunterCompetencyCache();
    const t0 = Date.now();
    const afterRestart = await buildHeadHunterCompetencyModel(INPUT);
    const ms = Date.now() - t0;
    check('THE FIX: the real entry point answers from the store after a wipe', isSentinel(afterRestart));
    check(`and still does not block the recruiter (${ms}ms < 2000)`, ms < 2000);

    console.log('\n=== 2. the second call is served from memory ===');
    const t1 = Date.now();
    const warm = await buildHeadHunterCompetencyModel(INPUT);
    check('same answer', isSentinel(warm));
    check(`memory hit is immediate (${Date.now() - t1}ms < 100)`, Date.now() - t1 < 100);

    console.log('\n=== 3. MUTATION PROOF: delete the row, the hit disappears ===');
    await __clearPersistedCompetencyModelForTests(INPUT);
    clearHeadHunterCompetencyCache();
    const gone = await __readPersistedCompetencyModelForTests(INPUT);
    check('without the row there is nothing to read', gone === null);

    console.log('\n=== 4. a stale row is not served ===');
    await HeadHunterCompetencyCache.updateOne(
        { cacheKey: __competencyCacheKeyForTests(INPUT) },
        {
            $set: {
                snapshot: MODEL as unknown as Record<string, unknown>,
                competencyCount: 1,
                expiresAt: new Date(Date.now() - 60_000),
            },
        },
        { upsert: true }
    );
    check(
        'an expired row is refused even before the TTL sweep removes it',
        (await __readPersistedCompetencyModelForTests(INPUT)) === null
    );

    console.log('\n=== 5. an empty model is never served ===');
    await HeadHunterCompetencyCache.updateOne(
        { cacheKey: __competencyCacheKeyForTests(INPUT) },
        {
            $set: {
                snapshot: { ...MODEL, competencies: [] } as unknown as Record<string, unknown>,
                competencyCount: 0,
                expiresAt: new Date(Date.now() + 60_000),
            },
        },
        { upsert: true }
    );
    check(
        'zero competencies reads as no model, not as an empty instruction',
        (await __readPersistedCompetencyModelForTests(INPUT)) === null
    );

    console.log('\n=== 6. Mongo down must cost nothing ===');
    await __clearPersistedCompetencyModelForTests(INPUT);
    await mongoose.disconnect();
    const t2 = Date.now();
    const offline = await __readPersistedCompetencyModelForTests(INPUT);
    const offlineMs = Date.now() - t2;
    check('a disconnected cache answers null', offline === null);
    check(
        `and fails fast instead of buffering ~10s (${offlineMs}ms < 500)`,
        offlineMs < 500
    );

    console.log(`\n${failures.length === 0 ? 'PASS' : 'FAIL'} — ${passed} assertions passed`);
    if (failures.length > 0) {
        for (const f of failures) console.log(`  - ${f}`);
        process.exit(1);
    }
}

main().catch(async (err) => {
    console.error('\nFAIL —', err instanceof Error ? err.message : err);
    try {
        await mongoose.disconnect();
    } catch {
        /* already down */
    }
    process.exit(1);
});
