import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../services/apiClient';
import { resolveTitleFromMeta } from '../../utils/screeningCampaigns.js';
import { localizeCatalogLabel } from '../../utils/localizeCatalogLabel.js';
import { useLanguage } from '../../contexts/LanguageContext.jsx';

/**
 * يختار حملة التوظيف التي ستُنشأ تحتها روابط مقابلة الهيد هانتر.
 *
 * 🔴 لماذا هذا المكوّن موجود أصلاً. رابط المشاركة كان يخرج بلا `campaignId`،
 * فيملأ المرشّح الاستمارة كاملة ثمّ يُرفض بـ
 * `Validation error: Path 'organizationId' is required` — لأنّ الخادم يشتقّ
 * المؤسّسة من الحملة ولا شيء غيرها. وربطُ المشاركة بحملة حقيقية يُدخل مرشّح
 * الهيد هانتر في سلسلة Evaalo نفسها: مخطّطة ← بوّابة جاهزية ← كفاءات مثبَّتة ←
 * المرحلة الثالثة.
 *
 * ⚠️ القائمة تأتي من `/api/recruitment-campaigns/shareable`، وهي **مُحدَّدة
 * بمؤسّسة الجلسة في الخادم** عبر `orgScopedQuery`. ترشيحُ المتصفّح راحةٌ للعرض
 * لا حدٌّ أمني؛ والخادم يُعيد التحقّق من الملكية عند توليد السياق مهما أرسلت
 * الواجهة.
 *
 * ⚠️ والعنوان يُترجَم للعرض فقط. الرابط يحمل القيمة المخزَّنة الخام — انظر
 * `utils/publicVideoScreeningUrl.js`.
 */
/** الدور مُطَبَّع للمقارنة: المسافات والحالة فقط — لا اشتقاق ولا تخمين. */
function normalizeRole(v) {
    return String(v || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

export default function HeadHunterCampaignPicker({ onPick, onClose, searchRole, searchContext, t }) {
    const { currentLang } = useLanguage();
    const [rows, setRows] = useState(null);
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    const [refreshing, setRefreshing] = useState(false);
    const [showAll, setShowAll] = useState(false);
    /* القائمة مطويّة: الزرّ هو المسار، والاختيار اليدوي مخرجٌ لا واجهة. */
    const [browsing, setBrowsing] = useState(false);
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState('');

    /*
     * النقطة في الخادم بلا ذاكرة مؤقّتة عن قصد، لكنّ ذلك وحده لا يكفي: هذا
     * المكوّن كان يجلب عند التركيب فقط. والمستخدم ينشئ الوظيفة في تبويبة أخرى
     * ثمّ يعود إلى هذه — والقائمة أمامه لم تُجلب من جديد. فكان سيرى غياب
     * وظيفته ويظنّها مشكلة تخزين مؤقّت وهي ليست كذلك.
     */
    const load = useCallback(async () => {
        setRefreshing(true);
        setError('');
        try {
            const data = await apiClient.get('/api/recruitment-campaigns/shareable');
            if (data?.success && Array.isArray(data.campaigns)) {
                setRows(
                    data.campaigns.map((c) => ({
                        campaignId: c.campaignId,
                        // نفس الدالّة التي تسمّي الحملة في كل شاشة أخرى،
                        // فلا تُستحدث مرآة ثالثة لعنوان الوظيفة.
                        title: resolveTitleFromMeta(c),
                        // لغة المخطّطة — يرثها الرابط بدل لغة واجهة الموظّف.
                        language: c.language || '',
                        createdAt: c.createdAt,
                    }))
                );
            } else {
                setRows([]);
                setError(t('aiHeadHunterCampaignPickerError'));
            }
        } catch {
            setRows([]);
            setError(t('aiHeadHunterCampaignPickerError'));
        } finally {
            setRefreshing(false);
        }
    }, [t]);

    useEffect(() => {
        load();
    }, [load]);

    /*
     * 🔴 الوظيفة المعروضة هي وظيفة بحثك.
     *
     * لا شيء كان يمنع البحث عن «HR Generalist» ثمّ اختيار حملة «Sales Manager»:
     * النظام يقبلها، ويُقابَل المرشّح على كفاءاتٍ ليست كفاءات البحث الذي وجده.
     * فالافتراض هنا هو المطابق وحده.
     *
     * ⚠️ لكنّ «أظهر كلّ الوظائف» يبقى مفتوحاً عن قصد: المطابقة نصّية وهشّة
     * («HR Generalist» مقابل «Human Resources Generalist»)، وترشيحٌ صارم يُخفي
     * حملتك الحقيقية فيدفعك لإنشاء نسخةٍ مكرّرة — وذلك أسوأ من الخطأ الذي نمنعه.
     */
    const wantedRole = normalizeRole(searchRole);
    const roleMatched = useMemo(() => {
        if (!rows) return [];
        if (!wantedRole) return rows;
        return rows.filter((r) => normalizeRole(r.title) === wantedRole);
    }, [rows, wantedRole]);

    const base = showAll || !wantedRole ? rows || [] : roleMatched;
    const hiddenCount = (rows?.length || 0) - roleMatched.length;

    /*
     * 🔴 هل ستُستعمل وظيفةٌ قائمة أم ستُنشأ واحدة؟ يُحسب هنا **للعرض** بنفس
     * قاعدة `createOrReuse` بالضبط.
     *
     * كان الزرّ يقول «لا توجد وظيفة لها بعد» حتّى حين توجد وتُعاد استعمالها —
     * أي يَعِد بالإنشاء ثمّ لا يُنشئ. ومن يرى نصّاً لا يصف ما سيحدث يبحث عن
     * زرٍّ آخر يصدّقه.
     */
    const matchedExisting = useMemo(
        () => (wantedRole ? (rows || []).find((r) => normalizeRole(r.title) === wantedRole) || null : null),
        [rows, wantedRole]
    );

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return base;
        return base.filter((r) => {
            const shown = localizeCatalogLabel(r.title, currentLang) || r.title || '';
            return shown.toLowerCase().includes(q) || (r.title || '').toLowerCase().includes(q);
        });
    }, [base, query, currentLang]);

    /*
     * إنشاء وظيفة من البحث نفسه، بضغطةٍ واحدة.
     *
     * ⚠️ لا يُعرض إلّا حين **لا يوجد مطابق**. بضغطةٍ متاحة دائماً تتكاثر الحملات
     * بسرعة — عندك الآن حملتان «مدير موارد بشرية» وثلاث «أخصائي موارد بشرية عام»،
     * وهذا قبل أن يصير الإنشاء بنقرة.
     *
     * والمعايير المُرسَلة هي ما يملكه البحث فعلاً. فحصتُ حملةً عاملة: من أربعة
     * عشر معياراً، ستّة تُشتقّ من الدور آليّاً واثنان (الموقع وسنوات الخبرة) في
     * البحث أصلاً. والمخطّطة تُبنى على الدور المطابَق بالكتالوج — وكلّ حملاتك
     * بـ٧–٨ معايير وبلا إعلان وظيفة حصلت على ١٠ كفاءات.
     *
     * الناقص (المجال، التعليم، المهارات، اللغات) لا يمسّ مخطّطة الفيديو، لكنّه
     * يمسّ فرز المرحلة الأولى لو استُعملت الحملة له لاحقاً.
     */
    /**
     * زرٌّ واحد: يستعمل وظيفةً بدورك إن وُجدت، ويُنشئها إن لم توجد.
     *
     * ⚠️ إعادة الاستعمال ليست تفصيلاً تقنيّاً. بلا هذا الشرط، كلّ بحثٍ يُنشئ
     * حملةً جديدة: في هذه المؤسّسة **حملتان** بـ«HR Manager» و**ثلاث** بـ
     * «HR Generalist» قبل أن يصير الإنشاء بنقرة. والتكرار يكلّف ثلاثة أشياء —
     * توليد مخطّطة كامل لكلّ نسخة، وانتظار ٦٠–١٣٠ ثانية لأوّل مرشّح فيها، وتشتّت
     * مرشّحي الدور الواحد على حملاتٍ متعدّدة فتنقسم شاشات المقارنة.
     */
    const createOrReuse = async () => {
        const role = String(searchRole || '').trim();
        if (!role || creating) return;
        setCreating(true);
        setCreateError('');
        try {
            // موجودة سلفاً؟ تُستعمل — فورية، ومخطّطتها جاهزة.
            const existing = (rows || []).find((r) => normalizeRole(r.title) === normalizeRole(role));
            if (existing) {
                onPick(existing);
                return;
            }
            const payload = {
                position: role,
                interviewType: 'video',
                templateType: 'video',
            };
            const loc = String(searchContext?.location || '').trim();
            if (loc) payload.location = loc;
            const yrs = String(searchContext?.yearsExperience || '').trim();
            if (yrs) payload.experienceYears = yrs;

            const result = await apiClient.post('/api/recruitment-campaigns', payload);
            if (!result?.success || !result?.campaignId) {
                setCreateError(t('aiHeadHunterCampaignPickerCreateFailed'));
                return;
            }
            /*
             * تُختار فوراً. ولغتها فارغة عن قصد: المخطّطة لم تُقفل بعد (٦٠–١٣٠
             * ثانية)، فيُحذف مُعامل اللغة من الرابط بدل اختراع واحدة.
             */
            onPick({ campaignId: result.campaignId, title: role, language: '' });
        } catch {
            setCreateError(t('aiHeadHunterCampaignPickerCreateFailed'));
        } finally {
            setCreating(false);
        }
    };

    const canCreateFromSearch = Boolean(wantedRole);
    /*
     * 🔴 **زرٌّ واحد يقول «أنشئ وظيفة»، لا اثنان.**
     *
     * كان أسفل المُنتقي رابطٌ نصّه «أنشئ وظيفة» يفتح شاشة الإنشاء الكاملة، بينما
     * الزرّ الحقيقي أعلاه نصُّه جملةٌ طويلة. فالمستخدم الباحث عن زرٍّ بهذا الاسم
     * يجد الرابط — ويُنقل إلى صفحةٍ أخرى بدل أن تُنشأ حملته. حدث ذلك مرّتين،
     * والتشخيص جاء من المستخدم نفسه: «ربما لأنّ الاسم متطابق».
     *
     * فالمسار الكامل (بمعاييره وإعلان وظيفته) يبقى — لكن داخل اللوحة المطويّة
     * وحدها، حيث الاختيار اليدوي أصلاً، وبنصٍّ لا يلتبس بالزرّ الرئيسي. وحين لا
     * يوجد دور بحث فلا زرّ رئيسي أصلاً، فيظهر كالمخرج الوحيد.
     */
    const showAdvanced = !canCreateFromSearch || browsing;

    return (
        <div className="headhunter-campaign-picker">
            <div className="headhunter-campaign-picker__head">
                <h3>{t('aiHeadHunterCampaignPickerTitle')}</h3>
                <p>{t('aiHeadHunterCampaignPickerHint')}</p>
            </div>

            {canCreateFromSearch ? (
                <>
                    <button
                        type="button"
                        className="headhunter-campaign-picker__create-row"
                        onClick={createOrReuse}
                        disabled={creating || rows === null}
                    >
                        <span className="headhunter-campaign-picker__create-role">
                            {localizeCatalogLabel(searchRole, currentLang) || searchRole}
                        </span>
                        <span className="headhunter-campaign-picker__create-hint">
                            {creating
                                ? t('aiHeadHunterCampaignPickerCreating')
                                : matchedExisting
                                  ? t('aiHeadHunterCampaignPickerUseExisting')
                                  : t('aiHeadHunterCampaignPickerCreateFromSearch')}
                        </span>
                    </button>
                    {createError ? (
                        <p className="headhunter-campaign-picker__state">{createError}</p>
                    ) : null}
                    {/*
                      * مخرجٌ لا واجهة: الزرّ أعلاه هو المسار، لكنّ دوراً مكتوباً
                      * بصيغةٍ مختلفة عن وظيفتك («Account Manager» مقابل
                      * «Key Account Manager») لن يُطابَق، فتُنشأ نسخة. هذا
                      * السطر يسمح بالاختيار اليدوي وقتها.
                      *
                      * 🔴 وكان **سطراً مسطَّراً بلا حشو** (`__toggle`): هدفٌ
                      * بارتفاع سطر واحد، ومحاذاته يساراً بينما «إلغاء» يميناً،
                      * فيُقرأ بقيّةَ نصٍّ لا خياراً. صار بطاقةً بشكل
                      * `__create-row` نفسه لكن **مفرَّغة** — الممتلئ هو المقترح
                      * والمفرَّغ هو البديل، فالهرميّة بصريّة بلا كلمة «instead».
                      * ⚠️ و`__toggle` يبقى كما هو: يستعمله «أظهر كلّ الوظائف».
                      */}
                    <button
                        type="button"
                        className={`headhunter-campaign-picker__browse${browsing ? ' is-open' : ''}`}
                        onClick={() => setBrowsing((v) => !v)}
                        aria-expanded={browsing}
                    >
                        <svg
                            className="headhunter-campaign-picker__browse-icon"
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            aria-hidden
                        >
                            <path
                                fill="currentColor"
                                d="M20 6h-4V4c0-1.11-.89-2-2-2h-4c-1.11 0-2 .89-2 2v2H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-6 0h-4V4h4v2z"
                            />
                        </svg>
                        <span className="headhunter-campaign-picker__browse-text">
                            <span className="headhunter-campaign-picker__browse-title">
                                {browsing
                                    ? t('aiHeadHunterCampaignPickerHideList')
                                    : t('aiHeadHunterCampaignPickerBrowse')}
                            </span>
                            {/*
                              * العدد يُطمئن قبل النقر: من لا يعرف أنّ عنده
                              * وظائف لن يفتح القائمة. و`rows === null` تعني
                              * «لم تصل بعد» لا «صفر» — فلا يُطبع رقمٌ كاذب.
                              */}
                            {rows === null ? null : (
                                <span className="headhunter-campaign-picker__browse-count">
                                    {String(t('aiHeadHunterCampaignPickerBrowseCount')).replace(
                                        '{count}',
                                        String(rows.length)
                                    )}
                                </span>
                            )}
                        </span>
                        <svg
                            className="headhunter-campaign-picker__browse-chevron"
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            aria-hidden
                        >
                            <path fill="currentColor" d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z" />
                        </svg>
                    </button>
                </>
            ) : null}

            {canCreateFromSearch && !browsing ? null : rows === null ? (
                <p className="headhunter-campaign-picker__state">{t('aiHeadHunterCampaignPickerLoading')}</p>
            ) : rows.length === 0 ? (
                <p className="headhunter-campaign-picker__state">
                    {error || t('aiHeadHunterCampaignPickerEmpty')}
                </p>
            ) : (
                <>
                    <input
                        type="search"
                        className="headhunter-campaign-picker__search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={t('aiHeadHunterCampaignPickerSearch')}
                        aria-label={t('aiHeadHunterCampaignPickerSearch')}
                    />
                    {filtered.length === 0 ? (
                        <p className="headhunter-campaign-picker__state">
                            {t('aiHeadHunterCampaignPickerNoMatch')}
                        </p>
                    ) : null}
                    <ul className="headhunter-campaign-history-list headhunter-campaign-picker__list">
                        {filtered.map((r) => (
                            <li key={r.campaignId}>
                                <button
                                    type="button"
                                    className="headhunter-campaign-history-row"
                                    onClick={() => onPick(r)}
                                >
                                    <span className="headhunter-campaign-history-row__title">
                                        {localizeCatalogLabel(r.title, currentLang) ||
                                            r.title ||
                                            t('aiHeadHunterCampaignPickerUntitled')}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                    {wantedRole && hiddenCount > 0 ? (
                        <button
                            type="button"
                            className="headhunter-campaign-picker__toggle"
                            onClick={() => setShowAll((v) => !v)}
                        >
                            {showAll
                                ? t('aiHeadHunterCampaignPickerOnlyMatching')
                                : `${t('aiHeadHunterCampaignPickerShowAll')} (${hiddenCount})`}
                        </button>
                    ) : null}
                </>
            )}

            <div className="headhunter-campaign-picker__foot">
                {/*
                  * 🔴 عرضٌ شرطي، لا سِمة `hidden`.
                  *
                  * كان هذان الزرّان يحملان `hidden` — وهي **بلا أثر هنا**: قاعدة
                  * `.headhunter-campaign-picker__foot .btn` تفرض
                  * `display: inline-flex`، وأنماط المؤلِّف تغلب `[hidden]` في
                  * صحيفة المتصفّح. فبقي «تحديث القائمة» ظاهراً في كلّ الحالات
                  * رغم أنّ الشرط كان مكتوباً وصحيحاً. ما لا يُعرَض لا يُخفى
                  * بسِمة، بل لا يُركَّب أصلاً.
                  */}
                {showAdvanced ? (
                    <button
                        type="button"
                        className="btn btn-tertiary"
                        onClick={load}
                        disabled={refreshing}
                    >
                        {refreshing
                            ? t('aiHeadHunterCampaignPickerLoading')
                            : t('aiHeadHunterCampaignPickerRefresh')}
                    </button>
                ) : null}
                {/*
                  * ⚠️ الوجهة `/dashboard?open=newCampaign` — رابطٌ عميق قائم يفتح
                  * NewInterviewSidebar (Dashboard.jsx:215). و**ليست `/?open=…`**:
                  * المسار `/` هو صفحة `Home` التسويقية، لا اللوحة — أُثبت حيّاً
                  * على الإنتاج، فهبط الزرّ على صفحة «Get Started Free». وليست
                  * `/video-interview`: ذلك المسار يُحوَّل إلى `/video-evaluation`
                  * الذي يعرض **قائمة تقييمات سابقة** ولا يحوي شريط الإنشاء
                  * إطلاقاً — زرٌّ يقول «أنشئ» ويأخذك حيث لا إنشاء.
                  *
                  * وتبويبة جديدة عن قصد: التنقّل الكامل يُفقد نتائج البحث الحيّ
                  * (لا تُحفظ إلا في سجلّ البحث) ويُفقد اختيار المستخدم هنا. فبدل
                  * إصلاح رحلة العودة، لا نغادر أصلاً.
                  *
                  * ولا تُنشأ حملة من داخل هذا المكوّن: حملةٌ باسم وظيفة فقط
                  * تعني معايير شبه فارغة، و`ensureBlueprintForCampaign` ينطلق
                  * عليها فوراً فيُنتج مخطّطة ضعيفة.
                  */}
                {showAdvanced ? (
                    <a
                        className="btn btn-secondary"
                        /* الدور يسافر مع الرابط، فتُفتح شاشة الإنشاء عليه مباشرة بدل
                           أن يُعاد كتابته بيد الموظّف. */
                        href={`/dashboard?open=newCampaign${
                            searchRole ? `&position=${encodeURIComponent(String(searchRole).trim())}` : ''
                        }`}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        {t('aiHeadHunterCampaignPickerCreate')}
                    </a>
                ) : null}
                <button type="button" className="btn btn-tertiary" onClick={onClose}>
                    {t('aiHeadHunterCampaignPickerCancel')}
                </button>
            </div>
        </div>
    );
}
