/**
 * Stage 1 screening billing — 2 credits (SCREENING) per candidate actually analyzed.
 *
 * Charge point: evaluation SUCCESS (the n8n stage1 callback), not submission.
 * A candidate is never blocked from applying because the hiring organization ran
 * out of credits, and an organization is never billed for an analysis it did not
 * receive. The counterpart guard lives in `stage1EvaluationOutboxService`, which
 * pre-checks the balance before dispatching to n8n so we never perform work we
 * cannot bill.
 *
 * Idempotency: `screening:<applicationId>` — one charge per application, so n8n
 * retries and duplicate callback deliveries can never double-charge.
 */

import { checkCredits, consumeCredits } from './billingRuntimeService.js';

const BILLING_ENFORCE = process.env.BILLING_ENFORCE !== 'false';

/** One candidate analyzed = one billable unit (2 credits at the SCREENING rate). */
const SCREENING_UNITS_PER_CANDIDATE = 1;

export function buildScreeningIdempotencyKey(applicationId: string): string {
    return `screening:${applicationId}`;
}

/**
 * Can this organization afford one more Stage 1 analysis right now?
 * Read-only — never writes to the ledger.
 */
export async function canAffordScreening(organizationId: string): Promise<boolean> {
    if (!BILLING_ENFORCE) return true;
    if (!organizationId.trim()) return true;
    const result = await checkCredits(organizationId, 'SCREENING', SCREENING_UNITS_PER_CANDIDATE);
    return result.ok;
}

/**
 * Bill a completed Stage 1 evaluation. Failures are logged, never thrown: the
 * evaluation is already persisted at this point and losing it over a billing
 * error would be far worse than an unbilled analysis.
 */
export async function chargeScreeningEvaluation(input: {
    organizationId: string;
    applicationId: string;
    candidateId: string;
    campaignId?: string | null;
}): Promise<void> {
    if (!BILLING_ENFORCE) return;
    const organizationId = input.organizationId.trim();
    if (!organizationId) {
        console.warn(
            `[screening-billing] missing organizationId — skipped charge for application ${input.applicationId}`
        );
        return;
    }

    try {
        const result = await consumeCredits({
            organizationId,
            usageType: 'SCREENING',
            units: SCREENING_UNITS_PER_CANDIDATE,
            idempotencyKey: buildScreeningIdempotencyKey(input.applicationId),
            source: 'screening',
            sourceId: input.applicationId,
            metadata: {
                stage: 'screening',
                candidateId: input.candidateId,
                campaignId: input.campaignId ?? null,
            },
        });

        if (!result.ok) {
            console.warn(
                `[screening-billing] charge denied org=${organizationId} application=${input.applicationId} code=${result.code}`
            );
            return;
        }
        if (result.duplicate) return;

        console.log(
            `[screening-billing] charged org=${organizationId} application=${input.applicationId}`
        );
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
            `[screening-billing] charge failed org=${organizationId} application=${input.applicationId}: ${message}`
        );
    }
}
