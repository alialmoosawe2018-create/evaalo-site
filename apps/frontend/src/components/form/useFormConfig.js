import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '../../config/apiBase.js';

/**
 * Fetch public form configuration for a campaign pub token.
 * GET /api/public/campaigns/:pubToken/form-config
 */
export function useFormConfig(pubToken) {
    const [state, setState] = useState({
        loading: true,
        error: null,
        errorCode: null,
        config: null,
    });

    const reload = useCallback(async () => {
        const token = String(pubToken || '').trim();
        if (!token) {
            setState({
                loading: false,
                error: 'MISSING_TOKEN',
                errorCode: 'MISSING_TOKEN',
                config: null,
            });
            return;
        }

        setState((prev) => ({ ...prev, loading: true, error: null, errorCode: null }));
        try {
            const res = await fetch(
                `${API_BASE_URL}/api/public/campaigns/${encodeURIComponent(token)}/form-config`
            );
            const data = await res.json().catch(() => ({}));
            if (res.status === 404) {
                setState({
                    loading: false,
                    error: 'NOT_FOUND',
                    errorCode: 'NOT_FOUND',
                    config: null,
                });
                return;
            }
            if (res.status === 410) {
                setState({
                    loading: false,
                    error: data.error || 'CAMPAIGN_CLOSED',
                    errorCode: data.code || 'CAMPAIGN_CLOSED',
                    config: null,
                });
                return;
            }
            if (!res.ok || !data.success || !data.form) {
                setState({
                    loading: false,
                    error: data.error || 'LOAD_FAILED',
                    errorCode: 'LOAD_FAILED',
                    config: null,
                });
                return;
            }
            setState({
                loading: false,
                error: null,
                errorCode: null,
                config: {
                    publicCampaignId: data.publicCampaignId,
                    positionTitle: data.positionTitle,
                    status: data.status,
                    form: data.form,
                },
            });
        } catch {
            setState({
                loading: false,
                error: 'NETWORK',
                errorCode: 'NETWORK',
                config: null,
            });
        }
    }, [pubToken]);

    useEffect(() => {
        reload();
    }, [reload]);

    return { ...state, reload };
}
