/**
 * Wave 1B bank alignment — pack anchors in interview_questions.json.
 * Usage: npx tsx src/scripts/bank-alignment-wave1b-smoke-test.ts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DOMAIN_PACKS } from '../services/expertise/domainPacks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WAVE_1B_PACK_KEYS = [
    'reservoir_engineer',
    'drilling_engineer',
    'civil_engineer',
    'site_engineer',
    'process_engineer',
] as const;

const PACK_TO_JOB_SLUG: Record<(typeof WAVE_1B_PACK_KEYS)[number], string> = {
    reservoir_engineer: 'reservoir-engineer',
    drilling_engineer: 'drilling-engineer',
    civil_engineer: 'civil-engineer',
    site_engineer: 'site-engineer',
    process_engineer: 'process-engineer',
};

const PACK_TO_CATEGORY: Record<(typeof WAVE_1B_PACK_KEYS)[number], string> = {
    reservoir_engineer: 'reservoir',
    drilling_engineer: 'drilling',
    civil_engineer: 'civil_engineering',
    site_engineer: 'site_engineering',
    process_engineer: 'process_engineering',
};

function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

function main(): void {
    const bankPath = path.resolve(
        __dirname,
        '../../../avatar-evaalov2/src/voice_interview/data/interview_questions.json'
    );
    const bank = JSON.parse(fs.readFileSync(bankPath, 'utf-8')) as {
        jobs: Record<string, string[]>;
        categories: Record<string, string[]>;
        position_registry: Record<string, { category?: string }>;
    };

    for (const packKey of WAVE_1B_PACK_KEYS) {
        const pack = DOMAIN_PACKS.find((p) => p.packKey === packKey);
        assert(!!pack, `pack ${packKey}`);
        const slug = PACK_TO_JOB_SLUG[packKey];
        const category = PACK_TO_CATEGORY[packKey];
        const jobQuestions = bank.jobs[slug];
        const categoryQuestions = bank.categories[category];

        assert(Array.isArray(jobQuestions) && jobQuestions.length === 10, `${slug} has 10 anchors`);
        assert(
            JSON.stringify(jobQuestions) === JSON.stringify(categoryQuestions),
            `jobs[${slug}] != categories[${category}]`
        );

        for (const anchor of pack!.suggestedAnchorQuestions) {
            assert(jobQuestions.includes(anchor), `${slug} missing anchor: ${anchor}`);
        }

        assert(bank.position_registry[slug]?.category === category, `${slug} registry`);

        const blob = jobQuestions.join(' ').toLowerCase();
        let hits = 0;
        for (const term of (pack!.terminology || []).slice(0, 12)) {
            if (blob.includes(term.toLowerCase())) hits += 1;
        }
        assert(hits >= 3, `${packKey} terminology hits (got ${hits})`);
    }

    console.log('✅ bank-alignment-wave1b-smoke-test: all passed');
}

main();
