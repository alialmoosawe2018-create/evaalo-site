/**
 * Helpers for Account → Active Sessions.
 *
 * Sessions come from the Clerk Backend API (`GET /api/users/me/sessions`); the
 * User-Agent helper below is only the fallback for environments where the server
 * cannot enumerate sessions.
 */

/**
 * Device label for a session row returned by the server.
 */
export function formatServerSessionLabel(session) {
    const browser = String(session?.browserName ?? '').trim();
    const rawType = String(session?.deviceType ?? '').trim();
    const kind = rawType
        ? rawType.charAt(0).toUpperCase() + rawType.slice(1)
        : session?.isMobile
          ? 'Mobile'
          : 'Desktop';
    return browser ? `${browser} (${kind})` : kind;
}

/**
 * "City, Country" when geo-location resolved, otherwise the IP, otherwise empty.
 */
export function formatSessionLocation(session) {
    const parts = [session?.city, session?.country].map((v) => String(v ?? '').trim()).filter(Boolean);
    if (parts.length > 0) return parts.join(', ');
    return String(session?.ipAddress ?? '').trim();
}

/**
 * Short label from User-Agent only (no server-side device binding).
 */
export function getBrowserDeviceLabel(userAgent) {
    const ua =
        typeof userAgent === 'string'
            ? userAgent
            : typeof navigator !== 'undefined'
              ? navigator.userAgent
              : '';
    const mobile = /Mobi|Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);
    let name = '';
    if (/\bEdg\//i.test(ua)) name = 'Edge';
    else if (/OPR\/|Opera\b/i.test(ua)) name = 'Opera';
    else if (/Firefox\//i.test(ua)) name = 'Firefox';
    else if (/Chrome\//i.test(ua) && !/\bEdg\//i.test(ua)) name = 'Chrome';
    else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) name = 'Safari';

    const kind = mobile ? 'Mobile' : 'Desktop';
    return name ? `${name} (${kind})` : `This browser (${kind})`;
}

/**
 * Relative time vs now (past session start).
 */
export function formatSessionRelativeTime(epochMs, locale = 'en') {
    const then = typeof epochMs === 'number' && Number.isFinite(epochMs) ? epochMs : Date.now();
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

    let diffSec = Math.round((then - Date.now()) / 1000);

    const cut = Math.abs(diffSec);
    if (cut < 60) return rtf.format(diffSec, 'second');

    let diffMin = Math.round(diffSec / 60);
    if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute');

    let diffHr = Math.round(diffMin / 60);
    if (Math.abs(diffHr) < 24) return rtf.format(diffHr, 'hour');

    let diffDay = Math.round(diffHr / 24);
    if (Math.abs(diffDay) < 7) return rtf.format(diffDay, 'day');

    let diffWeek = Math.round(diffDay / 7);
    if (Math.abs(diffWeek) < 5) return rtf.format(diffWeek, 'week');

    let diffMonth = Math.round(diffDay / 30);
    if (Math.abs(diffMonth) < 12) return rtf.format(diffMonth, 'month');

    let diffYear = Math.round(diffDay / 365);
    return rtf.format(diffYear, 'year');
}
