/**
 * Head Hunter competency model smoke test (no DB, no LLM needed).
 * Usage: npx tsx src/scripts/headhunter-competency-model-test.ts
 *
 * Add `--with-upgrade` (and real credentials, e.g. `-r dotenv/config`) to also
 * wait for the background LLM upgrade to land in the cache. That takes 75-110
 * seconds, which is exactly why the search never waits on it.
 */
import {
    buildHeadHunterCompetencyModel,
    clearHeadHunterCompetencyCache,
} from '../services/headHunterCompetencyModel.js';

function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

const WITH_UPGRADE = process.argv.includes('--with-upgrade');

async function main(): Promise<void> {
    clearHeadHunterCompetencyCache();

    // 1) The instant tier answers a real search immediately, from the pack.
    const t0 = Date.now();
    const model = await buildHeadHunterCompetencyModel({
        position: 'Petroleum Engineer',
        location: 'Baghdad, Iraq',
        criteria: { yearsOfExperience: '5-10', industryType: 'Oil & Gas' },
    });
    const firstMs = Date.now() - t0;
    assert(model !== null, 'a role with a curated pack must produce a model');
    assert(model!.competencies.length > 0, 'model must carry competencies');
    assert(
        model!.competencies.every((c) => !!c.key && !!c.title),
        'every competency needs a key and a title'
    );
    assert(model!.competencies.length <= 8, 'competencies must stay capped for the prompt');
    assert(!!model!.roleTitle, 'roleTitle set');
    // The whole point of the pack tier: a recruiter never waits for this.
    assert(firstMs < 2000, `first search must not block (took ${firstMs}ms)`);
    console.log(
        `  role="${model!.roleTitle}" domain="${model!.domain}" seniority="${model!.seniority}" ` +
            `depth=${model!.knowledgeDepth} source=${model!.source} ` +
            `competencies=${model!.competencies.length} in ${firstMs}ms`
    );
    for (const c of model!.competencies) {
        console.log(
            `   - [${c.priority}] ${c.title} (evidence ${c.evidence.length}, red flags ${c.redFlags.length})`
        );
    }

    // 2) Criteria that do not shape the role must not change the answer.
    const t1 = Date.now();
    const again = await buildHeadHunterCompetencyModel({
        position: 'Petroleum Engineer',
        location: 'Basra, Iraq',
        criteria: {
            yearsOfExperience: '5-10',
            industryType: 'Oil & Gas',
            requiredLanguages: 'English',
        },
    });
    const secondMs = Date.now() - t1;
    assert(again !== null, 'the same role must still produce a model');
    assert(
        again!.competencies.map((c) => c.key).join(',') ===
            model!.competencies.map((c) => c.key).join(','),
        'a non-role-shaping filter must not change the competencies'
    );
    assert(secondMs < 2000, `second search must not block either (took ${secondMs}ms)`);

    // 3) Nothing to build from → null, never a throw.
    const empty = await buildHeadHunterCompetencyModel({ position: '   ' });
    assert(empty === null, 'a blank position must yield null, not a model');

    // 4) The off switch is honoured.
    const previous = process.env.HEADHUNTER_COMPETENCY_MODEL;
    process.env.HEADHUNTER_COMPETENCY_MODEL = 'false';
    const disabled = await buildHeadHunterCompetencyModel({ position: 'Petroleum Engineer' });
    assert(disabled === null, 'the feature flag must switch the model off');
    if (previous === undefined) delete process.env.HEADHUNTER_COMPETENCY_MODEL;
    else process.env.HEADHUNTER_COMPETENCY_MODEL = previous;

    // 5) Optional: the background upgrade eventually replaces the pack model.
    if (WITH_UPGRADE) {
        console.log('  waiting for the background LLM upgrade (up to 150s)…');
        const deadline = Date.now() + 150_000;
        let upgraded = null as Awaited<ReturnType<typeof buildHeadHunterCompetencyModel>>;
        while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 3000));
            const current = await buildHeadHunterCompetencyModel({
                position: 'Petroleum Engineer',
                location: 'Baghdad, Iraq',
                criteria: { yearsOfExperience: '5-10', industryType: 'Oil & Gas' },
            });
            if (current && current.source === 'llm') {
                upgraded = current;
                break;
            }
        }
        assert(upgraded !== null, 'the background upgrade never reached the cache');
        console.log(
            `  upgraded: source=${upgraded!.source} competencies=${upgraded!.competencies.length} ` +
                `skills=${upgraded!.requiredSkills.length} tools=${upgraded!.toolsAndSystems.length}`
        );
    }

    console.log('✅ headhunter-competency-model-test: all passed');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
