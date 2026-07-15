/**
 * Voice Reception billing policy — marketing/demo sessions are exempt;
 * org-owned production reception may become billable in a future phase.
 */

export type ReceptionBillingMode = 'exempt' | 'billable';

export type ReceptionBillingDecision = {
    mode: ReceptionBillingMode;
    reason: string;
    auditTag: string;
};

export function resolveReceptionBillingPolicy(context: {
    isDemo?: boolean;
    organizationId?: string;
    sessionSource?: 'ws' | 'livekit_demo';
}): ReceptionBillingDecision {
    const forced = (process.env.RECEPTION_BILLING_MODE || '').trim().toLowerCase();
    if (forced === 'billable' && context.organizationId) {
        return {
            mode: 'billable',
            reason: 'RECEPTION_BILLING_MODE=billable',
            auditTag: 'reception_billable_forced',
        };
    }

    if (context.isDemo || context.sessionSource === 'livekit_demo') {
        return {
            mode: 'exempt',
            reason: 'marketing_demo_session',
            auditTag: 'reception_exempt_demo',
        };
    }

    // Public /ws/voice-reception has no org context today — always exempt.
    if (!context.organizationId) {
        return {
            mode: 'exempt',
            reason: 'no_organization_context',
            auditTag: 'reception_exempt_no_org',
        };
    }

    return {
        mode: 'exempt',
        reason: 'reception_not_metered_v1',
        auditTag: 'reception_exempt_v1',
    };
}

export function logReceptionBillingAudit(
    sessionId: string,
    decision: ReceptionBillingDecision,
    extra?: Record<string, unknown>,
): void {
    console.info(
        `[RECEPTION BILLING] ${sessionId.substring(0, 8)}... mode=${decision.mode} reason=${decision.reason}`,
        extra ?? '',
    );
}
