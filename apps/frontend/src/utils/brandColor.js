/** Hex like #38bdf8 → RGB / rgba — shared by Account + Dashboard icon tiles */

export function brandRgb(hex) {
    const m = /^#?([\da-f]{6})$/i.exec(String(hex).trim());
    if (!m) return { r: 56, g: 189, b: 248 };
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function brandRgba(hex, a) {
    const { r, g, b } = brandRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Multi-tone fills (GitLab / Slack–style) from one accent */
export function serviceIconTones(hex) {
    return {
        a: brandRgba(hex, 1),
        b: brandRgba(hex, 0.78),
        c: brandRgba(hex, 0.55),
        d: brandRgba(hex, 0.38),
    };
}
