import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useBilling } from '../contexts/BillingContext';

const STRIPE_RETURN_PARAMS = ['stripe_return', 'session_id', 'setup', 'source'];

function hasStripeReturnSignal(params) {
    return STRIPE_RETURN_PARAMS.some((key) => {
        const value = params.get(key);
        return value != null && value !== '';
    });
}

/**
 * After returning from Stripe (checkout, portal, setup), fast-poll billing status
 * and strip one-shot query params from the URL.
 *
 * @param {(snapshot: object|null) => void} [onSettled] Optional callback after refresh window ends.
 */
export function useBillingStripeReturnRefresh(onSettled) {
    const [searchParams, setSearchParams] = useSearchParams();
    const { startFastRefresh, stopFastRefresh } = useBilling();

    useEffect(() => {
        if (!hasStripeReturnSignal(searchParams)) return undefined;

        const next = new URLSearchParams(searchParams);
        let changed = false;
        for (const key of STRIPE_RETURN_PARAMS) {
            if (next.has(key)) {
                next.delete(key);
                changed = true;
            }
        }
        if (changed) {
            setSearchParams(next, { replace: true });
        }

        startFastRefresh({
            durationMs: 30_000,
            intervalMs: 2_000,
            stopWhen: (snapshot) =>
                snapshot?.lifecycleState === 'subscription_active' ||
                (snapshot?.configured === true &&
                    (snapshot?.subscriptionStatus === 'active' ||
                        snapshot?.subscriptionStatus === 'trialing')),
        }).then((snapshot) => {
            onSettled?.(snapshot);
        });

        return () => {
            stopFastRefresh();
        };
    }, [searchParams, setSearchParams, startFastRefresh, stopFastRefresh, onSettled]);
}
