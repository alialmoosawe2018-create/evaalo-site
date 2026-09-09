/**
 * The job title a row should DISPLAY: the role its campaign is hiring for.
 *
 * `position_applied_for` on a person or an application holds what the applicant
 * typed or picked about themselves, which is routinely a different job from the
 * one they applied to — measured on production, 4 of 6 recent applications
 * disagreed with their campaign, one of them "Mud Engineer" against a campaign
 * for "Senior HR Specialist".
 *
 * Every screen therefore had to repair the value itself, and each did it
 * separately or not at all:
 *   - the notifications card fetched the campaigns in a SECOND request and
 *     patched the rows after the first paint, so the wrong title was visible for
 *     about a second on every refresh;
 *   - the campaign cards fell back to the most common applicant-typed title
 *     until that same request landed;
 *   - the shared voice/video interview pages never repaired it at all, so the
 *     CANDIDATE opened the link and saw a job that was not the one being filled.
 *
 * Resolving it once on the read path removes the second phase rather than hiding
 * it, and it fixes records already in the database — no migration, no backfill.
 * The applicant's own wording is preserved on the row as `declaredPosition`.
 *
 * This is display only. What the interview agent is told to ask about still
 * comes from applicationJobContext.ts.
 */

/** Mirrors the frontend's resolveTitleFromMeta, so both sides name a campaign identically. */
export function campaignRoleFromCampaign(campaign: unknown): string {
    if (!campaign || typeof campaign !== 'object') return '';
    const doc = campaign as { criteria?: unknown; templateName?: unknown };
    const criteria = doc.criteria;
    if (criteria && typeof criteria === 'object' && !Array.isArray(criteria)) {
        const c = criteria as Record<string, unknown>;
        const pos = c.position ?? c.position_applied_for ?? c.job;
        if (pos != null && String(pos).trim()) return String(pos).trim();
    }
    if (doc.templateName != null && String(doc.templateName).trim()) {
        return String(doc.templateName).trim();
    }
    return '';
}

/**
 * campaignId → the role it is hiring for, for every id that resolves to one.
 * A campaign with no role of its own is simply absent from the map, which leaves
 * the row's own title in place.
 */
export async function loadCampaignRoles(
    campaignIds: Iterable<string>
): Promise<Map<string, string>> {
    const ids = [...new Set([...campaignIds].map((id) => String(id || '').trim()).filter(Boolean))];
    const roles = new Map<string, string>();
    if (ids.length === 0) return roles;
    try {
        const RecruitmentCampaign = (await import('../models/RecruitmentCampaign.js')).default;
        const docs = await RecruitmentCampaign.find({ campaignId: { $in: ids } })
            .select('campaignId criteria.position criteria.position_applied_for criteria.job templateName')
            .lean();
        for (const doc of docs as Array<{ campaignId?: unknown }>) {
            const id = String(doc?.campaignId || '').trim();
            const role = campaignRoleFromCampaign(doc);
            if (id && role) roles.set(id, role);
        }
    } catch (error: unknown) {
        // Display-only enrichment: a lookup failure leaves the applicant's own
        // title showing, exactly as before this existed. It must never fail a list.
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[campaign role] lookup failed for ${ids.length} campaign(s): ${message}`);
    }
    return roles;
}

/**
 * Put the campaign's role on the row and keep the applicant's wording as
 * `declaredPosition`. Rows with no campaign, or a campaign with no role, are
 * returned untouched.
 */
export function applyCampaignRole<T extends Record<string, unknown>>(
    row: T,
    roles: Map<string, string>
): T {
    const campaignId = String(row.campaignId || '').trim();
    const role = campaignId ? roles.get(campaignId) : undefined;
    if (!role) return row;
    const declared = String(row.position_applied_for || '').trim();
    if (declared === role) return row;
    return {
        ...row,
        position_applied_for: role,
        ...(declared ? { declaredPosition: row.declaredPosition ?? declared } : {}),
    };
}

/**
 * ما يُكتَب عند التقديم — لا ما يُعرض.
 *
 * `applyCampaignRole` أعلاه تُصلح القراءة فقط، وتعليق رأس هذا الملف يقول ذلك
 * صراحةً: «هذا للعرض فقط؛ ما يُسأل عنه الوكيل يأتي من applicationJobContext».
 * وهناك تكلفة ذلك: في 2026-09-06 قدّم «علي احمد عواد» على حملة
 * «Senior HR Assistant» وسجلّ طلبه يحمل `position_applied_for` = «Senior
 * Petroleum Engineer» — وهو تقديمه الأوّل والوحيد، أي أنّ القيمة كُتبت خطأً من
 * البداية لا أنّها بقيّة تقديمٍ سابق. فبنك أسئلة الوكيل يقرأ هذا الحقل، فسُئل
 * عن الآبار والمكامن وGOR، ثمّ قُيّم على كفاءات موارد بشرية: صفر تغطية، وصفر
 * درجة، ورفض.
 *
 * القاعدة: الحملة هي مصدر الحقيقة للوظيفة المتقدَّم إليها. ولا نمحو ما كتبه
 * المرشّح — يُحفَظ في `declaredPosition`، لأنّه إشارة بحدّ ذاته (قد يكون عمله
 * الحالي، وقد يكون تقديماً في المكان الخطأ).
 */
export function reconcileIntakePosition(opts: {
    declared?: unknown;
    campaignRole?: unknown;
}): { position_applied_for?: string; declaredPosition?: string; corrected: boolean } {
    const role = String(opts.campaignRole ?? '').trim();
    const declared = String(opts.declared ?? '').trim();
    // بلا دورٍ للحملة لا مرجع نصحّح إليه — تُترك كلمة المرشّح كما هي.
    if (!role) return { corrected: false };
    if (!declared) return { position_applied_for: role, corrected: false };
    // المقارنة تتساهل في المسافات وحالة الأحرف فقط؛ أي فرقٍ حقيقي يُسجَّل.
    const same = declared.toLowerCase().replace(/\s+/g, ' ') === role.toLowerCase().replace(/\s+/g, ' ');
    if (same) return { position_applied_for: role, corrected: false };
    return { position_applied_for: role, declaredPosition: declared, corrected: true };
}

/** Enrich a whole list in one campaign lookup. */
export async function withCampaignRoles<T extends Record<string, unknown>>(
    rows: T[]
): Promise<T[]> {
    if (rows.length === 0) return rows;
    const roles = await loadCampaignRoles(rows.map((r) => String(r.campaignId || '')));
    if (roles.size === 0) return rows;
    return rows.map((row) => applyCampaignRole(row, roles));
}
