import { ApiError } from '../services/apiClient';

/**
 * Maps Head Hunter API failures to user-facing i18n strings.
 * Never surfaces raw keys like `request_failed_500` in the UI.
 */
export function headHunterApiErrorMessage(err, t, { fallbackKey = 'aiHeadHunterErrGeneric' } = {}) {
    if (!(err instanceof ApiError)) {
        return t(fallbackKey);
    }

    if (err.status === 429) return t('aiHeadHunterErr429');
    if (err.status === 503) {
        const code = err.data?.error;
        if (code === 'CV_COMPARISON_WEBHOOK_NOT_CONFIGURED') {
            return t('cvComparisonErrWebhookMissing');
        }
        if (code === 'CV_COMPARISON_CALLBACK_SECRET_NOT_CONFIGURED') {
            return t('cvComparisonErrInboundSecretMissing');
        }
        if (code === 'CV_COMPARISON_CALLBACK_NOT_CONFIGURED') {
            return t('cvComparisonErrCallbackNotConfigured');
        }
        if (code === 'CV_COMPARISON_CALLBACK_ORIGIN_DENIED') {
            return t('cvComparisonErrCallbackOrigin');
        }
        if (typeof code === 'string' && code.startsWith('CV_COMPARISON_')) {
            return t('cvComparisonErrNotConfigured');
        }
        if (code === 'HEADHUNTER_NOT_CONFIGURED' || code === 'HEADHUNTER_CALLBACK_NOT_CONFIGURED') {
            return t('aiHeadHunterErrNotConfigured');
        }
        if (code === 'HEADHUNTER_CALLBACK_ORIGIN_DENIED') {
            return t('aiHeadHunterErrCallbackOrigin');
        }
        return t('aiHeadHunterErr503');
    }
    if (err.status === 502) return t('aiHeadHunterErr502');
    if (err.status >= 500) return t('aiHeadHunterErr500');
    if (err.status === 401 || err.status === 403) return t('aiHeadHunterErrAuth');

    const serverMsg = err.data?.message || err.data?.error;
    if (typeof serverMsg === 'string' && serverMsg.trim() && !/^request_failed_\d+$/.test(serverMsg.trim())) {
        return serverMsg.trim();
    }

    return t(fallbackKey);
}
