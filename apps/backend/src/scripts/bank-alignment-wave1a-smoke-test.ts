/**
 * Wave 1A bank alignment — pack anchors must appear in interview_questions.json.
 * Usage: npx tsx src/scripts/bank-alignment-wave1a-smoke-test.ts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DOMAIN_PACKS } from '../services/expertise/domainPacks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WAVE_1A_PACK_KEYS = ['hr_recruiter', 'petroleum_engineer', 'survey_engineer'] as const;

const PACK_TO_JOB_SLUG: Record<(typeof WAVE_1A_PACK_KEYS)[number], string> = {
    hr_recruiter: 'recruiter',
    petroleum_engineer: 'petroleum-engineer',
    survey_engineer: 'survey-engineer',
};

const PACK_TO_CATEGORY: Record<(typeof WAVE_1A_PACK_KEYS)[number], string> = {
    hr_recruiter: 'recruitment',
    petroleum_engineer: 'petroleum',
    survey_engineer: 'surveying',
};

function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

function questionMarkCount(text: string): number {
    return (text.match(/[؟?]/g) || []).length;
}

function main(): void {
    const bankPath = path.resolve(
        __dirname,
        '../../../avatar-evaalov2/src/voice_interview/data/interview_questions.json'
    );
    assert(fs.existsSync(bankPath), `bank not found: ${bankPath}`);

    const bank = JSON.parse(fs.readFileSync(bankPath, 'utf-8')) as {
        jobs: Record<string, string[]>;
        categories: Record<string, string[]>;
        position_registry: Record<string, { category?: string; alias_of?: string }>;
    };

    for (const packKey of WAVE_1A_PACK_KEYS) {
        const pack = DOMAIN_PACKS.find((p) => p.packKey === packKey);
        assert(!!pack, `pack ${packKey}`);
        const slug = PACK_TO_JOB_SLUG[packKey];
        const category = PACK_TO_CATEGORY[packKey];
        const jobQuestions = bank.jobs[slug];
        const categoryQuestions = bank.categories[category];

        assert(Array.isArray(jobQuestions) && jobQuestions.length === 10, `${slug} has 10 anchors`);
        assert(
            JSON.stringify(jobQuestions) === JSON.stringify(categoryQuestions),
            `jobs[${slug}] must mirror categories[${category}]`
        );

        for (const anchor of pack!.suggestedAnchorQuestions) {
            assert(jobQuestions.includes(anchor), `${slug} missing pack anchor: ${anchor}`);
            assert(questionMarkCount(anchor) <= 1, `${slug} anchor has multiple ?: ${anchor}`);
        }

        const registryEntry = bank.position_registry[slug];
        assert(registryEntry?.category === category, `${slug} registry category ${category}`);

        const blob = jobQuestions.join(' ').toLowerCase();
        const terms = (pack!.terminology || []).slice(0, 12);
        let hits = 0;
        for (const term of terms) {
            if (blob.includes(term.toLowerCase())) hits += 1;
        }
        assert(hits >= 3, `${packKey} terminology hits in bank (got ${hits})`);
    }

    console.log('✅ bank-alignment-wave1a-smoke-test: all passed');
}

main();
