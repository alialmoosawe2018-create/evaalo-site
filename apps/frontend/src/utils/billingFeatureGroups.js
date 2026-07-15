/**
 * Feature groupings for UI presentation ONLY.
 *
 * Allowed uses:
 *   - AdjustPlanModal bullet sections
 *   - Marketing copy grouping
 *   - i18n section headers
 *
 * FORBIDDEN uses (architecture contract):
 *   - Access control (`if (FEATURE_GROUPS.platform.includes(x)) ...`)
 *   - Mapping featureGroups → RBAC permissions
 *   - Any backend usage or `billingEngine.ts` import
 *
 * Enforcement always uses flat BillingFeature strings via `planHasFeature()`
 * on the backend only.
 */

export const FEATURE_GROUPS = Object.freeze({
    screening: Object.freeze(['screening.basic', 'screening.cv_compare', 'screening.advanced']),
    interviews: Object.freeze(['interviews.voice', 'interviews.video', 'interviews.privateLinks']),
    search: Object.freeze(['search.headhunter']),
    jobs: Object.freeze(['jobs.display', 'jobs.publish']),
    ai: Object.freeze(['reports.ai_scoring', 'recruitment.full']),
    voice: Object.freeze([
        'voice.default',
        'voice.identity.customization',
        'voice.cloning',
        'avatar.branding',
    ]),
    ads: Object.freeze(['ads.basic', 'ads.campaigns']),
    platform: Object.freeze(['api.access', 'webhooks.inbound', 'integrations.custom', 'seats.management', 'support.priority']),
});

export const FEATURE_GROUP_ORDER = Object.freeze([
    'screening',
    'interviews',
    'search',
    'jobs',
    'ai',
    'voice',
    'ads',
    'platform',
]);

/**
 * Group a plan's features by display group, preserving the FEATURE_GROUP_ORDER.
 * Returns an array of { groupKey, features[] } for stable rendering.
 *
 * Empty groups are omitted. Unknown features (not in any group) fall under
 * a synthetic 'other' group at the end so nothing silently disappears.
 */
export function groupFeaturesForDisplay(planFeatures) {
    if (!Array.isArray(planFeatures) || planFeatures.length === 0) return [];

    const remaining = new Set(planFeatures);
    const grouped = [];

    for (const groupKey of FEATURE_GROUP_ORDER) {
        const groupFeatures = FEATURE_GROUPS[groupKey] || [];
        const matched = groupFeatures.filter((f) => remaining.has(f));
        if (matched.length > 0) {
            grouped.push({ groupKey, features: matched });
            matched.forEach((f) => remaining.delete(f));
        }
    }

    if (remaining.size > 0) {
        grouped.push({ groupKey: 'other', features: Array.from(remaining) });
    }

    return grouped;
}
