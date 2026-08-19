/**
 * Shared handler for AI-suggested SEARCH criteria (Head Hunter + CV Comparison).
 * Given a position + location, proposes values for the optional search filters
 * (skills / languages / certifications / industry). Charges 1 credit
 * (CRITERIA_SUGGESTION), refunded on empty result or failure.
 *
 * Mounted separately in each router so each page keeps its own permission gate:
 *   headHunter.ts   → requirePermission('headhunter.search')
 *   cvComparison.ts → requirePermission('cvComparison.compare')
 */
import type { Request, Response } from 'express';
import crypto from 'crypto';
import { getOrgId } from '../middleware/auth.js';
import { logAudit } from '../services/auditService.js';
import { consumeCredits, adjustCredits } from '../services/billingRuntimeService.js';
import { creditCostMicro } from '../services/billingEngine.js';
import { suggestSearchCriteria } from '../services/llmService.js';

const BILLING_ENFORCE = process.env.BILLING_ENFORCE !== 'false';

/** Refund the suggestion fee on failure (idempotent, fire-and-forget). */
async function refundSearchCriteriaSuggestion(
    organizationId: string,
    genId: string,
    reason: string
): Promise<void> {
    await adjustCredits({
        organizationId,
        amountMicro: creditCostMicro('CRITERIA_SUGGESTION', 1),
        idempotencyKey: `search-criteria-suggestion-refund:${genId}`,
        metadata: { kind: 'criteria_suggestion_refund', reason, genId },
    }).catch((e) =>
        console.warn(`[suggest-search-criteria] refund failed genId=${genId}: ${e?.message || e}`)
    );
}

export async function suggestSearchCriteriaHandler(req: Request, res: Response): Promise<void> {
    const genId = crypto.randomUUID();
    let organizationId = '';
    let charged = false;
    try {
        const body = req.body || {};
        const position = typeof body.position === 'string' ? body.position.trim() : '';
        const location = typeof body.location === 'string' ? body.location.trim() : '';
        if (!position || !location) {
            res.status(400).json({
                success: false,
                error: 'Missing position/location',
                message: 'position and location are required to suggest criteria',
            });
            return;
        }
        organizationId = getOrgId(req);

        // تحصيل CRITERIA_SUGGESTION (1 كردت/اقتراح). يُسترد إذا فشل الاقتراح أدناه.
        if (BILLING_ENFORCE) {
            const billing = await consumeCredits({
                organizationId,
                usageType: 'CRITERIA_SUGGESTION',
                units: 1,
                idempotencyKey: `search-criteria-suggestion:${genId}`,
                source: 'criteria_suggestion',
                sourceId: genId,
                metadata: { position, location },
            });
            if (!billing.ok) {
                const status = billing.code === 'INSUFFICIENT_CREDITS' ? 402 : 403;
                res.status(status).json({
                    success: false,
                    error: billing.code,
                    message: billing.message,
                });
                return;
            }
            charged = !billing.duplicate;
        }

        const criteria = await suggestSearchCriteria({
            position,
            location,
            language: typeof body.language === 'string' ? body.language : undefined,
        });

        if (!criteria || Object.keys(criteria).length === 0) {
            if (charged) await refundSearchCriteriaSuggestion(organizationId, genId, 'empty_suggestion');
            res.status(400).json({
                success: false,
                error: 'No criteria suggested',
                message: 'Could not suggest criteria (OpenAI not configured or empty result)',
            });
            return;
        }

        logAudit(req, {
            action: 'search.suggestCriteria',
            targetType: 'searchCriteria',
            metadata: { position, location, keys: Object.keys(criteria), charged },
        });

        res.json({ success: true, criteria });
    } catch (error: any) {
        if (charged) await refundSearchCriteriaSuggestion(organizationId, genId, 'exception');
        console.error('❌ Error suggesting search criteria:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to suggest criteria',
            message: error.message,
        });
    }
}
