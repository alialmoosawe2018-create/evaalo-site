// Pack maturity — structural depth vs conversation validation (separate axes).
import { DOMAIN_PACKS } from './domainPacks.js';
import { L3_ENRICHED_PACK_KEYS } from './wave3EnrichedHelpers.js';

export type StructuralLevel = 'L1_generated' | 'L2' | 'L3_enriched';

export type ConversationMaturity = 'draft' | 'qa_passed' | 'conversation_validated';

export interface PackMaturityRecord {
    packKey: string;
    structuralLevel: StructuralLevel;
    conversationMaturity: ConversationMaturity;
    validatedAt?: string;
    scenarioIds?: string[];
    notes?: string;
}

const L3_SET = new Set<string>(L3_ENRICHED_PACK_KEYS);

/** Conversation maturity overrides — hr_recruiter validated via Live QA personas. */
const CONVERSATION_OVERRIDES: Partial<Record<string, ConversationMaturity>> = {
    hr_recruiter: 'conversation_validated',
};

const VALIDATED_META: Partial<Record<string, { validatedAt: string; scenarioIds: string[] }>> = {
    hr_recruiter: {
        validatedAt: '2026-07-07',
        scenarioIds: [
            'p05_resume_active',
            'p05_ambiguous_clarify',
            'p05_answer_in_progress',
            'p05_topic_skip',
            'p05_single_question_guard',
        ],
    },
};

function structuralLevelForPack(packKey: string, packVersion?: string): StructuralLevel {
    if (packKey === 'chef' || packVersion === '1.0.0') return 'L2';
    if (L3_SET.has(packKey)) return 'L3_enriched';
    return 'L1_generated';
}

function buildRegistry(): Record<string, PackMaturityRecord> {
    const out: Record<string, PackMaturityRecord> = {};
    for (const pack of DOMAIN_PACKS) {
        const conversationMaturity = CONVERSATION_OVERRIDES[pack.packKey] ?? 'draft';
        const meta = VALIDATED_META[pack.packKey];
        out[pack.packKey] = {
            packKey: pack.packKey,
            structuralLevel: structuralLevelForPack(pack.packKey, pack.packVersion),
            conversationMaturity,
            validatedAt: meta?.validatedAt,
            scenarioIds: meta?.scenarioIds,
        };
    }
    return out;
}

export const PACK_MATURITY_REGISTRY: Record<string, PackMaturityRecord> = buildRegistry();

export function getPackMaturity(packKey: string): PackMaturityRecord | undefined {
    return PACK_MATURITY_REGISTRY[packKey];
}

export function listConversationValidated(): PackMaturityRecord[] {
    return Object.values(PACK_MATURITY_REGISTRY).filter(
        (r) => r.conversationMaturity === 'conversation_validated'
    );
}

export function countByStructuralLevel(): Record<StructuralLevel, number> {
    const counts: Record<StructuralLevel, number> = {
        L1_generated: 0,
        L2: 0,
        L3_enriched: 0,
    };
    for (const r of Object.values(PACK_MATURITY_REGISTRY)) {
        counts[r.structuralLevel] += 1;
    }
    return counts;
}

export function countConversationValidated(): number {
    return listConversationValidated().length;
}
