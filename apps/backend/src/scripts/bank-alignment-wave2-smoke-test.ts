/**
 * Wave 2 bank alignment — pack anchors in interview_questions.json.
 * Usage: npx tsx src/scripts/bank-alignment-wave2-smoke-test.ts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DOMAIN_PACKS } from '../services/expertise/domainPacks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WAVE_2_PACK_KEYS = [
    'frontend_developer',
    'devops_engineer',
    'data_analyst',
    'qa_engineer',
    'customer_support',
    'operations_coordinator',
    'accounts_payable',
    'financial_analyst',
    'internal_auditor',
] as const;

const PACK_TO_JOB_SLUG: Record<(typeof WAVE_2_PACK_KEYS)[number], string> = {
    frontend_developer: 'frontend-developer',
    devops_engineer: 'devops-engineer',
    data_analyst: 'data-analyst',
    qa_engineer: 'qa-engineer-tester',
    customer_support: 'customer-support-specialist',
    operations_coordinator: 'operations-manager',
    accounts_payable: 'accounts-payable-officer',
    financial_analyst: 'financial-analyst',
    internal_auditor: 'auditor',
};

const PACK_TO_CATEGORY: Record<(typeof WAVE_2_PACK_KEYS)[number], string> = {
    frontend_developer: 'frontend',
    devops_engineer: 'devops',
    data_analyst: 'analytics',
    qa_engineer: 'qa',
    customer_support: 'customer_service',
    operations_coordinator: 'operations_coordination',
    accounts_payable: 'accounts_payable',
    financial_analyst: 'financial_analysis',
    internal_auditor: 'audit',
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

    for (const packKey of WAVE_2_PACK_KEYS) {
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

    console.log('✅ bank-alignment-wave2-smoke-test: all passed');
}

main();
