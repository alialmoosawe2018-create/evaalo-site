/**
 * Resolve candidate id after public screening intake POST.
 * Supports resume when the same email already applied (APPLICATION_EXISTS).
 */
export function resolvePublicScreeningCandidateId(res, result) {
    if (res.ok && result?.success && result?.data) {
        const rawId = result.data._id ?? result.data.id ?? result.data.candidateId;
        return rawId != null ? String(rawId) : '';
    }
    if (result?.code === 'APPLICATION_EXISTS' && result?.candidateId) {
        return String(result.candidateId);
    }
    return '';
}

/** @returns {string|null} user-facing error or null if ok */
export function publicScreeningCreateErrorMessage(res, result, fallback) {
    if (resolvePublicScreeningCandidateId(res, result)) return null;
    return result?.message || result?.error || fallback;
}
