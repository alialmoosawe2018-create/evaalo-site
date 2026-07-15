import React from 'react';
import { fillI18nTemplate } from '../../utils/i18nTemplate.js';
import {
    candidateMetaLocation,
    firstTimelineSnippet,
    sortBilingualLinesLatinFirst,
    sortExperienceTimelineDescending,
    splitBilingualDisplayLines,
    truncateSnippet,
} from '../../utils/headhunterCandidateBrief.js';

/**
 * أسطر شركة/موقع بخلط العربي واللاتيني — يمكن تمرير صنف تعديل فصل الأسطر للبطاقة أو اللوحة.
 *
 * @param {{ className: string; text: string; splitClassName?: string }} props
 */
function BilingualParagraph({ className, text, splitClassName = ' headhunter-main-brief__card-text--split' }) {
    const trimmed = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
    const split = splitBilingualDisplayLines(trimmed);
    const parts = split ? sortBilingualLinesLatinFirst(split) : null;
    const splitMod = parts ? splitClassName : '';
    return (
        <p className={`${className}${splitMod}`} dir="auto">
            {parts ? (
                parts.map((segment, idx) => (
                    <span key={idx} className="headhunter-main-brief__card-script-line" dir="auto">
                        {segment}
                    </span>
                ))
            ) : (
                trimmed
            )}
        </p>
    );
}

/**
 * @param {{ className: string; text: string }} props
 */
function HeadHunterCardStackLine({ className, text }) {
    return <BilingualParagraph className={className} text={text} />;
}

/**
 * عنوان LinkedIn لوحة الانزلاق: المسمّى منفصل، ثم شركة بترتيب EN ثم AR عند وجود الكتابتين.
 *
 * @param {{ headlineRoleParsed: string; headlineCompanyParsed: string; fallbackLine: string }} props
 */
function LinkedInPrimaryTaglineBlocks({
    headlineRoleParsed,
    headlineCompanyParsed,
    fallbackLine,
}) {
    const fb = typeof fallbackLine === 'string' ? fallbackLine.replace(/\s+/g, ' ').trim() : '';
    const companyTrim = headlineCompanyParsed.trim();
    const roleTrim = headlineRoleParsed.trim();
    if (!fb) return null;
    if (!companyTrim) {
        return (
            <p className="headhunter-main-brief__tagline headhunter-main-brief__tagline--linkedin-primary" dir="auto">
                {fb}
            </p>
        );
    }
    if (!roleTrim) {
        return (
            <BilingualParagraph
                className="headhunter-main-brief__tagline headhunter-main-brief__tagline--linkedin-primary"
                text={companyTrim}
                splitClassName=" headhunter-main-brief__linkedin-lines--split"
            />
        );
    }
    return (
        <>
            <p className="headhunter-main-brief__tagline headhunter-main-brief__tagline--role" dir="auto">
                {roleTrim}
            </p>
            <BilingualParagraph
                className="headhunter-main-brief__tagline headhunter-main-brief__tagline--org"
                text={companyTrim}
                splitClassName=" headhunter-main-brief__linkedin-lines--split"
            />
        </>
    );
}

/**
 * @typedef {import('../../utils/headHunterNormalize.js').HeadHunterCandidate} HeadHunterCandidate
 */

/**
 * تقسيم "المسمى at الشركة" / "المسمى في الشركة".
 *
 * @param {string} headline
 * @returns {{ title: string; company: string }}
 */
function splitHeadlineRoleCompany(headline) {
    if (!headline || typeof headline !== 'string') return { title: '', company: '' };
    const h = headline.replace(/\s+/g, ' ').trim();
    const atEn = /\s+at\s+/i.exec(h);
    if (atEn) {
        return {
            title: h.slice(0, atEn.index).trim(),
            company: h.slice(atEn.index + atEn[0].length).trim(),
        };
    }
    const atAr = /\s+في\s+/.exec(h);
    if (atAr) {
        return {
            title: h.slice(0, atAr.index).trim(),
            company: h.slice(atAr.index + atAr[0].length).trim(),
        };
    }
    return { title: h, company: '' };
}

/**
 * @param {string} snippet
 * @param {string} role
 * @param {string} org
 */
function stripTenureRoleCompanyPrefix(snippet, role, org) {
    if (!snippet) return '';
    let s = snippet.replace(/\s+/g, ' ').trim();
    const r = (role || '').replace(/\s+/g, ' ').trim();
    const o = (org || '').replace(/\s+/g, ' ').trim();
    if (!r || r === '—') return s;
    const combined = o ? `${r} · ${o}` : r;
    if (s.toLowerCase().startsWith(combined.toLowerCase())) {
        const rest = s.slice(combined.length).replace(/^[·\s—:\-]+/, '').trim();
        return rest || s;
    }
    return s;
}

/**
 * ملخّص اللوحة: إن بدأ بتكرار المسمّى الظاهر كسطر عنوان، يُزيل التكرار.
 *
 * @param {string} summaryText
 * @param {string} headlineRoleParsed
 */
function stripSummaryLeadingDuplicateRole(summaryText, headlineRoleParsed) {
    const summary = typeof summaryText === 'string' ? summaryText.replace(/\s+/g, ' ').trim() : '';
    const role =
        typeof headlineRoleParsed === 'string' ? headlineRoleParsed.replace(/\s+/g, ' ').trim() : '';
    if (!summary || !role || summary.length <= role.length) return summaryText;
    if (!summary.toLowerCase().startsWith(role.toLowerCase())) return summaryText;
    const cleaned = summary
        .slice(role.length)
        .replace(/^[\s\-–—:·.,؛،]+/, '')
        .trim();
    return cleaned.length >= 8 ? cleaned : summaryText;
}

/**
 * عمود الاسم والموقع ومقتطف التجربة والمهارات.
 *
 * @param {'default' | 'card' | 'card-linkedin'} [props.variant]
 *   — `card`: بطاقة نتائج / صفحة سجل البحث — صف صورة واسم بمحاذاة عمودية، ثم card-stack أسفله.
 *   — `card-linkedin`: لوحة انزلاق — ترويسة LinkedIn (صف صورة+اسم متوسّط، ثم فاصل والتفاصيل بعرض العمود).
 */
export default function HeadHunterCandidateMainBrief({
    candidate,
    t,
    nameId,
    showPhoto,
    onPhotoError,
    tenureTruncate = 112,
    showSkills = true,
    variant = 'default',
}) {
    const skillsLine = showSkills ? (candidate.skills || []).slice(0, 5).join(' · ') : '';
    const yr = candidate.years_experience;
    const yearsLabel =
        yr != null && Number.isFinite(yr)
            ? fillI18nTemplate(t('aiHeadHunterYearsExperienceN'), { n: Math.round(yr) })
            : '';

    const metaLoc = candidateMetaLocation(candidate);
    const metaLocation = metaLoc || '—';

    const sortedTimeline = sortExperienceTimelineDescending(candidate.experience_timeline || []);
    const rawTimelineSorted = firstTimelineSnippet(sortedTimeline[0]);

    /** بطاقات النتائج: استخدم أقدم المنطق (أول عنصر من المصدر بدون فرز فرز قائمة النتائج) */
    const rawTimelineFirst = firstTimelineSnippet(candidate.experience_timeline?.[0]);

    if (variant === 'card-linkedin') {
        const headlineLine = (typeof candidate.headline === 'string' ? candidate.headline : '').trim();
        const ct = typeof candidate.current_title === 'string' ? candidate.current_title.trim() : '';
        const summaryRaw = (typeof candidate.summary === 'string' ? candidate.summary : '').trim();
        const aiBio = (typeof candidate.ai_summary === 'string' ? candidate.ai_summary : '').trim();
        /** إن وُجد الملخص فقط في حقل مختصر من المصدر لا يُقصَّر هنا؛ ندمج المصدرَين بحسب التوفر */
        const summaryLine = summaryRaw || aiBio;
        const taglinePrimary = (headlineLine || ct).trim();
        const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
        const { title: headlineRoleParsed, company: headlineCompanyParsed } =
            splitHeadlineRoleCompany(taglinePrimary);

        const headlineParsedCompanyNorm = headlineCompanyParsed.trim()
            ? norm(headlineCompanyParsed)
            : '';
        const headlineHadRoleCompanySep = headlineCompanyParsed.trim().length > 0;
        let summaryAdjusted = summaryLine;
        if (headlineHadRoleCompanySep && headlineRoleParsed.trim()) {
            summaryAdjusted = stripSummaryLeadingDuplicateRole(summaryLine, headlineRoleParsed.trim());
        }
        const summaryAdjustedNorm = summaryAdjusted.replace(/\s+/g, ' ').trim();

        const showSummaryLine =
            Boolean(summaryLine.trim()) &&
            norm(summaryLine) !== norm(taglinePrimary) &&
            Boolean(summaryAdjustedNorm);

        const cc = typeof candidate.current_company === 'string' ? candidate.current_company.trim() : '';
        const showCompanyEduLine =
            Boolean(cc) &&
            !(
                headlineParsedCompanyNorm &&
                norm(cc) === headlineParsedCompanyNorm
            );

        const e0 = sortedTimeline[0];
        const stripRole = e0?.title?.trim() || ct || '';
        const stripOrg = e0?.company?.trim() || cc || '';
        const snapped = truncateSnippet(rawTimelineSorted || '', tenureTruncate);
        let tenureLine = '';
        if (snapped && stripRole) {
            const combined = stripOrg ? `${stripRole} · ${stripOrg}` : stripRole;
            const s = snapped.replace(/\s+/g, ' ').trim();
            if (s.toLowerCase().startsWith(combined.toLowerCase())) {
                tenureLine = s.slice(combined.length).replace(/^[·\s—:\-]+/, '').trim() || '';
            } else {
                tenureLine = snapped;
            }
        } else if (snapped) {
            tenureLine = snapped;
        }

        return (
            <div className="headhunter-main-brief headhunter-main-brief--card headhunter-main-brief--card-linkedin">
                <div className="headhunter-main-brief__row headhunter-main-brief__row--hero">
                    <div className="headhunter-main-brief__avatar-wrap">
                        {showPhoto ? (
                            <img
                                src={candidate.photo_url}
                                alt=""
                                className="headhunter-main-brief__avatar headhunter-main-brief__avatar--round"
                                loading="lazy"
                                decoding="async"
                                referrerPolicy="no-referrer"
                                onError={onPhotoError}
                            />
                        ) : (
                            <div
                                className="headhunter-main-brief__avatar headhunter-main-brief__avatar--placeholder headhunter-main-brief__avatar--round"
                                aria-hidden
                            />
                        )}
                    </div>
                    <div className="headhunter-main-brief__name-heading">
                        <h3 className="headhunter-main-brief__name" id={nameId}>
                            {candidate.full_name || t('aiHeadHunterUnknownName')}
                        </h3>
                    </div>
                </div>
                <div className="headhunter-main-brief__name-rule" aria-hidden />
                <div className="headhunter-main-brief__linkedin-stack">
                    {taglinePrimary ? (
                        <LinkedInPrimaryTaglineBlocks
                            headlineRoleParsed={headlineRoleParsed}
                            headlineCompanyParsed={headlineCompanyParsed}
                            fallbackLine={taglinePrimary}
                        />
                    ) : null}
                    {showSummaryLine ? (
                        <p className="headhunter-main-brief__tagline-sub headhunter-main-brief__tagline-sub--panel" dir="auto">
                            {summaryAdjusted}
                        </p>
                    ) : null}
                    {showCompanyEduLine ? (
                        <BilingualParagraph
                            className="headhunter-main-brief__company-edu"
                            text={cc}
                            splitClassName=" headhunter-main-brief__linkedin-lines--split"
                        />
                    ) : null}
                    <BilingualParagraph
                        className="headhunter-main-brief__meta headhunter-main-brief__card-loc"
                        text={metaLocation}
                        splitClassName=" headhunter-main-brief__linkedin-lines--split"
                    />
                    {tenureLine ? (
                        <p className="headhunter-main-brief__tenure headhunter-main-brief__card-tenure" dir="auto">
                            {tenureLine}
                        </p>
                    ) : null}
                    {yearsLabel ? (
                        <p className="headhunter-main-brief__years headhunter-main-brief__card-years">
                            {yearsLabel}
                        </p>
                    ) : null}
                </div>
            </div>
        );
    }

    if (variant === 'card') {
        const hl = (candidate.headline || '').trim();
        const { title: ht, company: hc } = splitHeadlineRoleCompany(hl);
        const ct = (candidate.current_title || '').trim();
        const cc = (candidate.current_company || '').trim();
        let role = ct || ht;
        let org = cc || hc;
        if (!role && hl) role = hl;
        if ((!role || role === '—') && cc && !hl && !ht) role = cc;
        if (!role) role = '—';
        const showOrg =
            Boolean(org.trim()) && org.trim().toLowerCase() !== role.trim().toLowerCase();
        const snapped = truncateSnippet(rawTimelineFirst || '', tenureTruncate);
        const e0 = candidate.experience_timeline?.[0];
        const tlTitle = typeof e0?.title === 'string' ? e0.title.trim() : '';
        const tlCo = typeof e0?.company === 'string' ? e0.company.trim() : '';
        const stripRole = tlTitle || ct || ht || (role !== '—' ? role : '');
        const stripOrg = tlCo || cc || hc || '';
        let tenureLine = stripTenureRoleCompanyPrefix(snapped, stripRole, stripOrg || '');
        if (tenureLine === snapped && stripOrg) {
            tenureLine = stripTenureRoleCompanyPrefix(snapped, stripRole, '');
        }

        return (
            <div className="headhunter-main-brief headhunter-main-brief--card headhunter-main-brief--card-compact">
                <div className="headhunter-main-brief__row headhunter-main-brief__row--hero">
                    <div className="headhunter-main-brief__avatar-wrap">
                        {showPhoto ? (
                            <img
                                src={candidate.photo_url}
                                alt=""
                                className="headhunter-main-brief__avatar headhunter-main-brief__avatar--round"
                                loading="lazy"
                                decoding="async"
                                referrerPolicy="no-referrer"
                                onError={onPhotoError}
                            />
                        ) : (
                            <div
                                className="headhunter-main-brief__avatar headhunter-main-brief__avatar--placeholder headhunter-main-brief__avatar--round"
                                aria-hidden
                            />
                        )}
                    </div>
                    <div className="headhunter-main-brief__name-heading">
                        <h3 className="headhunter-main-brief__name" id={nameId}>
                            {candidate.full_name || t('aiHeadHunterUnknownName')}
                        </h3>
                    </div>
                </div>
                <div className="headhunter-main-brief__card-stack">
                    <p className="headhunter-main-brief__card-role" dir="auto">
                        {role}
                    </p>
                    {showOrg ? (
                        <HeadHunterCardStackLine className="headhunter-main-brief__card-org" text={org} />
                    ) : null}
                    <HeadHunterCardStackLine className="headhunter-main-brief__meta headhunter-main-brief__card-loc" text={metaLocation} />
                    {tenureLine ? (
                        <p className="headhunter-main-brief__tenure headhunter-main-brief__card-tenure" dir="auto">
                            {tenureLine}
                        </p>
                    ) : null}
                    {yearsLabel ? (
                        <p className="headhunter-main-brief__years headhunter-main-brief__card-years">
                            {yearsLabel}
                        </p>
                    ) : null}
                </div>
            </div>
        );
    }

    const timelineSnippet = truncateSnippet(rawTimelineSorted || '', tenureTruncate);

    return (
        <div className="headhunter-main-brief">
            <div className="headhunter-main-brief__row">
                <div className="headhunter-main-brief__avatar-wrap">
                    {showPhoto ? (
                        <img
                            src={candidate.photo_url}
                            alt=""
                            className="headhunter-main-brief__avatar"
                            loading="lazy"
                            decoding="async"
                            referrerPolicy="no-referrer"
                            onError={onPhotoError}
                        />
                    ) : (
                        <div
                            className="headhunter-main-brief__avatar headhunter-main-brief__avatar--placeholder"
                            aria-hidden
                        />
                    )}
                </div>
                <div className="headhunter-main-brief__text">
                    <h3 className="headhunter-main-brief__name" id={nameId}>
                        {candidate.full_name || t('aiHeadHunterUnknownName')}
                    </h3>
                    <p className="headhunter-main-brief__headline">
                        {candidate.headline || candidate.current_title || '—'}
                    </p>
                    <p className="headhunter-main-brief__meta">{metaLocation}</p>
                </div>
            </div>
            {timelineSnippet ? <p className="headhunter-main-brief__tenure">{timelineSnippet}</p> : null}
            {candidate.current_company ? (
                <p className="headhunter-main-brief__company">{candidate.current_company}</p>
            ) : null}
            {showSkills && skillsLine ? <p className="headhunter-main-brief__skills">{skillsLine}</p> : null}
            {yearsLabel ? <p className="headhunter-main-brief__years">{yearsLabel}</p> : null}
        </div>
    );
}
