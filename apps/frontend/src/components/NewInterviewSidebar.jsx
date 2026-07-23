import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInterviewTemplate } from '../contexts/InterviewTemplateContext';
import {
    buildPresetCriteriaPayload,
    buildScreeningCampaignCreateBody,
    buildCampaignFormShareUrl,
    countFilledCustomRubricItems,
    formatCampaignCreateError,
    resolvePublicFormUrlFromCampaignResponse,
    DEFAULT_SCREENING_FORM_TEMPLATE_ID,
} from '../utils/screeningCampaignPayload.js';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import PositionSuggestCombobox from './PositionSuggestCombobox.jsx';
import CareerLevelSelect from './CareerLevelSelect.jsx';
import {
    composeRoleResolution,
    fromJobLevelUiValue,
    getRepresentativeEntry,
    resolveJobRole,
    toJobLevelUiValue,
} from '@evaalo/job-catalog';
import JobRoleFields from './JobRoleFields.jsx';
import { applyRoleResolutionToState } from '../utils/jobCatalogRole.js';
import { IRAQI_GOVERNORATES } from '../constants/iraqiGovernorates.js';
import { LANGUAGE_SUGGESTIONS } from '../constants/languageSuggestions.js';
import { KEY_SKILL_SUGGESTIONS } from '../constants/keySkillSuggestions.js';
import { HIGHEST_EDUCATION_OPTIONS } from '../constants/educationLevelOptions.js';
import { YEARS_OF_EXPERIENCE_OPTIONS } from '../constants/yearsOfExperienceOptions.js';
import { AGE_RANGE_OPTIONS } from '../constants/ageRangeOptions.js';
import { GENDER_OPTIONS } from '../constants/genderOptions.js';
import { CAMPAIGN_READY_OPTIONS } from '../constants/campaignReadyOptions.js';
import { AVAILABLE_CRITERIA_AUDIO } from '../constants/audioJobCriteria.js';
import governorateLabelsAr from '../constants/governorateLabels.ar.json';
import governorateLabelsKu from '../constants/governorateLabels.ku.json';
import comboLanguageLabelsAr from '../constants/comboLanguageLabels.ar.json';
import comboLanguageLabelsKu from '../constants/comboLanguageLabels.ku.json';
import comboSkillLabelsAr from '../constants/comboSkillLabels.ar.json';
import comboSkillLabelsKu from '../constants/comboSkillLabels.ku.json';
import NiCampaignOptionRow from './NiCampaignOptionRow.jsx';
import { absoluteAppUrl } from '../config/apiBase.js';
import { buildCandidateInterviewQuery } from '../utils/interviewShareLink.js';
import apiClient, { ApiError } from '../services/apiClient';
import { fillI18nTemplate } from '../utils/i18nTemplate.js';
import '../design-styles.css';

/** Stable reference — avoids recreating the list on every render; UI strings from `newCampaign_jc_*` via localizeScreeningCriterion */
const AVAILABLE_CRITERIA = [
    { id: 'position', label: 'Position', placeholder: 'Type or pick from list (▼)', type: 'text' },
    { id: 'location', label: 'Location', placeholder: 'Pick Iraqi governorate or type location (▼)', type: 'text' },
    { id: 'job', label: 'Job Level', placeholder: 'Enter job level', type: 'text' },
    { id: 'company', label: 'Company', placeholder: "If you're looking for candidates from a specific company", type: 'text' },
    { id: 'age', label: 'Age Range', placeholder: 'Pick range or type (e.g. 25-35) (▼)', type: 'text' },
    { id: 'gender', label: 'Gender', placeholder: 'MALE or FEMALE (▼)', type: 'text' },
    { id: 'educationLevel', label: 'Education Level', placeholder: 'Pick level or type (▼)', type: 'text' },
    { id: 'experienceYears', label: 'Experience Years', placeholder: 'Pick range or type (▼)', type: 'text' },
    { id: 'salaryMin', label: 'Salary Min', placeholder: 'Enter minimum salary', type: 'text' },
    { id: 'salaryMax', label: 'Salary Max', placeholder: 'Enter maximum salary', type: 'text' },
    { id: 'salaryCurrency', label: 'Salary Currency', placeholder: 'USD or IQD only', type: 'text' },
    { id: 'availability', label: 'Availability', placeholder: 'Enter availability (e.g., Full-time, Part-time)', type: 'text' },
    { id: 'skills', label: 'Required Skills', placeholder: 'Pick a skill or type your own (▼)', type: 'text' },
    { id: 'languages', label: 'Required Languages', placeholder: 'Pick languages or type (comma-separated) (▼)', type: 'text' },
    { id: 'certifications', label: 'Certifications', placeholder: 'Enter required certifications', type: 'text' }
];

/** تجميع معايير قائمة الإضافة — لعرض منظم بأقسام */
const CRITERION_MENU_GROUPS = [
    { id: 'role', labelKey: 'newCampaign_criterionGroupRole', ids: ['position', 'location', 'job', 'company'] },
    { id: 'requirements', labelKey: 'newCampaign_criterionGroupRequirements', ids: ['age', 'gender', 'educationLevel', 'experienceYears'] },
    { id: 'compensation', labelKey: 'newCampaign_criterionGroupCompensation', ids: ['salaryMin', 'salaryMax', 'salaryCurrency', 'availability'] },
    { id: 'skills', labelKey: 'newCampaign_criterionGroupSkills', ids: ['skills', 'languages', 'certifications'] },
];

function CriterionMenuIcon({ id }) {
    const common = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true };
    const stroke = { stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' };
    switch (id) {
        case 'position':
            return <svg {...common}><path {...stroke} d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/><path {...stroke} d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg>;
        case 'location':
            return <svg {...common}><path {...stroke} d="M12 21s7-4.5 7-11a7 7 0 10-14 0c0 6.5 7 11 7 11z"/><circle {...stroke} cx="12" cy="10" r="2.5"/></svg>;
        case 'job':
            return <svg {...common}><path {...stroke} d="M9 5H7a2 2 0 00-2 2v12h14V7a2 2 0 00-2-2h-2"/><rect {...stroke} x="9" y="3" width="6" height="4" rx="1"/></svg>;
        case 'company':
            return <svg {...common}><path {...stroke} d="M3 21h18"/><path {...stroke} d="M5 21V7l7-4 7 4v14"/><path {...stroke} d="M9 21v-6h6v6"/></svg>;
        case 'age':
            return <svg {...common}><rect {...stroke} x="3" y="4" width="18" height="18" rx="2"/><path {...stroke} d="M16 2v4M8 2v4M3 10h18"/></svg>;
        case 'gender':
            return <svg {...common}><circle {...stroke} cx="10" cy="8" r="3"/><path {...stroke} d="M6 21v-1a4 4 0 014-4h0"/><circle {...stroke} cx="17" cy="9" r="2.5"/><path {...stroke} d="M14 21v-1a3 3 0 013-3h0"/></svg>;
        case 'educationLevel':
            return <svg {...common}><path {...stroke} d="M22 10l-10-5L2 10l10 5 10-5z"/><path {...stroke} d="M6 12v5c0 1 3 3 6 3s6-2 6-3v-5"/></svg>;
        case 'experienceYears':
            return <svg {...common}><circle {...stroke} cx="12" cy="12" r="9"/><path {...stroke} d="M12 7v5l3 2"/></svg>;
        case 'salaryMin':
        case 'salaryMax':
        case 'salaryCurrency':
            return <svg {...common}><path {...stroke} d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H7"/></svg>;
        case 'availability':
            return <svg {...common}><path {...stroke} d="M9 11l3 3L22 4"/><path {...stroke} d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>;
        case 'skills':
            return <svg {...common}><path {...stroke} d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>;
        case 'languages':
            return <svg {...common}><circle {...stroke} cx="12" cy="12" r="9"/><path {...stroke} d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>;
        case 'certifications':
            return <svg {...common}><circle {...stroke} cx="12" cy="8" r="5"/><path {...stroke} d="M8.5 14.5L7 22l5-2.5L17 22l-1.5-7.5"/></svg>;
        case 'aiCompareTop':
            return <svg {...common}><path {...stroke} d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path {...stroke} d="M5 19l1 2M19 19l-1 2M3 15h2M19 15h2"/></svg>;
        default:
            return <svg {...common}><circle {...stroke} cx="12" cy="12" r="2"/><path {...stroke} d="M12 8v8M8 12h8"/></svg>;
    }
}

/** اللغات المدعومة لتوليد/ترجمة الإعلان */
const AD_LANGUAGES = [
    { id: 'English', label: 'English', dir: 'ltr', flag: 'EN', dataLang: 'en' },
    { id: 'Arabic', label: 'العربية', dir: 'rtl', flag: 'AR', dataLang: 'ar' },
    { id: 'Kurdish', label: 'کوردی', dir: 'rtl', flag: 'KU', dataLang: 'ku' }
];

const isRtlLanguage = (lang) => {
    const l = AD_LANGUAGES.find((x) => x.id === lang);
    return l ? l.dir === 'rtl' : false;
};

const JOB_AD_FONT_LATIN = 'Georgia, "Times New Roman", Times, serif';

/** إعلان الوظيفة: العربية/الكردية بخطوط محمّلة في index.html — لا تستخدم سيريف لاتيني لـ RTL */
function getJobAdFontFamily(langId) {
    if (langId === 'Arabic') {
        return "'Cairo', 'Noto Sans Arabic', 'Segoe UI', system-ui, sans-serif";
    }
    if (langId === 'Kurdish') {
        return "'Noto Sans Arabic', 'Cairo', 'Segoe UI', system-ui, sans-serif";
    }
    return JOB_AD_FONT_LATIN;
}

function getJobAdTypography(langId) {
    const rtl = isRtlLanguage(langId);
    return {
        fontFamily: getJobAdFontFamily(langId),
        fontSize: rtl ? '15px' : '14px',
        lineHeight: rtl ? 1.85 : 1.75,
    };
}

/** إزالة قسم «كيفية التقديم» — التقديم عبر المنصة فقط */
function stripHowToApplySection(text) {
    if (!text || typeof text !== 'string') return text;
    const labelRe =
        /^\s*(?:\*\*)?\s*(?:How to Apply|Application Instructions|How to apply|كيفية التقديم|طريقة التقديم|شێوازی پێشکەشکردن|چۆنیەتی پێشکەشکردن)\s*(?:\*\*)?\s*:?\s*$/iu;
    const lines = text.split('\n');
    const kept = [];
    let dropRest = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (
            labelRe.test(trimmed) ||
            /^\*\*(?:How to Apply|كيفية التقديم|طريقة التقديم)/iu.test(trimmed)
        ) {
            dropRest = true;
            continue;
        }
        if (!dropRest) kept.push(line);
    }
    return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** إزالة سياج ``` من مخرجات النموذج أو لصق المستخدم */
function sanitizeJobAdvertisementFences(text) {
    if (!text || typeof text !== 'string') return text;
    let t = text.trim();
    if (t.startsWith('```')) {
        const firstNl = t.indexOf('\n');
        t = firstNl === -1 ? '' : t.slice(firstNl + 1);
    }
    t = t.replace(/\n?```\s*$/g, '').trim();
    t = t.replace(/^\s*```[a-zA-Z]*\s*$/gm, '').trim();
    return stripHowToApplySection(t);
}

/** إزالة علامات markdown الخفيفة عند النسخ/المشاركة كنص مسطّح */
function stripJobAdMarkdownForShare(text) {
    if (!text || typeof text !== 'string') return '';
    let t = text.replace(/\*\*/g, '');
    t = t.replace(/_([^_\n]+)_/g, '$1');
    t = t.replace(/^[\s\u200f\u200e]*#{2,3}\s+/gm, '');
    return t;
}

function splitItalicParts(line, keyPrefix) {
    if (line == null || line === '') return [line];
    const parts = line.split(/(_[^_\n]+_)/g);
    return parts.map((part, idx) => {
        const mi = /^_(.+)_$/.exec(part);
        if (mi) {
            return (
                <em key={`${keyPrefix}-em-${idx}`} className="ni-job-ad-preview__em">
                    {mi[1]}
                </em>
            );
        }
        return <React.Fragment key={`${keyPrefix}-tx-${idx}`}>{part}</React.Fragment>;
    });
}

function renderPlainWithItalicChunks(text, keyPrefix) {
    const lines = text.split('\n');
    return lines.map((line, i) => (
        <React.Fragment key={`${keyPrefix}-il-${i}`}>
            {splitItalicParts(line, `${keyPrefix}-il-${i}`)}
            {i < lines.length - 1 ? '\n' : null}
        </React.Fragment>
    ));
}

/** سطر واحد: عناوين ## / ### ثم روابط ثم نقطية ثم Label: ثم مائل */
function renderMarkdownLine(line, lineKey, isFirstLine) {
    const h3 = /^([\s\u200f\u200e]*)### (.+)$/.exec(line);
    if (h3) {
        return (
            <h3
                key={lineKey}
                className={`ni-job-ad-preview__h3${isFirstLine ? ' ni-job-ad-preview__h3--first' : ''}`}
            >
                {splitItalicParts(h3[2], `${lineKey}-h3`)}
            </h3>
        );
    }
    const h2 = /^([\s\u200f\u200e]*)## (.+)$/.exec(line);
    if (h2) {
        return (
            <h2
                key={lineKey}
                className={`ni-job-ad-preview__h2${isFirstLine ? ' ni-job-ad-preview__h2--first' : ''}`}
            >
                {splitItalicParts(h2[2], `${lineKey}-h2`)}
            </h2>
        );
    }
        if (/https?:\/\//i.test(line)) {
            return (
            <p key={lineKey} className="ni-job-ad-preview__paragraph ni-job-ad-preview__link-line">
                {splitItalicParts(line, lineKey)}
            </p>
            );
        }
        const isBullet = /^[\s\u200f\u200e]*(?:[-*•]|\d+\.)\s/.test(line);
        const m =
            !isBullet &&
            line.length > 0 &&
            line.length < 500 &&
            /^([\s\u200f\u200e]*)([^:\n]{1,200}:\s*)(.*)$/.exec(line);
    if (isBullet) {
        const bulletContent = line.replace(/^[\s\u200f\u200e]*(?:[-*•]|\d+\.)\s/, '');
        return (
            <div key={lineKey} className="ni-job-ad-preview__bullet">
                {splitItalicParts(bulletContent, lineKey)}
            </div>
        );
    }
        if (m) {
            const label = m[2];
            if (label.trim().length >= 2 && label.trim().length <= 120) {
                return (
                <div key={lineKey} className="ni-job-ad-preview__field">
                    <strong className="ni-job-ad-preview__label">{splitItalicParts(label, `${lineKey}-lb`)}</strong>
                    <span className="ni-job-ad-preview__value">{splitItalicParts(m[3], `${lineKey}-c`)}</span>
                </div>
                );
            }
        }
        return (
        <p key={lineKey} className="ni-job-ad-preview__paragraph">
            {splitItalicParts(line, `${lineKey}-d`)}
        </p>
    );
}

function renderLinesWithMarkdown(fragment, keyPrefix) {
    const lines = fragment.split('\n');
    return lines.map((line, i) => {
        if (line === '') {
            return <div key={`${keyPrefix}-L${i}`} className="ni-job-ad-preview__spacer" aria-hidden />;
        }
        return renderMarkdownLine(line, `${keyPrefix}-L${i}`, i === 0);
    });
}

function renderBoldSplitPreview(cleaned) {
    const segments = cleaned.split(/(\*\*[\s\S]+?\*\*)/g);
    return segments.map((part, bi) => {
        const bm = /^\*\*([\s\S]+?)\*\*$/.exec(part);
        if (bm) {
            return (
                <strong key={`jb-${bi}`} className="ni-job-ad-preview__inline-strong">
                    {renderPlainWithItalicChunks(bm[1], `jb-${bi}`)}
                </strong>
            );
        }
        if (part === '') return null;
        return <React.Fragment key={`jp-${bi}`}>{renderLinesWithMarkdown(part, `jp-${bi}`)}</React.Fragment>;
    });
}

/**
 * معاينة الإعلان: **عريض**، _مائل_، أسطر ## / ###
 */
function renderJobAdvertisementPreview(text) {
    const cleaned = sanitizeJobAdvertisementFences(text);
    if (!cleaned) return null;
    return renderBoldSplitPreview(cleaned);
}

/** حاوية المودال — نفس أسلوب Learn More / ni-header (زجاج + حد سماوي) */
const NT = {
    shellBg: 'linear-gradient(180deg, rgba(30, 41, 59, 0.65) 0%, rgba(15, 23, 42, 0.72) 100%)',
    shellBorder: '2px solid rgba(56, 189, 248, 0.45)',
    shellShadow: '0 12px 40px rgba(0, 0, 0, 0.35), 0 0 36px rgba(56, 189, 248, 0.14)',
    itemBg: 'rgba(15, 23, 42, 0.92)',
    itemBgMuted: 'rgba(15, 23, 42, 0.72)',
    itemBorder: '1px solid rgba(34, 211, 238, 0.3)',
    itemBorderInactive: '1px solid rgba(255, 255, 255, 0.1)',
    itemShadow: '0 2px 8px rgba(34, 211, 238, 0.2)',
    title: '#ffffff',
    meta: '#94A3B8',
    inputText: '#E2E8F0',
    radius: '8px',
    radiusLg: '12px',
    /** Criteria grid — نفس أسلوب Learn More / ni-header (زجاج + حد سماوي) */
    criteriaLabel: '#F1F5F9',
    criteriaCardOn: 'rgba(56, 189, 248, 0.18)',
    criteriaCardOff: 'rgba(255, 255, 255, 0.08)',
    criteriaBorderOn: '2px solid rgba(56, 189, 248, 0.65)',
    criteriaBorderOff: '2px solid rgba(56, 189, 248, 0.4)',
    /** حقول المعايير — بدون backdrop-filter لتبقى خارج طبقة «الإشعاع» الزجاجية */
    criteriaInputBg: 'rgba(15, 23, 42, 0.96)',
    criteriaInputBgFocus: 'rgba(30, 41, 59, 1)',
};

function getCriteriaInputTokens(theme) {
    if (theme === 'light') {
        return {
            inputBg: '#ffffff',
            inputBgFocus: '#ffffff',
            inputText: '#0f172a',
            inputBorder: 'rgba(99, 102, 241, 0.22)',
            inputBorderFocus: 'rgba(99, 102, 241, 0.45)',
            inputFocusRing: '0 0 0 2px rgba(99, 102, 241, 0.12)',
            inputFontWeight: 600,
            sectionHint: '#475569',
        };
    }
    return {
        inputBg: 'rgba(2, 6, 23, 0.94)',
        inputBgFocus: 'rgba(15, 23, 42, 1)',
        inputText: '#f8fafc',
        inputBorder: 'rgba(56, 189, 248, 0.48)',
        inputBorderFocus: 'rgba(56, 189, 248, 0.72)',
        inputFocusRing: '0 0 0 2px rgba(56, 189, 248, 0.28)',
        inputFontWeight: 600,
        sectionHint: '#cbd5e1',
    };
}

function buildCriteriaInputStyle(tokens, hasError, overrides = {}) {
    return {
        width: '100%',
        padding: '10px 40px 10px 14px',
        background: tokens.inputBg,
        border: `1px solid ${hasError ? '#EF4444' : tokens.inputBorder}`,
        borderRadius: NT.radius,
        color: tokens.inputText,
        fontSize: '13px',
        fontWeight: tokens.inputFontWeight,
        outline: 'none',
        transition: 'all 0.3s ease',
        boxSizing: 'border-box',
        isolation: 'isolate',
        ...overrides,
    };
}

function buildCriteriaInputFocusHandlers(tokens, hasError) {
    return {
        onFocus: (e) => {
            e.currentTarget.style.borderColor = hasError ? '#EF4444' : tokens.inputBorderFocus;
            e.currentTarget.style.boxShadow = tokens.inputFocusRing;
            e.currentTarget.style.background = tokens.inputBgFocus;
        },
        onBlur: (e) => {
            e.currentTarget.style.borderColor = hasError ? '#EF4444' : tokens.inputBorder;
            e.currentTarget.style.boxShadow = 'none';
            e.currentTarget.style.background = tokens.inputBg;
        },
    };
}

function buildCriteriaComboboxProps(tokens, hasError) {
    return {
        inputStyle: buildCriteriaInputStyle(tokens, hasError),
        chevronStyle: {
            right: '12px',
            color: 'rgba(56, 189, 248, 0.9)',
        },
        ...buildCriteriaInputFocusHandlers(tokens, hasError),
    };
}

function buildCriteriaTextInputProps(tokens, hasError, overrides = {}) {
    return {
        style: buildCriteriaInputStyle(tokens, hasError, {
            padding: '10px 14px',
            ...overrides,
        }),
        ...buildCriteriaInputFocusHandlers(tokens, hasError),
    };
}

/** أيقونة النجوم/الشرارات — نفس Generate Ad */
function AiSparkIcon({ size = 22, className, style }) {
    return (
        <svg
            className={className}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden
            style={{ flexShrink: 0, display: 'block', color: 'inherit', ...style }}
        >
            <path
                fill="currentColor"
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
            />
        </svg>
    );
}

/** نفس أيقونة النموذج/الكتابة في Hero (hero-feature-item الأول — ورقة مع أسطر) */
function HeroJobAdFormIcon({ size = 22, className, style }) {
    return (
        <svg
            className={className}
            width={size}
            height={size}
            viewBox="0 0 64 64"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden
            style={{ flexShrink: 0, display: 'block', color: 'inherit', ...style }}
        >
            <rect x="12" y="8" width="40" height="48" rx="2" stroke="currentColor" strokeWidth="3.5" fill="none" strokeLinejoin="round"/>
            <line x1="20" y1="20" x2="44" y2="20" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"/>
            <line x1="20" y1="28" x2="44" y2="28" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"/>
            <line x1="20" y1="36" x2="36" y2="36" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"/>
            <line x1="20" y1="44" x2="40" y2="44" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"/>
        </svg>
    );
}

/** `start-process` → `startProcess` for `newCampaign_ready_${suffix}_title` keys */
function campaignReadyOptionKeySuffix(id) {
    return id.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
}

function localizeCampaignReadyOption(option, t) {
    const suf = campaignReadyOptionKeySuffix(option.id);
    return {
        ...option,
        title: t(`newCampaign_ready_${suf}_title`),
        description: t(`newCampaign_ready_${suf}_desc`),
    };
}

/** Job criteria (screening / start-process): labels + placeholders from `newCampaign_jc_*` */
function localizeScreeningCriterion(c, t) {
    return {
        ...c,
        label: t(`newCampaign_jc_${c.id}_label`),
        placeholder: t(`newCampaign_jc_${c.id}_ph`),
    };
}

/** Job criteria (audio/video candidate form): `newCampaign_ac_*` */
function localizeAudioCriterion(c, t) {
    return {
        ...c,
        label: t(`newCampaign_ac_${c.id}_label`),
        placeholder: t(`newCampaign_ac_${c.id}_ph`),
    };
}

/** `newCampaign_combo_*` keys for age / education / experience option values */
const NEW_CAMPAIGN_AGE_OPT_KEY = {
    '18-24': 'newCampaign_combo_age_18_24',
    '25-34': 'newCampaign_combo_age_25_34',
    '35-44': 'newCampaign_combo_age_35_44',
    '45-54': 'newCampaign_combo_age_45_54',
    '55-plus': 'newCampaign_combo_age_55_plus',
    any: 'newCampaign_combo_age_any',
};
const NEW_CAMPAIGN_EDU_OPT_KEY = {
    'high-school': 'newCampaign_combo_edu_high_school',
    bachelor: 'newCampaign_combo_edu_bachelor',
    master: 'newCampaign_combo_edu_master',
    phd: 'newCampaign_combo_edu_phd',
    other: 'newCampaign_combo_edu_other',
};
const NEW_CAMPAIGN_EXP_OPT_KEY = {
    '0-1': 'newCampaign_combo_exp_0_1',
    '2-3': 'newCampaign_combo_exp_2_3',
    '4-5': 'newCampaign_combo_exp_4_5',
    '6-10': 'newCampaign_combo_exp_6_10',
    '10+': 'newCampaign_combo_exp_10_plus',
};

const NewInterviewSidebar = ({ isOpen, onClose, onSelectOption }) => {
    const navigate = useNavigate();
    const { t, currentLang } = useLanguage();
    const { theme } = useTheme();
    const { selectedTemplate, selectedVideoTemplate, selectedAudioTemplate, getCurrentFormLink, getSelectedTemplateByType } = useInterviewTemplate();
    const [showLinkModal, setShowLinkModal] = useState(false);
    const [copiedLink, setCopiedLink] = useState(false);
    const [currentTemplateType, setCurrentTemplateType] = useState('process');
    /** false = شاشة Campaign Ready أولاً؛ true = صفحة المعايير (Job Criteria) */
    const [showJobDetailsForm, setShowJobDetailsForm] = useState(false);
    const [showFormLink, setShowFormLink] = useState(false);
    const [selectedInterviewType, setSelectedInterviewType] = useState(null);
    const [sendingToN8N, setSendingToN8N] = useState(false);
    const [sendSuccess, setSendSuccess] = useState(false);
    const [campaignId, setCampaignId] = useState(null);
    const [formLinkWithCampaign, setFormLinkWithCampaign] = useState(null);
    /** مسار الصوت: رابط `/interview?candidateId=` بعد إنشاء المرشح */
    const [voiceInterviewLinkWithCandidate, setVoiceInterviewLinkWithCandidate] = useState(null);
    /** مسار الفيديو (LiveKit): `/video-interview-call?candidateId=&campaignId=` */
    const [videoInterviewLinkWithCandidate, setVideoInterviewLinkWithCandidate] = useState(null);
    /**
     * تبويب مسار «Call AI agent»:
     *  - 'specific' (افتراضي): النموذج الحالي لمرشح محدد.
     *  - 'general': توليد رابط عام مشارَك بدون بيانات مرشح (/screening-call?mode=public).
     */
    const [audioFlowTab, setAudioFlowTab] = useState('specific');
    /**
     * تبويب مسار «Video with AI agent» (نفس فكرة الصوت):
     *  - 'specific' (افتراضي): النموذج الحالي لمرشح محدد (LiveKit).
     *  - 'general': توليد رابط فيديو عام مشارَك (/video-screening-call?mode=public).
     */
    const [videoFlowTab, setVideoFlowTab] = useState('specific');
    /** الوظيفة الاختيارية للرابط العام — تُمرَّر في query للبرومت */
    const [generalPosition, setGeneralPosition] = useState('');
    const [generatingPublicLink, setGeneratingPublicLink] = useState(false);
    /** الرابط العام بعد توليده */
    const [publicScreeningLink, setPublicScreeningLink] = useState(null);
    /** الوظيفة/الحملة المربوطة بالرابط العام الحالي — للتحقق قبل النسخ */
    const [publicLinkMeta, setPublicLinkMeta] = useState({ position: '', campaignId: '' });
    const [publicLinkCopied, setPublicLinkCopied] = useState(false);
    /**
     * Video flow mode toggle (visible only when selectedInterviewType === 'video').
     *  - false (default) ⇒ Phase-3 mode: show share-link screen, user opens manually.
     *  - true            ⇒ Direct mode: navigate to /video-interview-call immediately
     *                      after candidate creation. Same backend calls, same metadata.
     */

    // حالة المعايير المختارة
    const [selectedCriteria, setSelectedCriteria] = useState({});
    const [jobDetails, setJobDetails] = useState({});
    // ── CV auto-fill (Specific audio/video): رفع سيرة ذاتية → استخراج → تعبئة ──
    const cvFileInputRef = useRef(null);
    const [cvParsing, setCvParsing] = useState(false);
    const [cvParseError, setCvParseError] = useState('');
    const [cvFilledCount, setCvFilledCount] = useState(0);
    const [cvDetectedPosition, setCvDetectedPosition] = useState('');
    const [jobAdvertisement, setJobAdvertisement] = useState('');
    const [generatingAd, setGeneratingAd] = useState(false);
    const [isEditingJobAd, setIsEditingJobAd] = useState(false);
    /** اللغة المطلوبة قبل التوليد + لغة الإعلان الحالي */
    const [adLanguage, setAdLanguage] = useState('English');
    const [adCurrentLanguage, setAdCurrentLanguage] = useState('English');
    const [showAdLangMenu, setShowAdLangMenu] = useState(false);
    const jobAdTextareaRef = useRef(null);
    const adLangPickerRef = useRef(null);
    /** What to include when sharing or copying (at least one must stay on when both exist). */
    const [includeAdWhenSharing, setIncludeAdWhenSharing] = useState(true);
    const [includeLinkWhenSharing, setIncludeLinkWhenSharing] = useState(true);
    const [errors, setErrors] = useState({});
    /** صفوف منفصلة لمعيار Certifications (دمجها بـ "; " عند الإرسال) */
    const [certificationRows, setCertificationRows] = useState(['']);
    /** صفوف منفصلة لمعيار Required Skills (دمجها بـ "; " عند الإرسال) */
    const [skillRows, setSkillRows] = useState(['']);
    /** صفوف منفصلة لمعيار Required Languages (دمجها بـ "; " عند الإرسال) */
    const [languageRows, setLanguageRows] = useState(['']);
    /** صفوف منفصلة لإيميلات AI Compare Top Candidates */
    const [aiCompareEmailRows, setAiCompareEmailRows] = useState(['']);

    /** Screening فقط: المعايير المختارة بالترتيب + المعايير المخصّصة + حالة قائمة الإضافة */
    const [addedOrder, setAddedOrder] = useState([]);
    const [customCriteria, setCustomCriteria] = useState([]);
    const [addMenuOpen, setAddMenuOpen] = useState(false);
    const [addMenuCustomMode, setAddMenuCustomMode] = useState(false);
    const [customLabelDraft, setCustomLabelDraft] = useState('');
    const isScreeningFlow = selectedInterviewType === 'form';

    const governorateSuggestionOptions = useMemo(() => {
        const catalog =
            currentLang === 'ar' ? governorateLabelsAr : currentLang === 'ku' ? governorateLabelsKu : null;
        return IRAQI_GOVERNORATES.map((en) => ({ value: en, label: catalog?.[en] ?? en }));
    }, [currentLang]);

    const skillSuggestionOptions = useMemo(() => {
        const catalog =
            currentLang === 'ar' ? comboSkillLabelsAr : currentLang === 'ku' ? comboSkillLabelsKu : null;
        return KEY_SKILL_SUGGESTIONS.map((en) => ({ value: en, label: catalog?.[en] ?? en }));
    }, [currentLang]);

    const languageSuggestionOptions = useMemo(() => {
        const catalog =
            currentLang === 'ar' ? comboLanguageLabelsAr : currentLang === 'ku' ? comboLanguageLabelsKu : null;
        return LANGUAGE_SUGGESTIONS.map((en) => ({ value: en, label: catalog?.[en] ?? en }));
    }, [currentLang]);

    const genderOptionsLocalized = useMemo(
        () =>
            GENDER_OPTIONS.map((o) => ({
                value: o.value,
                label: t(o.value === 'male' ? 'newCampaign_combo_gender_male' : 'newCampaign_combo_gender_female'),
            })),
        [t, currentLang]
    );

    const ageRangeOptionsLocalized = useMemo(
        () =>
            AGE_RANGE_OPTIONS.map((o) => {
                const key = NEW_CAMPAIGN_AGE_OPT_KEY[o.value];
                return { value: o.value, label: key ? t(key) : o.label };
            }),
        [t, currentLang]
    );

    const educationOptionsLocalized = useMemo(
        () =>
            HIGHEST_EDUCATION_OPTIONS.map((o) => {
                const key = NEW_CAMPAIGN_EDU_OPT_KEY[o.value];
                return { value: o.value, label: key ? t(key) : o.label };
            }),
        [t, currentLang]
    );

    const experienceOptionsLocalized = useMemo(
        () =>
            YEARS_OF_EXPERIENCE_OPTIONS.map((o) => {
                const key = NEW_CAMPAIGN_EXP_OPT_KEY[o.value];
                return { value: o.value, label: key ? t(key) : o.label };
            }),
        [t, currentLang]
    );

    const hasJobAd = Boolean(jobAdvertisement?.trim());

    /** إذا غيّر المستخدم الوظيفة بعد توليد الرابط، امسح الرابط القديم حتى لا يُنسخ رابط حملة سابقة */
    useEffect(() => {
        if (!publicScreeningLink || !publicLinkMeta.position) return;
        const currentPos = ((jobDetails.position || '').trim()) || generalPosition.trim();
        if (currentPos && currentPos !== publicLinkMeta.position) {
            setPublicScreeningLink(null);
            setPublicLinkMeta({ position: '', campaignId: '' });
            setPublicLinkCopied(false);
        }
    }, [jobDetails.position, generalPosition, publicScreeningLink, publicLinkMeta.position]);

    const buildCriteriaPayload = () =>
        buildPresetCriteriaPayload({
            jobDetails,
            selectedCriteria,
            certificationRows,
            skillRows,
            languageRows,
            aiCompareEmailRows,
        });

    /** جسم POST /api/candidates لمساري الصوت والفيديو (مخطط المرشح + حقن وكيل LiveKit/الصوت) */
    const buildAudioCandidatePayload = (campaignId) => {
        const criteria = buildCriteriaPayload();
        const skillsArr = selectedCriteria.skills
            ? skillRows.map((s) => (s || '').trim()).filter(Boolean)
            : [];
        const langArr = selectedCriteria.languages
            ? languageRows.map((s) => (s || '').trim()).filter(Boolean)
            : [];
        // Direct Call/Video flows mark the candidate so Stage 1 (WrittenInterview) skips them
        // and Stage 2/3 show the row immediately as an empty container ready for n8n results.
        const entryStage =
            selectedInterviewType === 'video'
                ? 'video'
                : selectedInterviewType === 'audio'
                    ? 'audio'
                    : undefined;
        const payload = {
            full_name: (criteria.full_name || criteria.fullName || '').trim(),
            email: (criteria.email || '').trim(),
            phone: (criteria.phone || '').trim(),
            position_applied_for: (criteria.position_applied_for || criteria.positionAppliedFor || criteria.position || '').trim(),
            ...(() => {
                const rk = String(criteria.roleKey || '').trim();
                const cl = String(criteria.careerLevel || '').trim();
                const extra = {};
                if (rk) extra.roleKey = rk;
                if (cl) extra.careerLevel = cl;
                if (criteria.labelKey) extra.labelKey = criteria.labelKey;
                if (criteria.researchDomain) extra.researchDomain = criteria.researchDomain;
                return extra;
            })(),
            years_of_experience: (criteria.years_of_experience || criteria.yearsOfExperience || '').trim(),
            agreeToTerms: true,
            campaignId,
            skills: skillsArr,
            languages: langArr,
            ...(entryStage ? { entryStage } : {})
        };
        const co = criteria.company_applied_to || criteria.companyAppliedTo;
        const cc = criteria.current_company || criteria.currentCompany;
        const edu = criteria.highest_education_level || criteria.highestEducationLevel;
        if (co?.trim()) payload.company_applied_to = co.trim();
        if (cc?.trim()) payload.current_company = cc.trim();
        if (edu?.trim()) payload.highest_education_level = edu.trim();
        if (criteria.certifications?.trim()) payload.certifications = criteria.certifications.trim();
        return payload;
    };

    const addCertificationRow = () => {
        setCertificationRows((prev) => [...prev, '']);
    };

    const updateCertificationRow = (index, value) => {
        setCertificationRows((prev) => {
            const next = [...prev];
            next[index] = value;
            return next;
        });
        if (errors.certifications) {
            setErrors((prev) => {
                const next = { ...prev };
                delete next.certifications;
                return next;
            });
        }
    };

    const removeCertificationRow = (index) => {
        setCertificationRows((prev) => {
            if (prev.length <= 1) return prev;
            return prev.filter((_, i) => i !== index);
        });
    };

    const addSkillRow = () => {
        setSkillRows((prev) => [...prev, '']);
    };

    const updateSkillRow = (index, value) => {
        setSkillRows((prev) => {
            const next = [...prev];
            next[index] = value;
            return next;
        });
        if (errors.skills) {
            setErrors((prev) => {
                const next = { ...prev };
                delete next.skills;
                return next;
            });
        }
    };

    const removeSkillRow = (index) => {
        setSkillRows((prev) => {
            if (prev.length <= 1) return prev;
            return prev.filter((_, i) => i !== index);
        });
    };

    const addLanguageRow = () => {
        setLanguageRows((prev) => [...prev, '']);
    };

    const updateLanguageRow = (index, value) => {
        setLanguageRows((prev) => {
            const next = [...prev];
            next[index] = value;
            return next;
        });
        if (errors.languages) {
            setErrors((prev) => {
                const next = { ...prev };
                delete next.languages;
                return next;
            });
        }
    };

    const removeLanguageRow = (index) => {
        setLanguageRows((prev) => {
            if (prev.length <= 1) return prev;
            return prev.filter((_, i) => i !== index);
        });
    };

    const addAiCompareEmailRow = () => {
        setAiCompareEmailRows((prev) => [...prev, '']);
    };

    const updateAiCompareEmailRow = (index, value) => {
        setAiCompareEmailRows((prev) => {
            const next = [...prev];
            next[index] = value;
            return next;
        });
        if (errors.aiCompareTop) {
            setErrors((prev) => {
                const next = { ...prev };
                delete next.aiCompareTop;
                return next;
            });
        }
    };

    const removeAiCompareEmailRow = (index) => {
        setAiCompareEmailRows((prev) => {
            if (prev.length <= 1) return prev;
            return prev.filter((_, i) => i !== index);
        });
    };
    const resolveFormLink = () =>
        publicScreeningLink ||
        voiceInterviewLinkWithCandidate ||
        videoInterviewLinkWithCandidate ||
        formLinkWithCampaign ||
        getCurrentFormLink(currentTemplateType, currentLang);

    const buildShareCopyText = () => {
        const adText =
            includeAdWhenSharing && hasJobAd ? stripJobAdMarkdownForShare(jobAdvertisement) : '';
        let linkText = '';
        if (includeLinkWhenSharing) {
            const formLink = formLinkWithCampaign || getCurrentFormLink(currentTemplateType, currentLang);
            const chunks = [];
            if (publicScreeningLink) {
                chunks.push(`Public screening: ${publicScreeningLink}`);
            }
            if (voiceInterviewLinkWithCandidate) {
                chunks.push(`Voice interview: ${voiceInterviewLinkWithCandidate}`);
            }
            if (videoInterviewLinkWithCandidate) {
                chunks.push(`Video interview (LiveKit): ${videoInterviewLinkWithCandidate}`);
            }
            // Video flow: keep parity with the share-link screen — only the LiveKit link.
            if (formLink && selectedInterviewType !== 'video' && !publicScreeningLink && !isSpecificAudioOrVideo) {
                chunks.push(`Application form: ${formLink}`);
            }
            if (chunks.length === 1) linkText = chunks[0];
            else if (chunks.length > 1) linkText = chunks.join('\n\n');
        }
        if (adText && linkText) return `${adText}\n\n---\n${linkText}`;
        if (adText) return adText;
        if (linkText) return linkText;
        return '';
    };

    const canShareOrCopy = () => {
        const wantsAd = includeAdWhenSharing && hasJobAd;
        const hasAnyLink = Boolean(
            publicScreeningLink ||
            voiceInterviewLinkWithCandidate ||
                videoInterviewLinkWithCandidate ||
                formLinkWithCampaign ||
                getCurrentFormLink(currentTemplateType, currentLang)
        );
        const wantsLink = includeLinkWhenSharing && hasAnyLink;
        return Boolean(wantsAd || wantsLink);
    };

    const shareToggleCheckboxStyle = {
        width: '18px',
        height: '18px',
        cursor: 'pointer',
        accentColor: '#22d3ee',
        flexShrink: 0
    };

    const shareToggleLabelStyle = (checked) => ({
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        cursor: 'pointer',
        flex: 1,
        minWidth: 0,
        padding: '8px 10px',
        borderRadius: NT.radius,
        border: checked ? NT.itemBorder : NT.itemBorderInactive,
        background: checked ? NT.itemBg : NT.itemBgMuted,
        boxShadow: checked ? NT.itemShadow : 'none',
        transition: 'all 0.2s ease'
    });

    const onToggleIncludeAd = (e) => {
        const next = e.target.checked;
        if (!next && !includeLinkWhenSharing) return;
        setIncludeAdWhenSharing(next);
    };

    const onToggleIncludeLink = (e) => {
        const next = e.target.checked;
        if (!hasJobAd && !next) return;
        if (!next && !includeAdWhenSharing) return;
        setIncludeLinkWhenSharing(next);
    };

    useEffect(() => {
        if (!jobAdvertisement?.trim()) {
            setIncludeLinkWhenSharing(true);
        }
    }, [jobAdvertisement]);

    useEffect(() => {
        if (!showAdLangMenu) return undefined;
        const onKey = (e) => {
            if (e.key === 'Escape') setShowAdLangMenu(false);
        };
        const onDocDown = (e) => {
            if (adLangPickerRef.current?.contains(e.target)) return;
            setShowAdLangMenu(false);
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('mousedown', onDocDown);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('mousedown', onDocDown);
        };
    }, [showAdLangMenu]);

    /**
     * عند أي تغيير لـ isOpen: تصفير المعالج.
     * مهم عند الإغلاق: سابقاً كان `if (!isOpen) return` فيبقى showJobDetailsForm=true،
     * فيظهر عنوان/محتوى Job Criteria في أول فتحة تالية دون اختيار Start Process (أو يُظن أن النقر على Audio فتحها).
     */
    useEffect(() => {
        setShowJobDetailsForm(false);
        setShowFormLink(false);
        setShowLinkModal(false);
        setSendSuccess(false);
        setSendingToN8N(false);
        setCampaignId(null);
        setFormLinkWithCampaign(null);
        setVoiceInterviewLinkWithCandidate(null);
        setVideoInterviewLinkWithCandidate(null);
        setSelectedCriteria({});
        setJobDetails({});
        setCvParsing(false);
        setCvParseError('');
        setCvFilledCount(0);
        setCvDetectedPosition('');
        setJobAdvertisement('');
        setAdLanguage('English');
        setAdCurrentLanguage('English');
        setShowAdLangMenu(false);
        setCertificationRows(['']);
        setSkillRows(['']);
        setLanguageRows(['']);
        setAiCompareEmailRows(['']);
        setErrors({});
        setSelectedInterviewType(null);
        setCopiedLink(false);
        setIncludeAdWhenSharing(true);
        setIncludeLinkWhenSharing(true);
        setIsEditingJobAd(false);
        setCurrentTemplateType('process');
        setAddedOrder([]);
        setCustomCriteria([]);
        setAddMenuOpen(false);
        setAddMenuCustomMode(false);
        setCustomLabelDraft('');
    }, [isOpen]);

    /** Hydrate roleKey/careerLevel when only legacy position title exists. */
    useEffect(() => {
        if (!isOpen) return;
        const pos = String(jobDetails.position || '').trim();
        const rk = String(jobDetails.roleKey || '').trim();
        if (rk || !pos) return;
        const resolved = resolveJobRole(pos);
        if (!resolved?.roleKey) return;
        const composed = composeRoleResolution(resolved.roleKey, resolved.careerLevel);
        setJobDetails((prev) => applyRoleResolutionToState(prev, composed));
    }, [isOpen, jobDetails.position, jobDetails.roleKey]);

    const positionSectionHint = useMemo(() => {
        const rk = String(jobDetails.roleKey || '').trim();
        if (!rk) return '';
        const rep = getRepresentativeEntry(rk);
        if (!rep?.section) return '';
        return t(`positionCatalogSection_${rep.section}`) || rep.section;
    }, [jobDetails.roleKey, t]);

    const criteriaInputTokens = useMemo(() => getCriteriaInputTokens(theme), [theme]);
    const criteriaComboboxProps = useCallback(
        (hasError) => buildCriteriaComboboxProps(criteriaInputTokens, hasError),
        [criteriaInputTokens]
    );
    const criteriaTextInputProps = useCallback(
        (hasError, overrides = {}) => buildCriteriaTextInputProps(criteriaInputTokens, hasError, overrides),
        [criteriaInputTokens]
    );

    if (!isOpen) return null;

    /** تبويب «عام» داخل مسار الصوت: حملة صوتية عامة عبر رابط مشارَك (لا بيانات مرشح) */
    const isGeneralAudio = selectedInterviewType === 'audio' && audioFlowTab === 'general';
    /** تبويب «عام» داخل مسار الفيديو: حملة فيديو عامة عبر رابط مشارَك (لا بيانات مرشح) */
    const isGeneralVideo = selectedInterviewType === 'video' && videoFlowTab === 'general';
    /** أي مسار عام (صوت أو فيديو) */
    const isGeneralPublic = isGeneralAudio || isGeneralVideo;
    /** مسار «محدد» (Specific) صوت أو فيديو — بدون رابط نموذج التقديم */
    const isSpecificAudioOrVideo =
        (selectedInterviewType === 'audio' && audioFlowTab === 'specific') ||
        (selectedInterviewType === 'video' && videoFlowTab === 'specific');

    /**
     * معايير Job Criteria:
     *  - مسار «عام» (General) صوت/فيديو: معايير الوظيفة (مثل Start Process) لتعريف الدور وتوليد الإعلان.
     *  - مسارا Audio «محدد»/Video «محدد»: حقول المرشح لحقن الوكيل.
     *  - Start Process: دون تغيير.
     */
    const activeJobCriteria =
        isGeneralPublic
            ? AVAILABLE_CRITERIA.map((c) => localizeScreeningCriterion(c, t))
            : selectedInterviewType === 'audio' || selectedInterviewType === 'video'
                ? AVAILABLE_CRITERIA_AUDIO.map((c) => localizeAudioCriterion(c, t))
                : AVAILABLE_CRITERIA.map((c) => localizeScreeningCriterion(c, t));

    // تفعيل/إلغاء تفعيل معيار
    const toggleCriterion = (criterionId) => {
        setSelectedCriteria(prev => {
            const newSelected = { ...prev };
            if (newSelected[criterionId]) {
                // إلغاء التفعيل - حذف القيمة
                delete newSelected[criterionId];
                setJobDetails(prevDetails => {
                    const newDetails = { ...prevDetails };
                    delete newDetails[criterionId];
                    return newDetails;
                });
                if (criterionId === 'certifications') {
                    setCertificationRows(['']);
                }
                if (criterionId === 'skills') {
                    setSkillRows(['']);
                }
                if (criterionId === 'languages') {
                    setLanguageRows(['']);
                }
                if (criterionId === 'aiCompareTop') {
                    setAiCompareEmailRows(['']);
                }
            } else {
                // تفعيل - إضافة المعيار بق-values فارغة
                newSelected[criterionId] = true;
                setJobDetails(prevDetails => ({
                    ...prevDetails,
                    [criterionId]: ''
                }));
                if (criterionId === 'certifications') {
                    setCertificationRows(['']);
                }
                if (criterionId === 'skills') {
                    setSkillRows(['']);
                }
                if (criterionId === 'languages') {
                    setLanguageRows(['']);
                }
                if (criterionId === 'aiCompareTop') {
                    setAiCompareEmailRows(['']);
                }
            }
            return newSelected;
        });
    };

    const handleInputChange = (field, value) => {
        setJobDetails(prev => ({
            ...prev,
            [field]: value
        }));
        // حذف الخطأ عند البدء بالكتابة
        if (errors[field]) {
            setErrors(prev => {
                const newErrors = { ...prev };
                delete newErrors[field];
                return newErrors;
            });
        }
    };

    /**
     * Mapper: normalize the LLM extraction JSON onto form state.
     * نفصل شكل مخرجات الـ LLM عن jobDetails — نعبّئ فقط الحقول ذات القيم ونفعّل معاييرها.
     * يُعيد عدد الحقول التي عُبّئت.
     */
    const applyCvExtractedFields = (fields) => {
        if (!fields || typeof fields !== 'object') return 0;
        const clean = (v) => (typeof v === 'string' ? v.trim() : '');
        const toRows = (v) => {
            const parts = clean(v).split(',').map((s) => s.trim()).filter(Boolean);
            return parts.length ? parts : [''];
        };

        const TEXT_FIELDS = [
            'full_name', 'email', 'phone', 'job_level',
            'company_applied_to', 'current_company',
            'highest_education_level', 'years_of_experience',
        ];

        const detailsPatch = {};
        const selectPatch = {};
        let filled = 0;

        for (const id of TEXT_FIELDS) {
            const val = clean(fields[id]);
            if (val) {
                detailsPatch[id] = val;
                selectPatch[id] = true;
                filled += 1;
            }
        }

        // الحقول ذات الرقاقات (chips): نُخزّن السلسلة ونملأ الصفوف.
        const chipSetters = {
            skills: setSkillRows,
            languages: setLanguageRows,
            certifications: setCertificationRows,
        };
        for (const [id, setRows] of Object.entries(chipSetters)) {
            const val = clean(fields[id]);
            if (val) {
                detailsPatch[id] = val;
                selectPatch[id] = true;
                setRows(toRows(val));
                filled += 1;
            }
        }

        // position: حقل مرتبط بكتالوج الأدوار (combobox) — لا نفرض roleKey تلقائياً؛
        // نعرض القيمة المكتشفة للمستخدم ليختارها من القائمة.
        setCvDetectedPosition(clean(fields.position_applied_for));

        if (Object.keys(detailsPatch).length) {
            setJobDetails((prev) => ({ ...prev, ...detailsPatch }));
        }
        if (Object.keys(selectPatch).length) {
            setSelectedCriteria((prev) => ({ ...prev, ...selectPatch }));
            setErrors((prev) => {
                const n = { ...prev };
                Object.keys(selectPatch).forEach((k) => delete n[k]);
                delete n.general;
                return n;
            });
        }
        return filled;
    };

    /** رفع ملف السيرة الذاتية → استخراج الحقول عبر الـ backend → تعبئة النموذج. */
    const handleCvFileSelected = async (event) => {
        const file = event?.target?.files?.[0];
        if (event?.target) event.target.value = ''; // اسمح بإعادة اختيار نفس الملف
        if (!file) return;

        setCvParseError('');
        setCvFilledCount(0);
        setCvDetectedPosition('');
        setCvParsing(true);
        try {
            const formData = new FormData();
            formData.append('cv', file);
            const res = await apiClient.postForm('/api/cv/parse', formData);
            if (!res?.ok || !res.fields) {
                throw new Error(res?.message || 'parse_failed');
            }
            setCvFilledCount(applyCvExtractedFields(res.fields));
        } catch (err) {
            setCvParseError(
                err?.data?.message || err?.message || t('newCampaign_cvUpload_error')
            );
        } finally {
            setCvParsing(false);
        }
    };

    /** Evaalo Job Catalog — structured role fields for Blueprint (roleKey + careerLevel). */
    const applyJobRoleResolution = (resolution) => {
        if (!resolution?.roleKey) return;
        setJobDetails((prev) => applyRoleResolutionToState(prev, resolution));
    };

    const handleRoleKeySelect = (roleKey, keepCareerLevel = true) => {
        const rk = String(roleKey || '').trim();
        if (!rk) {
            setJobDetails((prev) => ({
                ...prev,
                roleKey: '',
                careerLevel: '',
                managementTrack: '',
                labelKey: '',
                roleMatchSource: '',
                position: '',
            }));
            return;
        }
        // Ignore partial free-text from the combobox — only commit known catalog roleKeys
        if (!getRepresentativeEntry(rk)) {
            return;
        }
        const storedLevel =
            keepCareerLevel && String(jobDetails.careerLevel || '').trim() !== 'mid'
                ? String(jobDetails.careerLevel || '').trim()
                : '';
        const effectiveLevel = storedLevel || fromJobLevelUiValue(rk, '');
        applyJobRoleResolution(composeRoleResolution(rk, effectiveLevel));
    };

    const handleCareerLevelSelect = (nextLevel) => {
        const rk = String(jobDetails.roleKey || '').trim();
        if (rk) {
            applyJobRoleResolution(composeRoleResolution(rk, nextLevel));
            return;
        }
        setJobDetails((prev) => ({
            ...prev,
            careerLevel: nextLevel || 'mid',
        }));
    };

    const renderCareerLevelField = (criterion, hasError, selectId = 'ni-sidebar-job-level', titleHint) => (
        <CareerLevelSelect
            id={selectId}
            roleKey={jobDetails.roleKey}
            careerLevel={jobDetails.careerLevel}
            onChange={(nextLevel) => handleCareerLevelSelect(nextLevel)}
            placeholder={criterion?.placeholder || t('newCampaign_jc_job_ph')}
            title={titleHint}
            wrapperClassName={[
                'position-suggest--sidebar-wide',
                hasError ? 'ni-career-level-select--error' : '',
            ]
                .filter(Boolean)
                .join(' ')}
            listboxId={`${selectId}-menu`}
        />
    );

    const showResearchDomainField =
        jobDetails.roleKey === 'researcher'
        || String(jobDetails.position || '').trim() === 'Researcher'
        || String(jobDetails.roleMatchSource || '') === 'ambiguous_legacy'
            && /researcher/i.test(String(jobDetails.position || ''));

    const RESEARCH_DOMAIN_OPTIONS = [
        'Energy',
        'Market Intelligence',
        'Public Policy',
        'Data Research',
    ];

    /** Screening فقط */
    const handleAddPresetCriterion = (criterionId) => {
        setAddedOrder((prev) => (prev.includes(criterionId) ? prev : [...prev, criterionId]));
        if (!selectedCriteria[criterionId]) {
            toggleCriterion(criterionId);
        }
        setAddMenuOpen(false);
        setAddMenuCustomMode(false);
        setCustomLabelDraft('');
        if (errors.general) {
            setErrors((prev) => {
                const n = { ...prev };
                delete n.general;
                return n;
            });
        }
    };

    const handleRemovePresetFromScreening = (criterionId) => {
        setAddedOrder((prev) => prev.filter((x) => x !== criterionId));
        if (selectedCriteria[criterionId]) {
            toggleCriterion(criterionId);
        }
    };

    const handleAddCustomCriterion = () => {
        const label = customLabelDraft.trim();
        if (!label) return;
        const id = `custom__${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        setCustomCriteria((prev) => [...prev, { id, label, expectation: '' }]);
        setAddMenuOpen(false);
        setAddMenuCustomMode(false);
        setCustomLabelDraft('');
        if (errors.general) {
            setErrors((prev) => {
                const n = { ...prev };
                delete n.general;
                return n;
            });
        }
    };

    const handleUpdateCustomCriterion = (id, expectation) => {
        setCustomCriteria((prev) => prev.map((c) => (c.id === id ? { ...c, expectation } : c)));
        if (errors[id]) {
            setErrors((prev) => {
                const n = { ...prev };
                delete n[id];
                return n;
            });
        }
    };

    const handleRemoveCustomCriterion = (id) => {
        setCustomCriteria((prev) => prev.filter((c) => c.id !== id));
        if (errors[id]) {
            setErrors((prev) => {
                const n = { ...prev };
                delete n[id];
                return n;
            });
        }
    };

    const validateForm = () => {
        const newErrors = {};
        // التحقق من أن جميع المعايير المختارة لها قيم
        Object.keys(selectedCriteria).forEach(criterionId => {
            if (criterionId === 'certifications' || criterionId === 'skills' || criterionId === 'languages' || criterionId === 'aiCompareTop') return;
            if (criterionId === 'job' || criterionId === 'job_level') return;
            if (criterionId === 'position') {
                if (selectedCriteria.position && !String(jobDetails.roleKey || jobDetails.position || '').trim()) {
                    const criterion = activeJobCriteria.find(c => c.id === criterionId);
                    newErrors[criterionId] = `${criterion?.label || criterionId} is required`;
                }
                return;
            }
            if (selectedCriteria[criterionId] && (!jobDetails[criterionId] || !jobDetails[criterionId].trim())) {
                const criterion = activeJobCriteria.find(c => c.id === criterionId);
                newErrors[criterionId] = `${criterion?.label || criterionId} is required`;
            }
        });

        if (selectedCriteria.certifications) {
            const hasCert = certificationRows.some((s) => s && String(s).trim());
            if (!hasCert) {
                newErrors.certifications = t('newCampaign_jc_certifications_errRequired');
            }
        }

        if (selectedCriteria.skills) {
            const hasSkill = skillRows.some((s) => s && String(s).trim());
            if (!hasSkill) {
                newErrors.skills = t('newCampaign_jc_skills_errRequired');
            }
        }

        if (selectedCriteria.languages) {
            const hasLang = languageRows.some((s) => s && String(s).trim());
            if (!hasLang) {
                newErrors.languages = t('newCampaign_jc_languages_errRequired');
            }
        }

        if (selectedCriteria.aiCompareTop) {
            const emails = aiCompareEmailRows.map((s) => (s || '').trim()).filter(Boolean);
            if (emails.length === 0) {
                newErrors.aiCompareTop = t('newCampaign_jc_aiCompareTop_errRequired');
            } else {
                const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                const invalid = emails.find((em) => !emailRe.test(em));
                if (invalid) {
                    newErrors.aiCompareTop = `${t('newCampaign_jc_aiCompareTop_errInvalid')} ${invalid}`;
                }
            }
        }

        if (isScreeningFlow) {
            customCriteria.forEach(({ id, label, expectation }) => {
                if (!String(expectation || '').trim()) {
                    newErrors[id] = fillI18nTemplate(t('newCampaign_customCriterionExpectationRequired'), {
                        label: label || t('newCampaign_criterionMenuCustom'),
                    });
                }
            });
        }

        // Screening: at least one preset value or one custom rubric item with expectation
        if (isScreeningFlow) {
            const hasPreset = Object.keys(selectedCriteria).some((k) => {
                if (!selectedCriteria[k]) return false;
                if (k === 'certifications') return certificationRows.some((s) => String(s || '').trim());
                if (k === 'skills') return skillRows.some((s) => String(s || '').trim());
                if (k === 'languages') return languageRows.some((s) => String(s || '').trim());
                if (k === 'aiCompareTop') return aiCompareEmailRows.some((s) => String(s || '').trim());
                if (k === 'position') return Boolean(String(jobDetails.roleKey || jobDetails.position || '').trim());
                if (k === 'job') return Boolean(String(jobDetails.roleKey || '').trim());
                return Boolean(String(jobDetails[k] ?? '').trim());
            });
            const hasCustom = countFilledCustomRubricItems(customCriteria) > 0;
            if (!hasPreset && !hasCustom) {
                newErrors.general = t('newCampaign_rubricAtLeastOne');
            }
        } else if (Object.keys(selectedCriteria).length === 0) {
            newErrors.general = t('newCampaign_rubricAtLeastOne');
        }

        if (selectedInterviewType === 'audio' || selectedInterviewType === 'video') {
            const requiredForCandidate = [
                'full_name',
                'email',
                'job_level',
                'position_applied_for',
                'years_of_experience'
            ];
            const kind = selectedInterviewType === 'video' ? 'video' : 'voice';
            requiredForCandidate.forEach((id) => {
                // مستوى الوظيفة مشتق من careerLevel/roleKey وليس من jobDetails.job_level،
                // لذا يكفي اختيار الوظيفة (roleKey) لاعتباره مكتملاً.
                const filled =
                    id === 'job_level'
                        ? Boolean(String(jobDetails.roleKey ?? '').trim())
                        : (String(jobDetails[id] ?? '').trim() || String(jobDetails.roleKey ?? '').trim());
                if (!selectedCriteria[id] || !filled) {
                    const criterion = activeJobCriteria.find((c) => c.id === id);
                    newErrors[id] = `${criterion?.label || id} is required for ${kind} interview`;
                }
            });
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleGenerateAdvertisement = async () => {
        const filledCriteria = Object.keys(selectedCriteria).filter(k => selectedCriteria[k]).length;
        const filledCustom = isScreeningFlow ? countFilledCustomRubricItems(customCriteria) : 0;
        if (filledCriteria === 0 && filledCustom === 0) {
            setErrors(prev => ({ ...prev, general: 'Please select and fill at least one criterion before generating' }));
            return;
        }
        setGeneratingAd(true);
        setErrors(prev => ({ ...prev, general: null }));
        try {
            const result = await apiClient.post('/api/recruitment-campaigns/generate-ad', {
                ...buildCriteriaPayload(),
                language: adLanguage,
            });
                  if (result.success && result.jobAdvertisement) {
                setJobAdvertisement(sanitizeJobAdvertisementFences(result.jobAdvertisement || ''));
                setAdCurrentLanguage(adLanguage);
            } else {
                setErrors(prev => ({ ...prev, general: result.message || 'Failed to generate advertisement' }));
            }
        } catch (err) {
            console.error('Error generating job ad:', err);
            setErrors(prev => ({ ...prev, general: 'Error generating advertisement. Please try again.' }));
        } finally {
            setGeneratingAd(false);
        }
    };

    /** قالب الاستمارة في رابط الحملة: صوت/فيديو إن وُجد، وإلا قالب العملية الافتراضي */
    const resolveCampaignFormTemplateId = () => {
        if (currentTemplateType === 'audio' && selectedAudioTemplate?.id) {
            return selectedAudioTemplate.id;
        }
        if (currentTemplateType === 'video' && selectedVideoTemplate?.id) {
            return selectedVideoTemplate.id;
        }
        return selectedTemplate?.id || DEFAULT_SCREENING_FORM_TEMPLATE_ID;
    };

    /**
     * المسار العام (General): ينشئ حملة فقط ثم يبني رابطاً عاماً مشارَكاً
     * `/screening-call?campaignId=&mode=public&position=` بدون إنشاء مرشح مسبق.
     * كل مرشح يفتح الرابط يُدخل بياناته في الصفحة العامة فيُنشأ سجله هناك.
     */
    const handleGeneratePublicLink = async () => {
        setGeneratingPublicLink(true);
        setErrors(prev => ({ ...prev, general: null }));
        setPublicLinkCopied(false);
        try {
            // الوظيفة من معيار Position في النموذج الغني، مع رجوع لحقل generalPosition القديم
            const pos = ((jobDetails.position || '').trim()) || generalPosition.trim();
            const campaignPayload = {
                ...buildCriteriaPayload(),
                position: pos || 'General Screening',
                interviewType: 'audio',
                templateType: 'audio',
            };
            if (jobAdvertisement.trim()) campaignPayload.jobAdvertisement = jobAdvertisement.trim();
            const result = await apiClient.post('/api/recruitment-campaigns', campaignPayload);
            if (!result.success || !result.campaignId) {
                setErrors(prev => ({ ...prev, general: result.message || result.error || 'Failed to create campaign' }));
                return;
            }
            const params = new URLSearchParams();
            params.set('campaignId', result.campaignId);
            params.set('mode', 'public');
            params.set('language', currentLang || 'ar');
            if (pos) params.set('position', pos);
            const link = absoluteAppUrl(`/screening-call?${params.toString()}`);
            setCampaignId(result.campaignId);
            setPublicScreeningLink(link);
            setPublicLinkMeta({ position: pos || 'General Screening', campaignId: result.campaignId });
            setIncludeLinkWhenSharing(true);
            setShowJobDetailsForm(false);
            setShowFormLink(true);
            setSendSuccess(true);
            setTimeout(() => setSendSuccess(false), 3000);
        } catch (err) {
            console.error('Error generating public link:', err);
            const msg =
                err instanceof ApiError
                    ? err.data?.message || err.data?.error || err.message
                    : 'Error generating public link. Please try again.';
            setErrors(prev => ({ ...prev, general: msg }));
        } finally {
            setGeneratingPublicLink(false);
        }
    };

    /**
     * التبديل بين تبويبَي «محدد»/«عام» داخل مسار الصوت.
     * المجموعتان تستخدمان معايير مختلفة (حقول مرشح مقابل معايير وظيفة)،
     * لذا نُصفّر حقول النموذج لتجنّب تسرّب قيم بين التبويبين.
     */
    const handleSwitchAudioTab = (tab) => {
        if (tab === audioFlowTab) return;
        setAudioFlowTab(tab);
        setSelectedCriteria({});
        setJobDetails({});
        setCertificationRows(['']);
        setSkillRows(['']);
        setLanguageRows(['']);
        setAiCompareEmailRows(['']);
        setAddedOrder([]);
        setCustomCriteria([]);
        setJobAdvertisement('');
        setErrors({});
        setGeneralPosition('');
        setPublicScreeningLink(null);
        setPublicLinkMeta({ position: '', campaignId: '' });
        setPublicLinkCopied(false);
    };

    /**
     * المسار العام للفيديو (General): ينشئ حملة فيديو فقط ثم يبني رابطاً عاماً مشارَكاً
     * `/video-screening-call?campaignId=&mode=public&position=` بدون إنشاء مرشح مسبق.
     * كل مرشح يفتح الرابط يُدخل بياناته في الصفحة العامة فيُنشأ سجله هناك (entryStage=video).
     */
    const handleGenerateVideoPublicLink = async () => {
        setGeneratingPublicLink(true);
        setErrors(prev => ({ ...prev, general: null }));
        setPublicLinkCopied(false);
        try {
            const pos = ((jobDetails.position || '').trim()) || generalPosition.trim();
            const campaignPayload = {
                ...buildCriteriaPayload(),
                position: pos || 'General Screening',
                interviewType: 'video',
                templateType: 'video',
            };
            if (jobAdvertisement.trim()) campaignPayload.jobAdvertisement = jobAdvertisement.trim();
            const result = await apiClient.post('/api/recruitment-campaigns', campaignPayload);
            if (!result.success || !result.campaignId) {
                setErrors(prev => ({ ...prev, general: result.message || result.error || 'Failed to create campaign' }));
                return;
            }
            const params = new URLSearchParams();
            params.set('campaignId', result.campaignId);
            params.set('mode', 'public');
            params.set('language', currentLang || 'ar');
            if (pos) params.set('position', pos);
            const link = absoluteAppUrl(`/video-screening-call?${params.toString()}`);
            setCampaignId(result.campaignId);
            setPublicScreeningLink(link);
            setPublicLinkMeta({ position: pos || 'General Screening', campaignId: result.campaignId });
            setIncludeLinkWhenSharing(true);
            setShowJobDetailsForm(false);
            setShowFormLink(true);
            setSendSuccess(true);
            setTimeout(() => setSendSuccess(false), 3000);
        } catch (err) {
            console.error('Error generating video public link:', err);
            const msg =
                err instanceof ApiError
                    ? err.data?.message || err.data?.error || err.message
                    : 'Error generating public link. Please try again.';
            setErrors(prev => ({ ...prev, general: msg }));
        } finally {
            setGeneratingPublicLink(false);
        }
    };

    /** التبديل بين تبويبَي «محدد»/«عام» داخل مسار الفيديو (نفس منطق الصوت). */
    const handleSwitchVideoTab = (tab) => {
        if (tab === videoFlowTab) return;
        setVideoFlowTab(tab);
        setSelectedCriteria({});
        setJobDetails({});
        setCertificationRows(['']);
        setSkillRows(['']);
        setLanguageRows(['']);
        setAiCompareEmailRows(['']);
        setAddedOrder([]);
        setCustomCriteria([]);
        setJobAdvertisement('');
        setErrors({});
        setGeneralPosition('');
        setPublicScreeningLink(null);
        setPublicLinkMeta({ position: '', campaignId: '' });
        setPublicLinkCopied(false);
    };

    const handleCopyPublicLink = async () => {
        if (!publicScreeningLink) return;
        try {
            await navigator.clipboard.writeText(publicScreeningLink);
            setPublicLinkCopied(true);
            setTimeout(() => setPublicLinkCopied(false), 2000);
        } catch (_) {
            // ignore clipboard errors
        }
    };

    const handleContinue = async () => {
        if (validateForm()) {
            setSendingToN8N(true);
            try {
                const payload = isScreeningFlow
                    ? buildScreeningCampaignCreateBody({
                          jobDetails,
                          selectedCriteria,
                          certificationRows,
                          skillRows,
                          languageRows,
                          aiCompareEmailRows,
                          customCriteria,
                          formTemplateId: selectedTemplate?.id || DEFAULT_SCREENING_FORM_TEMPLATE_ID,
                          jobAdvertisement,
                          language: currentLang,
                      })
                    : (() => {
                          const body = { ...buildCriteriaPayload() };
                          if (jobAdvertisement.trim()) body.jobAdvertisement = jobAdvertisement.trim();
                          return body;
                      })();
                const result = await apiClient.post('/api/recruitment-campaigns', payload);

                if (result.success && result.campaignId) {
                    console.log('✅ Campaign created:', result.campaignId);

                    setCampaignId(result.campaignId);
                    setVoiceInterviewLinkWithCandidate(null);
                    setVideoInterviewLinkWithCandidate(null);

                    const formLink = isScreeningFlow
                        ? resolvePublicFormUrlFromCampaignResponse(result, absoluteAppUrl, {
                              language: currentLang,
                          })
                        : buildCampaignFormShareUrl(absoluteAppUrl, {
                              templateId: resolveCampaignFormTemplateId(),
                              campaignId: result.campaignId,
                              language: currentLang,
                          });
                    setFormLinkWithCampaign(formLink);

                    if (selectedInterviewType === 'audio' || selectedInterviewType === 'video') {
                        const candBody = buildAudioCandidatePayload(result.campaignId);
                        const candResult = await apiClient.post('/api/candidates', candBody);
                        if (!candResult.success || !candResult.data) {
                            const msg =
                                candResult.message ||
                                candResult.error ||
                                'Failed to create candidate';
                            console.warn('⚠️ Candidate create failed:', candResult);
                            setFormLinkWithCampaign(null);
                            setCampaignId(null);
                            alert(msg);
                            return;
                        }
                        const rawId = candResult.data._id ?? candResult.data.id;
                        const personId =
                            candResult.data.candidateId != null
                                ? String(candResult.data.candidateId)
                                : rawId != null
                                  ? String(rawId)
                                  : '';
                        const applicationId =
                            candResult.applicationId ||
                            candResult.data.applicationId ||
                            undefined;
                        if (!personId) {
                            setFormLinkWithCampaign(null);
                            setCampaignId(null);
                            alert('Candidate created but no id returned.');
                            return;
                        }
                        if (selectedInterviewType === 'audio') {
                            const q = buildCandidateInterviewQuery({
                                candidateId: personId,
                                campaignId: result.campaignId,
                                applicationId,
                                language: currentLang,
                            });
                            const interviewLink = absoluteAppUrl(`/interview?${q.toString()}`);
                            setVoiceInterviewLinkWithCandidate(interviewLink);
                        } else {
                            const q = buildCandidateInterviewQuery({
                                candidateId: personId,
                                campaignId: result.campaignId,
                                applicationId,
                                language: currentLang,
                            });
                            const videoLink = absoluteAppUrl(`/video-interview-call?${q.toString()}`);
                            setVideoInterviewLinkWithCandidate(videoLink);
                        }
                    }

                    setShowJobDetailsForm(false);
                    setShowFormLink(true);
                    setSendSuccess(true);
                    setTimeout(() => setSendSuccess(false), 3000);
                } else {
                    console.warn('⚠️ Failed to create campaign:', result);
                    setErrors((prev) => ({
                        ...prev,
                        general: formatCampaignCreateError(result),
                    }));
                }
            } catch (error) {
                console.error('❌ Error creating campaign:', error);
                setErrors((prev) => ({
                    ...prev,
                    general: formatCampaignCreateError(
                        error instanceof ApiError ? error.data : null,
                        error instanceof ApiError
                            ? error.data?.message || error.message
                            : 'Error creating campaign. Please try again.'
                    ),
                }));
            } finally {
                setSendingToN8N(false);
            }
        }
    };

    const handleOptionClick = (optionId) => {
        if (optionId === 'start-process') {
            setCurrentTemplateType('process');
            setSelectedInterviewType('process');
            setShowJobDetailsForm(true);
            onSelectOption?.('start-process');
            return;
        }
        if (optionId === 'video-interview') {
            // لا نمنع الفتح إن لم يُختر قالب فيديو مخصّص — نفس مسار الصوت؛ رابط الاستمارة يستخدم selectedVideoTemplate أو selectedTemplate (انظر resolveCampaignFormTemplateId).
            setSelectedCriteria({});
            setJobDetails({});
            setCertificationRows(['']);
            setSkillRows(['']);
            setLanguageRows(['']);
            setAiCompareEmailRows(['']);
            setErrors({});
            setCurrentTemplateType('video');
            setSelectedInterviewType('video');
            setShowJobDetailsForm(true);
            // افتراضياً تبويب «محدد»؛ وتصفير حالة الرابط العام.
            setVideoFlowTab('specific');
            setGeneralPosition('');
            setPublicScreeningLink(null);
            setPublicLinkCopied(false);
            onSelectOption?.('video-interview');
            return;
        }
        if (optionId === 'audio-interview') {
            setSelectedCriteria({});
            setJobDetails({});
            setCertificationRows(['']);
            setSkillRows(['']);
            setLanguageRows(['']);
            setAiCompareEmailRows(['']);
            setErrors({});
            setCurrentTemplateType('audio');
            setSelectedInterviewType('audio');
            setShowJobDetailsForm(true);
            // افتراضياً تبويب «محدد»؛ وتصفير حالة الرابط العام.
            setAudioFlowTab('specific');
            setGeneralPosition('');
            setPublicScreeningLink(null);
            setPublicLinkCopied(false);
            onSelectOption?.('audio-interview');
            return;
        }
        if (optionId === 'application-form') {
            /** Screening: شاشة «Add on demand» — ابدأ بدون معايير ظاهرة، والمستخدم يضيف بزر + */
            setSelectedCriteria({});
            setJobDetails({});
            setCertificationRows(['']);
            setSkillRows(['']);
            setLanguageRows(['']);
            setAiCompareEmailRows(['']);
            setErrors({});
            setAddedOrder([]);
            setCustomCriteria([]);
            setAddMenuOpen(false);
            setAddMenuCustomMode(false);
            setCustomLabelDraft('');
            setCurrentTemplateType('process');
            setSelectedInterviewType('form');
            setShowJobDetailsForm(true);
            onSelectOption?.('application-form');
            return;
        }
    };

    const handleCopyLink = () => {
        const formLink = getCurrentFormLink(currentTemplateType, currentLang);
        if (formLink) {
            navigator.clipboard.writeText(formLink).then(() => {
                setCopiedLink(true);
                setTimeout(() => {
                    setCopiedLink(false);
                    setShowLinkModal(false);
                    onClose();
                }, 2000);
            });
        }
    };

    const handleCloseModal = () => {
        setShowLinkModal(false);
        onClose();
    };

    return (
        <>
            {/* Overlay */}
            <div
                className="modal-overlay new-interview-modal-overlay"
                onClick={onClose}
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0, 0, 0, 0.75)',
                    backdropFilter: 'blur(8px)',
                    zIndex: 10001,
                    animation: 'fadeIn 0.3s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}
            />

            {/* Modal - Centered */}
            <div
                className="new-interview-modal"
                onClick={(e) => e.stopPropagation()}
                style={{
                    position: 'fixed',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: '92%',
                    maxWidth: '900px',
                    maxHeight: '90vh',
                    background: NT.shellBg,
                    backdropFilter: 'blur(24px)',
                    WebkitBackdropFilter: 'blur(24px)',
                    border: NT.shellBorder,
                    borderRadius: '16px',
                    boxShadow: NT.shellShadow,
                    zIndex: 10002,
                    padding: '28px',
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    animation: 'modalFadeIn 0.3s ease',
                    display: 'flex',
                    flexDirection: 'column'
                }}
            >
                {/* Header — عنوان في المنتصف، رجوع يسار، إغلاق يمين (عرض أعمدة متساوٍ للتمركز) */}
                <div className="ni-modal-header-block" style={{ marginBottom: '20px' }}>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '12px',
                            minHeight: 46,
                        }}
                    >
                        <div
                            style={{
                                width: 46,
                                flexShrink: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'flex-start',
                            }}
                        >
                            {showJobDetailsForm ? (
                                <button
                                    type="button"
                                    className="ni-header-btn-close"
                                    onClick={() => setShowJobDetailsForm(false)}
                                    title={t('newCampaign_backToReady')}
                                    aria-label={t('newCampaign_backToReady')}
                                >
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                                        <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                </button>
                            ) : null}
                        </div>
                        <h2
                            style={{
                                flex: 1,
                                minWidth: 0,
                                fontSize: '20px',
                                fontWeight: 700,
                                color: NT.title,
                            margin: 0,
                                letterSpacing: '0.02em',
                                textAlign: 'center',
                            }}
                        >
                            {showJobDetailsForm
                                ? isGeneralAudio
                                    ? t('newCampaign_titleJobCriteria')
                                    : selectedInterviewType === 'audio' || selectedInterviewType === 'video'
                                        ? t('newCampaign_titleCandidateInfo')
                                        : t('newCampaign_titleJobCriteria')
                                : t('newCampaign_titleReady')}
                        </h2>
                        <div
                            style={{
                                width: 46,
                                flexShrink: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'flex-end',
                            }}
                        >
                            <button type="button" className="ni-header-btn-close" onClick={onClose} aria-label={t('newCampaign_modalClose')}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                        </button>
                        </div>
                    </div>
                    {showJobDetailsForm && (selectedInterviewType === 'audio' || selectedInterviewType === 'video') ? (
                        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '12px' }}>
                        <div
                            role="tablist"
                            aria-label={t('newCampaign_titleCandidateInfo')}
                            className="ni-flow-tablist"
                            style={{
                                display: 'inline-flex',
                                padding: '4px',
                                borderRadius: '12px',
                                gap: '4px',
                            }}
                        >
                            {[
                                { id: 'specific', label: t('newCampaign_audioTabSpecific') },
                                { id: 'general', label: t('newCampaign_audioTabGeneral') },
                            ].map((tab) => {
                                const currentFlowTab = selectedInterviewType === 'video' ? videoFlowTab : audioFlowTab;
                                const switchTab = selectedInterviewType === 'video' ? handleSwitchVideoTab : handleSwitchAudioTab;
                                const active = currentFlowTab === tab.id;
                                return (
                                    <button
                                        key={tab.id}
                                        type="button"
                                        role="tab"
                                        aria-selected={active}
                                        className={`ni-flow-tab${active ? ' ni-flow-tab--active' : ''}`}
                                        onClick={() => switchTab(tab.id)}
                                        style={{
                                            minWidth: '120px',
                                            padding: '9px 18px',
                                            fontSize: '13px',
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            borderRadius: '9px',
                                            transition: 'color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease',
                                        }}
                                    >
                                        {tab.label}
                                    </button>
                                );
                            })}
                        </div>
                        </div>
                    ) : null}
                    {showJobDetailsForm && selectedInterviewType === 'form' ? (
                        <div
                            className="ni-header-form-templates-row"
                            style={{
                                display: 'flex',
                                justifyContent: 'center',
                                marginTop: '10px',
                            }}
                        >
                            <button
                                type="button"
                                className="ni-header-form-templates-btn"
                                title={t('newCampaign_templatesChooseTitle')}
                                aria-label={t('newCampaign_templatesChooseAria')}
                                onClick={() => {
                                    navigate('/interview-templates');
                                    onClose();
                                }}
                            >
                                <span className="ni-header-form-templates-btn__icon" aria-hidden>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path
                                            d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        />
                                        <path d="M14 2v6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M8 13h8M8 17h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                    </svg>
                                </span>
                                <span className="ni-header-form-templates-btn__label">{t('newCampaign_templates')}</span>
                            </button>
                        </div>
                    ) : null}
                    {/* Success Message */}
                    {sendSuccess && (
                        <div className="ni-feedback-banner ni-feedback-banner--success ni-campaign-ready-success" style={{
                            marginTop: '12px',
                            padding: '12px 18px',
                            background: NT.itemBg,
                            border: '1px solid rgba(16, 185, 129, 0.4)',
                            borderRadius: NT.radius,
                            color: '#10B981',
                            fontSize: '13px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            boxShadow: NT.itemShadow
                        }}>
                            <span style={{ fontSize: '16px' }}>✓</span>
                            <span style={{ fontWeight: 600 }}>{t('newCampaign_successCreated')}</span>
                        </div>
                    )}
                    {/* Loading Message */}
                    {sendingToN8N && (
                        <div className="ni-feedback-banner ni-feedback-banner--loading ni-campaign-ready-loading" style={{
                            marginTop: '12px',
                            padding: '12px 18px',
                            background: NT.itemBg,
                            border: NT.itemBorder,
                            borderRadius: NT.radius,
                            color: '#22d3ee',
                            fontSize: '13px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            boxShadow: NT.itemShadow
                        }}>
                            <span style={{ fontSize: '16px' }}>⏳</span>
                            <span style={{ fontWeight: 600 }}>
                                {selectedInterviewType === 'audio' || selectedInterviewType === 'video'
                                    ? t('newCampaign_loadingCampaignCandidate')
                                    : t('newCampaign_loadingCampaign')}
                            </span>
                        </div>
                    )}
                </div>

                {/* Job Details Form - Dynamic Criteria Selection */}
                {showJobDetailsForm ? (
                    <div style={{ 
                        flex: 1, 
                        display: 'flex', 
                        flexDirection: 'column', 
                        minHeight: 0,
                        overflowY: 'auto',
                        overflowX: 'hidden'
                    }}>
                        {/* General Error */}
                        {errors.general && (
                            <div
                                className="ni-feedback-banner ni-feedback-banner--error"
                                style={{
                                padding: '14px 18px',
                                background: NT.itemBg,
                                border: '1px solid rgba(239, 68, 68, 0.4)',
                                borderRadius: NT.radius,
                                marginBottom: '18px',
                                boxShadow: '0 2px 8px rgba(239, 68, 68, 0.15)'
                            }}>
                                <span style={{ color: '#EF4444', fontSize: '13px', fontWeight: 600 }}>{errors.general}</span>
                            </div>
                        )}

                        {/* General (public link) flow: hint + generated link box — Call AI agent → General tab */}
                        {isGeneralAudio && (
                            <p style={{ margin: '0 0 16px', fontSize: '13px', color: NT.meta, lineHeight: 1.6 }}>
                                {t('newCampaign_audioGeneralHint')}
                            </p>
                        )}
                        {/* CV auto-fill — Specific audio/video only: رفع سيرة ذاتية لتعبئة الحقول */}
                        {isSpecificAudioOrVideo && (
                            <div className="ni-cv-upload" style={{ marginBottom: '18px' }}>
                                <input
                                    ref={cvFileInputRef}
                                    type="file"
                                    accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                                    onChange={handleCvFileSelected}
                                    className="ni-cv-upload__input"
                                />
                                <button
                                    type="button"
                                    className={[
                                        'ni-cv-upload-btn',
                                        cvParsing && 'ni-cv-upload-btn--loading',
                                        !cvParseError && cvFilledCount > 0 && 'ni-cv-upload-btn--success',
                                    ].filter(Boolean).join(' ')}
                                    onClick={() => cvFileInputRef.current?.click()}
                                    disabled={cvParsing}
                                    aria-busy={cvParsing || undefined}
                                >
                                    <span className="ni-cv-upload-btn__icon-wrap" aria-hidden="true">
                                        {cvParsing ? (
                                            <svg className="ni-cv-upload-btn__spinner" viewBox="0 0 24 24" fill="none">
                                                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
                                                <path d="M12 3a9 9 0 019 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                            </svg>
                                        ) : (
                                            <svg className="ni-cv-upload-btn__doc-icon" viewBox="0 0 24 24" fill="none">
                                                <path
                                                    d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"
                                                    stroke="currentColor"
                                                    strokeWidth="1.75"
                                                    strokeLinejoin="round"
                                                />
                                                <path d="M14 2v6h6M9 13h6M9 17h4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                                            </svg>
                                        )}
                                    </span>
                                    <span className="ni-cv-upload-btn__body">
                                        <span className="ni-cv-upload-btn__title">
                                            {cvParsing
                                                ? t('newCampaign_cvUpload_parsing')
                                                : t('newCampaign_cvUpload_button')}
                                        </span>
                                        {!cvParsing && (
                                            <span className="ni-cv-upload-btn__hint">
                                                {t('newCampaign_cvUpload_hint')}
                                            </span>
                                        )}
                                    </span>
                                </button>
                                {cvParseError && (
                                    <div
                                        className="ni-feedback-banner ni-feedback-banner--error"
                                        style={{
                                            marginTop: '10px',
                                            padding: '10px 14px',
                                            background: NT.itemBg,
                                            border: '1px solid rgba(239, 68, 68, 0.4)',
                                            borderRadius: NT.radius,
                                        }}
                                    >
                                        <span style={{ color: '#EF4444', fontSize: '12px', fontWeight: 600 }}>
                                            {cvParseError}
                                        </span>
                                    </div>
                                )}
                                {!cvParseError && cvFilledCount > 0 && (
                                    <div
                                        className="ni-feedback-banner ni-feedback-banner--success"
                                        style={{
                                            marginTop: '10px',
                                            padding: '10px 14px',
                                            background: NT.itemBg,
                                            border: '1px solid rgba(34, 197, 94, 0.4)',
                                            borderRadius: NT.radius,
                                        }}
                                    >
                                        <span style={{ color: '#22C55E', fontSize: '12px', fontWeight: 600 }}>
                                            {t('newCampaign_cvUpload_success')}
                                            {cvDetectedPosition
                                                ? ` — ${t('newCampaign_ac_position_applied_for_label')}: ${cvDetectedPosition}`
                                                : ''}
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}
                        {/* Criteria List - Compact Grid Layout */}
                        <div
                            className="ni-criteria-grid"
                            style={{ 
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                            gap: '12px',
                            flex: '0 0 auto',
                            paddingBottom: '16px'
                        }}>
                            {(isScreeningFlow
                                ? activeJobCriteria.filter((c) => addedOrder.includes(c.id))
                                : activeJobCriteria
                            ).map((criterion) => {
                                const isSelected = selectedCriteria[criterion.id];
                                const value = jobDetails[criterion.id] || '';
                                const hasError = errors[criterion.id];
                                
                                return (
                                    <div
                                        key={criterion.id}
                                        className={`ni-criteria-card${isSelected ? ' ni-criteria-card--selected' : ''}`}
                                        style={{
                                        padding: '14px 16px',
                                        borderRadius: NT.radiusLg,
                                        transition: 'all 0.25s ease',
                                        animation: 'slideIn 0.3s ease',
                                        ...((criterion.id === 'certifications' || criterion.id === 'skills' || criterion.id === 'languages' || criterion.id === 'aiCompareTop') && isSelected ? { gridColumn: '1 / -1' } : {})
                                    }}>
                                        {/* Toggle Switch */}
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            marginBottom: isSelected ? '10px' : '0'
                                        }}>
                                <label className="ni-criteria-label" style={{
                                    fontSize: '13px',
                                    fontWeight: 600,
                                                cursor: 'pointer',
                                                flex: 1,
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px'
                                            }}>
                                <input
                                    type="checkbox"
                                    checked={Boolean(isSelected)}
                                    onChange={() => (isScreeningFlow ? handleRemovePresetFromScreening(criterion.id) : toggleCriterion(criterion.id))}
                                    style={{
                                        width: '18px',
                                        height: '18px',
                                        cursor: 'pointer',
                                        accentColor: '#22d3ee',
                                        flexShrink: 0
                                    }}
                                />
                                                <span className="ni-criteria-label" style={{
                                                    fontSize: '13px',
                                                    fontWeight: 600,
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '6px',
                                                    textTransform: 'none',
                                                    letterSpacing: 'normal',
                                                }}>
                                                    {criterion.id === 'aiCompareTop' && (
                                                        <AiSparkIcon size={15} className="ni-ai-compare-spark-inline" />
                                                    )}
                                                    {criterion.label}
                                                </span>
                                            </label>
                            </div>

                                        {/* Input Field - Shows when selected */}
                                        {isSelected && criterion.id !== 'certifications' && criterion.id !== 'skills' && criterion.id !== 'languages' && (
                                            <div style={{
                                                animation: 'slideIn 0.3s ease',
                                                marginTop: '10px'
                                            }}>
                                {criterion.id === 'position' ? (
                                    <>
                                    <PositionSuggestCombobox
                                        id="ni-sidebar-position-input"
                                        name={criterion.id}
                                        catalogMode="roleOnly"
                                        value={jobDetails.roleKey ?? ''}
                                        onChange={(e) => handleRoleKeySelect(e.target.value)}
                                        onRoleResolved={applyJobRoleResolution}
                                        placeholder={criterion.placeholder}
                                        showResolutionHint={false}
                                        listboxId="ni-sidebar-position-suggestions"
                                        wrapperClassName="position-suggest--sidebar-wide"
                                        {...criteriaComboboxProps(hasError)}
                                    />
                                    {positionSectionHint ? (
                                        <span
                                            className="ni-criteria-section-hint"
                                            style={{
                                                display: 'block',
                                                fontSize: '11px',
                                                color: criteriaInputTokens.sectionHint,
                                                fontWeight: 500,
                                                marginTop: '4px',
                                                paddingLeft: '2px',
                                            }}
                                        >
                                            {t('jobRole_section_label')}: {positionSectionHint}
                                        </span>
                                    ) : null}
                                    {showResearchDomainField ? (
                                        <input
                                            type="text"
                                            list="ni-research-domain-options"
                                            value={jobDetails.researchDomain ?? ''}
                                            onChange={(e) => handleInputChange('researchDomain', e.target.value)}
                                            placeholder="Research domain (optional): Energy, Market Intelligence…"
                                            {...criteriaTextInputProps(false, {
                                                marginTop: '8px',
                                                padding: '8px 12px',
                                                fontSize: '12px',
                                                transition: 'border-color 0.2s ease, background 0.2s ease',
                                            })}
                                        />
                                    ) : null}
                                    {showResearchDomainField ? (
                                        <datalist id="ni-research-domain-options">
                                            {RESEARCH_DOMAIN_OPTIONS.map((d) => (
                                                <option key={d} value={d} />
                                            ))}
                                        </datalist>
                                    ) : null}
                                    </>
                                ) : criterion.id === 'position_applied_for' || criterion.id === 'positionAppliedFor' ? (
                                    <JobRoleFields
                                        roleKey={jobDetails.roleKey ?? ''}
                                        careerLevel={jobDetails.careerLevel ?? ''}
                                        researchDomain={jobDetails.researchDomain ?? ''}
                                        showLevelField={false}
                                        roleInputId="ni-sidebar-position-applied-input"
                                        levelInputId="ni-sidebar-position-applied-level"
                                        roleListboxId="ni-sidebar-position-applied-suggestions"
                                        rolePlaceholder={criterion.placeholder}
                                        levelPlaceholder={t('jobRole_level_placeholder')}
                                        onStateChange={setJobDetails}
                                        onRoleResolved={(resolution) => {
                                            if (!resolution?.roleKey) return;
                                            setJobDetails((prev) => ({
                                                ...applyRoleResolutionToState(prev, resolution),
                                                position_applied_for: resolution.displayTitle,
                                            }));
                                        }}
                                        roleWrapperClassName="position-suggest--sidebar-wide"
                                        levelWrapperClassName="position-suggest--sidebar-wide"
                                        roleInputClassName={hasError ? 'ni-criteria-input--error' : ''}
                                        levelInputClassName={hasError ? 'ni-criteria-input--error' : ''}
                                        roleInputStyle={criteriaComboboxProps(hasError).inputStyle}
                                        roleChevronStyle={criteriaComboboxProps(hasError).chevronStyle}
                                        roleOnFocus={criteriaComboboxProps(hasError).onFocus}
                                        roleOnBlur={criteriaComboboxProps(hasError).onBlur}
                                        disabled={false}
                                    />
                                ) : criterion.id === 'job' || criterion.id === 'job_level' ? (
                                    renderCareerLevelField(
                                        criterion,
                                        hasError,
                                        criterion.id === 'job_level' ? 'ni-sidebar-position-job-level' : 'ni-sidebar-job-level',
                                        !jobDetails.roleKey ? t('jobRole_pickPositionFirst') : undefined
                                    )
                                ) : criterion.id === 'location' ? (
                                    <PositionSuggestCombobox
                                        id="ni-sidebar-location-input"
                                        name={criterion.id}
                                        value={value ?? ''}
                                        onChange={(e) => handleInputChange(criterion.id, e.target.value)}
                                        placeholder={criterion.placeholder}
                                        suggestionOptions={governorateSuggestionOptions}
                                        listboxId="ni-sidebar-location-suggestions"
                                        wrapperClassName="position-suggest--sidebar-wide"
                                        {...criteriaComboboxProps(hasError)}
                                    />
                                ) : criterion.id === 'gender' ? (
                                    <PositionSuggestCombobox
                                        id="ni-sidebar-gender-input"
                                        name={criterion.id}
                                        value={value ?? ''}
                                        onChange={(e) => handleInputChange(criterion.id, e.target.value)}
                                        suggestionOptions={genderOptionsLocalized}
                                        placeholder={criterion.placeholder}
                                        listboxId="ni-sidebar-gender-suggestions"
                                        wrapperClassName="position-suggest--sidebar-wide"
                                        {...criteriaComboboxProps(hasError)}
                                    />
                                ) : criterion.id === 'age' ? (
                                    <PositionSuggestCombobox
                                        id="ni-sidebar-age-input"
                                        name={criterion.id}
                                        value={value ?? ''}
                                        onChange={(e) => handleInputChange(criterion.id, e.target.value)}
                                        suggestionOptions={ageRangeOptionsLocalized}
                                        placeholder={criterion.placeholder}
                                        listboxId="ni-sidebar-age-suggestions"
                                        wrapperClassName="position-suggest--sidebar-wide"
                                        {...criteriaComboboxProps(hasError)}
                                    />
                                ) : criterion.id === 'educationLevel' || criterion.id === 'highest_education_level' || criterion.id === 'highestEducationLevel' ? (
                                    <PositionSuggestCombobox
                                        id={criterion.id === 'highest_education_level' || criterion.id === 'highestEducationLevel' ? 'ni-sidebar-highest-education-input' : 'ni-sidebar-education-input'}
                                        name={criterion.id}
                                        value={value ?? ''}
                                        onChange={(e) => handleInputChange(criterion.id, e.target.value)}
                                        suggestionOptions={educationOptionsLocalized}
                                        placeholder={criterion.placeholder}
                                        listboxId={criterion.id === 'highest_education_level' || criterion.id === 'highestEducationLevel' ? 'ni-sidebar-highest-education-suggestions' : 'ni-sidebar-education-suggestions'}
                                        wrapperClassName="position-suggest--sidebar-wide"
                                        {...criteriaComboboxProps(hasError)}
                                    />
                                ) : criterion.id === 'aiCompareTop' ? (
                                    <>
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'flex-start',
                                            gap: '8px',
                                            padding: '10px 12px',
                                            marginBottom: '10px',
                                            background: 'rgba(56, 189, 248, 0.08)',
                                            border: '1px solid rgba(56, 189, 248, 0.25)',
                                            borderRadius: NT.radius,
                                        }}>
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden style={{ flexShrink: 0, marginTop: '1px', color: 'rgba(56, 189, 248, 0.95)' }}>
                                                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                            </svg>
                                            <span style={{ fontSize: '12px', lineHeight: 1.5, color: NT.meta }}>
                                                {t('newCampaign_jc_aiCompareTop_hint')}
                                            </span>
                                        </div>
                                        {aiCompareEmailRows.map((rowVal, emailIndex) => {
                                            const rowErr = emailIndex === 0 && errors.aiCompareTop;
                                            return (
                                                <div
                                                    key={emailIndex}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'flex-start',
                                                        gap: '8px',
                                                        marginTop: emailIndex === 0 ? 0 : '10px'
                                                    }}
                                                >
                                                    <input
                                                        type="email"
                                                        value={rowVal ?? ''}
                                                        onChange={(e) => updateAiCompareEmailRow(emailIndex, e.target.value)}
                                                        placeholder={emailIndex === 0 ? criterion.placeholder : `${t('newCampaign_jc_aiCompareTop_emailRowPh')} ${emailIndex + 1}`}
                                                        autoComplete="email"
                                                        inputMode="email"
                                                        {...criteriaTextInputProps(rowErr, {
                                                            flex: '1 1 auto',
                                                            minWidth: 0,
                                                            transition: 'border-color 0.2s ease, background 0.2s ease',
                                                        })}
                                                    />
                                                    {aiCompareEmailRows.length > 1 && (
                                                        <button
                                                            type="button"
                                                            onClick={() => removeAiCompareEmailRow(emailIndex)}
                                                            title={t('newCampaign_jc_aiCompareTop_removeTitle')}
                                                            aria-label={`${t('newCampaign_jc_aiCompareTop_removeRowAria')} ${emailIndex + 1}`}
                                                            className="btn btn-secondary dashboard-delete-btn"
                                                            style={{ flexShrink: 0 }}
                                                        >
                                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                                                                <path d="M6 12h12" stroke="#EF4444" strokeWidth="2" strokeLinecap="round"/>
                                                            </svg>
                                                        </button>
                                                    )}
                                                </div>
                                            );
                                        })}
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '10px',
                                            marginTop: '12px',
                                            flexWrap: 'wrap'
                                        }}>
                                            <button
                                                type="button"
                                                onClick={addAiCompareEmailRow}
                                                title={t('newCampaign_jc_aiCompareTop_addEmailAria')}
                                                aria-label={t('newCampaign_jc_aiCompareTop_addEmailAria')}
                                                className="btn btn-secondary dashboard-delete-btn"
                                            >
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                                                    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                                </svg>
                                            </button>
                                            <span className="ni-criteria-label" style={{ fontSize: '12px', fontWeight: 600 }}>
                                                {t('newCampaign_jc_aiCompareTop_addEmail')}
                                            </span>
                                            <span style={{ fontSize: '11px', color: '#94A3B8' }}>{t('newCampaign_jc_aiCompareTop_multiHint')}</span>
                                        </div>
                                    </>
                                ) : criterion.id === 'experienceYears' || criterion.id === 'years_of_experience' || criterion.id === 'yearsOfExperience' ? (
                                    <PositionSuggestCombobox
                                        id={criterion.id === 'years_of_experience' || criterion.id === 'yearsOfExperience' ? 'ni-sidebar-years-experience-input' : 'ni-sidebar-experience-years-input'}
                                        name={criterion.id}
                                        value={value ?? ''}
                                        onChange={(e) => handleInputChange(criterion.id, e.target.value)}
                                        suggestionOptions={experienceOptionsLocalized}
                                        placeholder={criterion.placeholder}
                                        listboxId={criterion.id === 'years_of_experience' || criterion.id === 'yearsOfExperience' ? 'ni-sidebar-years-experience-suggestions' : 'ni-sidebar-experience-years-suggestions'}
                                        wrapperClassName="position-suggest--sidebar-wide"
                                        {...criteriaComboboxProps(hasError)}
                                    />
                                ) : (
                                <input
                                    type={criterion.type}
                                    value={value ?? ''}
                                    onChange={(e) => handleInputChange(criterion.id, e.target.value)}
                                    placeholder={criterion.placeholder}
                                    {...criteriaTextInputProps(hasError)}
                                />
                                )}
                                                {hasError && (
                                                    <span style={{ color: '#EF4444', fontSize: '11px', marginTop: '6px', display: 'block', fontWeight: 600 }}>
                                                        {hasError}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                        {isSelected && criterion.id === 'certifications' && (
                                            <div style={{ marginTop: '10px' }}>
                                                {certificationRows.map((rowVal, certIndex) => {
                                                    const rowErr = certIndex === 0 && errors.certifications;
                                                    return (
                                                        <div
                                                            key={certIndex}
                                                            style={{
                                                                display: 'flex',
                                                                alignItems: 'flex-start',
                                                                gap: '8px',
                                                                marginTop: certIndex === 0 ? 0 : '10px'
                                                            }}
                                                        >
                                                            <input
                                                                type="text"
                                                                value={rowVal ?? ''}
                                                                onChange={(e) => updateCertificationRow(certIndex, e.target.value)}
                                                                placeholder={certIndex === 0 ? criterion.placeholder : `${t('newCampaign_jc_certifications_rowPh')} ${certIndex + 1}`}
                                                                {...criteriaTextInputProps(rowErr, {
                                                                    flex: '1 1 auto',
                                                                    minWidth: 0,
                                                                    maxWidth: 'min(100%, 400px)',
                                                                    transition: 'border-color 0.2s ease, background 0.2s ease',
                                                                })}
                                                            />
                                                            {certificationRows.length > 1 && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => removeCertificationRow(certIndex)}
                                                                    title={t('newCampaign_rowRemoveTitle')}
                                                                    aria-label={`${t('newCampaign_jc_certifications_removeRowAria')} ${certIndex + 1}`}
                                                                    className="btn btn-secondary dashboard-delete-btn"
                                                                    style={{ flexShrink: 0 }}
                                                                >
                                                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                                                                        <path d="M6 12h12" stroke="#EF4444" strokeWidth="2" strokeLinecap="round"/>
                                                                    </svg>
                                                                </button>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                                <div style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '10px',
                                                    marginTop: '12px',
                                                    flexWrap: 'wrap'
                                                }}>
                                                    <button
                                                        type="button"
                                                        onClick={addCertificationRow}
                                                        title={t('newCampaign_jc_certifications_addAria')}
                                                        aria-label={t('newCampaign_jc_certifications_addAria')}
                                                        className="btn btn-secondary dashboard-delete-btn"
                                                    >
                                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                                                            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                                        </svg>
                                                    </button>
                                                    <span className="ni-criteria-label" style={{ fontSize: '12px', fontWeight: 600 }}>
                                                        {t('newCampaign_jc_certifications_add')}
                                                    </span>
                                                    <span style={{ fontSize: '11px', color: '#94A3B8' }}>{t('newCampaign_jc_certifications_multiHint')}</span>
                                                </div>
                                                {errors.certifications && (
                                                    <span style={{ color: '#EF4444', fontSize: '11px', marginTop: '8px', display: 'block', fontWeight: 600 }}>
                                                        {errors.certifications}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                        {isSelected && criterion.id === 'skills' && (
                                            <div style={{ marginTop: '10px' }}>
                                                {skillRows.map((rowVal, skillIndex) => {
                                                    const rowErr = skillIndex === 0 && errors.skills;
                                                    return (
                                                        <div
                                                            key={skillIndex}
                                                            style={{
                                                                display: 'flex',
                                                                alignItems: 'flex-start',
                                                                gap: '8px',
                                                                marginTop: skillIndex === 0 ? 0 : '10px'
                                                            }}
                                                        >
                                                            <div
                                                                style={{
                                                                    flex: '1 1 auto',
                                                                    minWidth: 0,
                                                                    maxWidth: 'min(100%, 400px)',
                                                                    width: '100%',
                                                                }}
                                                            >
                                                                <PositionSuggestCombobox
                                                                    id={`ni-sidebar-skill-${skillIndex}`}
                                                                    name={`skill-${skillIndex}`}
                                                                    value={rowVal ?? ''}
                                                                    onChange={(e) => updateSkillRow(skillIndex, e.target.value)}
                                                                    suggestionOptions={skillSuggestionOptions}
                                                                    placeholder={
                                                                        skillIndex === 0
                                                                            ? criterion.placeholder
                                                                            : `${t('newCampaign_jc_skills_rowPh')} ${skillIndex + 1} (▼)`
                                                                    }
                                                                    listboxId={`ni-sidebar-skill-suggestions-${skillIndex}`}
                                                                    wrapperClassName="position-suggest--sidebar-wide"
                                                                    {...criteriaComboboxProps(rowErr)}
                                                                />
                                                            </div>
                                                            {skillRows.length > 1 && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => removeSkillRow(skillIndex)}
                                                                    title={t('newCampaign_rowRemoveTitle')}
                                                                    aria-label={`${t('newCampaign_jc_skills_removeRowAria')} ${skillIndex + 1}`}
                                                                    className="btn btn-secondary dashboard-delete-btn"
                                                                    style={{ flexShrink: 0 }}
                                                                >
                                                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                                                                        <path d="M6 12h12" stroke="#EF4444" strokeWidth="2" strokeLinecap="round"/>
                                                                    </svg>
                                                                </button>
                                        )}
                                    </div>
                                );
                            })}
                        <div style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '10px',
                                                    marginTop: '12px',
                                                    flexWrap: 'wrap'
                                                }}>
                                                    <button
                                                        type="button"
                                                        onClick={addSkillRow}
                                                        title={t('newCampaign_jc_skills_addAria')}
                                                        aria-label={t('newCampaign_jc_skills_addAria')}
                                                        className="btn btn-secondary dashboard-delete-btn"
                                                    >
                                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                                                            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                                        </svg>
                                                    </button>
                                                    <span className="ni-criteria-label" style={{ fontSize: '12px', fontWeight: 600 }}>
                                                        {t('newCampaign_jc_skills_add')}
                                                    </span>
                                                    <span style={{ fontSize: '11px', color: '#94A3B8' }}>{t('newCampaign_jc_skills_multiHint')}</span>
                            </div>
                                                {errors.skills && (
                                                    <span style={{ color: '#EF4444', fontSize: '11px', marginTop: '8px', display: 'block', fontWeight: 600 }}>
                                                        {errors.skills}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                        {isSelected && criterion.id === 'languages' && (
                                            <div style={{ marginTop: '10px' }}>
                                                {languageRows.map((rowVal, langIndex) => {
                                                    const rowErr = langIndex === 0 && errors.languages;
                                                    return (
                                                        <div
                                                            key={langIndex}
                                                            style={{
                                                                display: 'flex',
                                                                alignItems: 'flex-start',
                                                                gap: '8px',
                                                                marginTop: langIndex === 0 ? 0 : '10px'
                                                            }}
                                                        >
                                                            <div
                                                                style={{
                                                                    flex: '1 1 auto',
                                                                    minWidth: 0,
                                                                    maxWidth: 'min(100%, 400px)',
                                                                    width: '100%',
                                                                }}
                                                            >
                                                                <PositionSuggestCombobox
                                                                    id={`ni-sidebar-language-${langIndex}`}
                                                                    name={`language-${langIndex}`}
                                                                    value={rowVal ?? ''}
                                                                    onChange={(e) => updateLanguageRow(langIndex, e.target.value)}
                                                                    suggestionOptions={languageSuggestionOptions}
                                                                    placeholder={
                                                                        langIndex === 0
                                                                            ? criterion.placeholder
                                                                            : `${t('newCampaign_jc_languages_rowPh')} ${langIndex + 1} (▼)`
                                                                    }
                                                                    listboxId={`ni-sidebar-language-suggestions-${langIndex}`}
                                                                    wrapperClassName="position-suggest--sidebar-wide"
                                                                    {...criteriaComboboxProps(rowErr)}
                                                                />
                                                            </div>
                                                            {languageRows.length > 1 && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => removeLanguageRow(langIndex)}
                                                                    title={t('newCampaign_rowRemoveTitle')}
                                                                    aria-label={`${t('newCampaign_jc_languages_removeRowAria')} ${langIndex + 1}`}
                                                                    className="btn btn-secondary dashboard-delete-btn"
                                                                    style={{ flexShrink: 0 }}
                                                                >
                                                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                                                                        <path d="M6 12h12" stroke="#EF4444" strokeWidth="2" strokeLinecap="round"/>
                                                                    </svg>
                                                                </button>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                        <div style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '10px',
                                                    marginTop: '12px',
                                                    flexWrap: 'wrap'
                                                }}>
                                                    <button
                                                        type="button"
                                                        onClick={addLanguageRow}
                                                        title={t('newCampaign_jc_languages_addAria')}
                                                        aria-label={t('newCampaign_jc_languages_addAria')}
                                                        className="btn btn-secondary dashboard-delete-btn"
                                                    >
                                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                                                            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                                        </svg>
                                                    </button>
                                                    <span className="ni-criteria-label" style={{ fontSize: '12px', fontWeight: 600 }}>
                                                        {t('newCampaign_jc_languages_add')}
                                                    </span>
                                                    <span style={{ fontSize: '11px', color: '#94A3B8' }}>{t('newCampaign_jc_languages_multiHint')}</span>
                                                </div>
                                                {errors.languages && (
                                                    <span style={{ color: '#EF4444', fontSize: '11px', marginTop: '8px', display: 'block', fontWeight: 600 }}>
                                                        {errors.languages}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            {isScreeningFlow &&
                                customCriteria.map((c) => {
                                    const hasError = errors[c.id];
                                    return (
                                        <div
                                            key={c.id}
                                            style={{
                                                padding: '14px 16px',
                                                background: NT.criteriaCardOn,
                                                borderRadius: NT.radiusLg,
                                                border: NT.criteriaBorderOn,
                                                transition: 'all 0.25s ease',
                                                animation: 'slideIn 0.3s ease',
                                                boxShadow:
                                                    '0 4px 16px rgba(56, 189, 248, 0.2), 0 0 20px rgba(56, 189, 248, 0.12)',
                                            }}
                                        >
                                            <div
                                                style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px',
                                                    marginBottom: '10px',
                                                }}
                                            >
                                                <span
                                                    className="ni-criteria-label"
                                                    style={{
                                                        fontSize: '13px',
                                                        fontWeight: 600,
                                                        flex: 1,
                                                        minWidth: 0,
                                                    }}
                                                >
                                                    {c.label}
                                                    <span
                                                        style={{
                                                            marginInlineStart: '8px',
                                                            fontSize: '11px',
                                                            color: 'rgba(148, 163, 184, 0.9)',
                                                            fontWeight: 500,
                                                        }}
                                                    >
                                                        {t('newCampaign_customCriterionBadge')}
                                                    </span>
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveCustomCriterion(c.id)}
                                                    title={t('newCampaign_customCriterionRemoveTitle')}
                                                    aria-label={fillI18nTemplate(t('newCampaign_customCriterionRemoveAria'), { label: c.label })}
                                                    className="btn btn-secondary dashboard-delete-btn"
                                                    style={{ flexShrink: 0 }}
                                                >
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                                                        <path d="M6 12h12" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" />
                                                    </svg>
                                                </button>
                            </div>
                            <label
                                                className="ni-criteria-label"
                                                htmlFor={`ni-custom-expectation-${c.id}`}
                                style={{
                                                    display: 'block',
                                                    fontSize: '11px',
                                                    fontWeight: 600,
                                                    color: 'rgba(148, 163, 184, 0.95)',
                                                    marginBottom: '6px',
                                                }}
                                            >
                                                {t('newCampaign_customCriterionExpectationLabel')}
                                            </label>
                                <input
                                                id={`ni-custom-expectation-${c.id}`}
                                                type="text"
                                                value={c.expectation ?? ''}
                                                onChange={(e) => handleUpdateCustomCriterion(c.id, e.target.value)}
                                                placeholder={t('newCampaign_customCriterionExpectationPlaceholder')}
                                                {...criteriaTextInputProps(hasError)}
                                            />
                                            {hasError && (
                                                <span
                                                    style={{
                                                        color: '#EF4444',
                                                        fontSize: '11px',
                                                        marginTop: '6px',
                                                        display: 'block',
                                                        fontWeight: 600,
                                                    }}
                                                >
                                                    {hasError}
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                        {isScreeningFlow && (
                            <div style={{ position: 'relative', marginBottom: '18px' }}>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setAddMenuOpen((o) => !o);
                                        setAddMenuCustomMode(false);
                                        setCustomLabelDraft('');
                                    }}
                                    aria-haspopup="menu"
                                    aria-expanded={addMenuOpen}
                                    aria-label={
                                        addedOrder.length === 0 && customCriteria.length === 0
                                            ? 'Add criterion'
                                            : 'Add another criterion'
                                    }
                                    title={
                                        addedOrder.length === 0 && customCriteria.length === 0
                                            ? 'Add criterion'
                                            : 'Add another criterion'
                                    }
                                    className={`design-add-question-plus-btn design-add-question-plus-btn--icon-only${addMenuOpen ? ' design-add-question-plus-btn--open' : ''}`}
                                >
                                    <svg
                                        className="design-add-question-plus-icon"
                                        width="32"
                                        height="32"
                                        viewBox="0 0 64 64"
                                        fill="none"
                                        xmlns="http://www.w3.org/2000/svg"
                                        aria-hidden
                                    >
                                        <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="2.5" opacity="0.3" />
                                        <path
                                            d="M32 18V46M18 32H46"
                                            stroke="currentColor"
                                            strokeWidth="3"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        />
                                    </svg>
                                </button>

                                {addMenuOpen && (
                                    <>
                                        <div
                                            onClick={() => {
                                                setAddMenuOpen(false);
                                                setAddMenuCustomMode(false);
                                                setCustomLabelDraft('');
                                    }}
                                    style={{
                                                position: 'fixed',
                                                inset: 0,
                                                zIndex: 20,
                                                background: 'transparent',
                                            }}
                                        />
                                        <div role="menu" className="ni-criterion-menu">
                                            {!addMenuCustomMode ? (
                                                <>
                                                    <div className="ni-criterion-menu__header">
                                                        <span className="ni-criterion-menu__header-title">
                                                            {t('newCampaign_criterionMenuTitle')}
                                </span>
                                                    </div>
                                                    <div className="ni-criterion-menu__body">
                                                        {(() => {
                                                            const available = activeJobCriteria.filter(
                                                                (c) => !addedOrder.includes(c.id)
                                                            );
                                                            if (available.length === 0) {
                                                                return (
                                                                    <div className="ni-criterion-menu__empty">
                                                                        {t('newCampaign_criterionMenuAllAdded')}
                                                                    </div>
                                                                );
                                                            }
                                                            const byId = Object.fromEntries(available.map((c) => [c.id, c]));
                                                            return CRITERION_MENU_GROUPS.map((group) => {
                                                                const items = group.ids
                                                                    .map((id) => byId[id])
                                                                    .filter(Boolean);
                                                                if (!items.length) return null;
                                                                return (
                                                                    <div key={group.id} className="ni-criterion-menu__section">
                                                                        <div className="ni-criterion-menu__section-title">
                                                                            {t(group.labelKey)}
                                                                        </div>
                                                                        <div className="ni-criterion-menu__grid">
                                                                            {items.map((c) => (
                                                            <button
                                                                key={c.id}
                                                                type="button"
                                                                role="menuitem"
                                                                data-criterion={c.id}
                                                                onClick={() => handleAddPresetCriterion(c.id)}
                                                                                    className="ni-criterion-menu__item"
                                                                                >
                                                                                    <span className="ni-criterion-menu__item-icon" aria-hidden>
                                                                                        <CriterionMenuIcon id={c.id} />
                                                                                    </span>
                                                                                    <span className="ni-criterion-menu__item-label">{c.label}</span>
                                                            </button>
                                                        ))}
                                                        </div>
                                                                    </div>
                                                                );
                                                            });
                                                        })()}
                                                    </div>
                                                    <div className="ni-criterion-menu__footer">
                                                    <button
                                                        type="button"
                                                        role="menuitem"
                                                        onClick={() => {
                                                            setAddMenuCustomMode(true);
                                                            setCustomLabelDraft('');
                                                        }}
                                                            className="ni-criterion-menu__item ni-criterion-menu__item--accent"
                                                        >
                                                            <span className="ni-criterion-menu__item-icon" aria-hidden>
                                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                                            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                                                        </svg>
                                                            </span>
                                                            <span className="ni-criterion-menu__item-label">
                                                                {t('newCampaign_criterionMenuCustom')}
                                                            </span>
                                                    </button>
                                                    </div>
                                                </>
                                            ) : (
                                                <div className="ni-criterion-menu__custom">
                                                    <label className="ni-criterion-menu__label" htmlFor="ni-custom-criterion-name">
                                                        {t('newCampaign_criterionMenuCustomLabel')}
                            </label>
                                                    <div
                                style={{
                                    display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '8px',
                                                        }}
                                                    >
                                                    <input
                                                            id="ni-custom-criterion-name"
                                                        type="text"
                                                        autoFocus
                                                        value={customLabelDraft}
                                                        onChange={(e) => setCustomLabelDraft(e.target.value)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                                e.preventDefault();
                                                                handleAddCustomCriterion();
                                                            } else if (e.key === 'Escape') {
                                                                setAddMenuOpen(false);
                                                                setAddMenuCustomMode(false);
                                                                setCustomLabelDraft('');
                                                            }
                                                        }}
                                                            placeholder={t('newCampaign_criterionMenuCustomPlaceholder')}
                                                        {...criteriaTextInputProps(false, {
                                                                flex: '1 1 auto',
                                                                minWidth: 0,
                                                                maxWidth: 'min(100%, 320px)',
                                                                padding: '8px 12px',
                                                                fontSize: '12px',
                                                                transition: 'border-color 0.2s ease, background 0.2s ease',
                                                        })}
                                                    />
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setAddMenuCustomMode(false);
                                                                setCustomLabelDraft('');
                                                            }}
                                                            title={t('newCampaign_rowRemoveTitle')}
                                                            aria-label={t('newCampaign_criterionMenuBack')}
                                                            className="btn btn-secondary dashboard-delete-btn"
                                                            style={{ flexShrink: 0 }}
                                                        >
                                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                                                                <path d="M6 12h12" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                    <div
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            marginTop: '10px',
                                                        }}
                                                    >
                                                        <button
                                                            type="button"
                                                            onClick={handleAddCustomCriterion}
                                                            disabled={!customLabelDraft.trim()}
                                                            title={t('newCampaign_criterionMenuAdd')}
                                                            aria-label={t('newCampaign_criterionMenuAdd')}
                                                            className="btn btn-secondary dashboard-delete-btn"
                                                            style={{
                                                                flexShrink: 0,
                                                                opacity: customLabelDraft.trim() ? 1 : 0.45,
                                                                cursor: customLabelDraft.trim() ? 'pointer' : 'not-allowed',
                                                            }}
                                                        >
                                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                                                                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {/* Job Advertisement — مخفى في «محدد» (صوت/فيديو)؛ يبقى في General (صوت/فيديو) وStart Process */}
                        {!(
                            (selectedInterviewType === 'audio' && audioFlowTab === 'specific') ||
                            (selectedInterviewType === 'video' && videoFlowTab === 'specific')
                        ) && (
                        <div className="ni-job-ad-section">
                            <div className="ni-job-ad-block">
                            <h4 className="ni-job-ad-heading" style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px',
                                fontSize: '14px',
                                fontWeight: 700,
                                    color: NT.title,
                                marginBottom: '12px',
                                textTransform: currentLang === 'en' ? 'uppercase' : 'none',
                                letterSpacing: currentLang === 'en' ? '0.5px' : '0',
                                flexWrap: 'wrap'
                            }}>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                                        <HeroJobAdFormIcon size={22} />
                                        {t('newCampaign_jobAdHeading')}
                                    </span>
                                    <div
                                        ref={adLangPickerRef}
                                        className={`ni-ad-lang-picker-wrap${showAdLangMenu ? ' ni-ad-lang-picker-wrap--open' : ''}`}
                                        style={{ textTransform: 'none', letterSpacing: 0 }}
                                    >
                                        <button
                                            type="button"
                                            className={`ni-job-ad-toolbar-btn ni-ad-lang-picker__btn${showAdLangMenu ? ' ni-ad-lang-picker__btn--open' : ''}`}
                                            onClick={() => {
                                                setShowAdLangMenu(!showAdLangMenu);
                                            }}
                                            disabled={generatingAd}
                                            title={`Language: ${AD_LANGUAGES.find((l) => l.id === adLanguage)?.label || adLanguage}`}
                                            aria-label="Choose advertisement language"
                                            aria-haspopup="listbox"
                                            aria-controls={showAdLangMenu ? 'ni-ad-lang-listbox' : undefined}
                                            aria-expanded={showAdLangMenu}
                                        >
                                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                                                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6"/>
                                                <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                                            </svg>
                                        </button>
                                        {showAdLangMenu && !generatingAd && (
                                            <div
                                                id="ni-ad-lang-listbox"
                                                role="listbox"
                                                aria-label="Advertisement language"
                                                className="language-dropdown-menu position-suggest-dropdown ni-ad-lang-dropdown active"
                                            >
                                                {AD_LANGUAGES.map((l) => (
                                                    <button
                                                        key={l.id}
                                                        type="button"
                                                        role="option"
                                                        data-lang={l.dataLang}
                                                        aria-selected={l.id === adLanguage}
                                                        className={`language-option${l.id === adLanguage ? ' active' : ''}`}
                                                        onMouseDown={(e) => e.preventDefault()}
                                                        onClick={() => {
                                                            setAdLanguage(l.id);
                                                            setShowAdLangMenu(false);
                                                        }}
                                                    >
                                                        <span className="language-name">{l.label}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                            </h4>
                                <p className="ni-job-ad-desc" style={{ fontSize: '13px', margin: 0 }}>
                                {t('newCampaign_generateAdDesc')}
                            </p>
                            </div>
                            <button
                                type="button"
                                onClick={handleGenerateAdvertisement}
                                disabled={generatingAd || (Object.keys(selectedCriteria).filter(k => selectedCriteria[k]).length === 0 && (!isScreeningFlow || countFilledCustomRubricItems(customCriteria) === 0))}
                                className="workflow-btn-primary ni-generate-ad-btn"
                                style={{ marginBottom: jobAdvertisement ? '12px' : 0 }}
                            >
                                {generatingAd ? (
                                    <span className="ni-generate-ad-btn__content ni-generate-ad-btn__content--loading">
                                        <svg
                                            className="ni-generate-ad-btn__spark"
                                            width="22"
                                            height="22"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            xmlns="http://www.w3.org/2000/svg"
                                            aria-hidden
                                        >
                                            <path
                                                fill="currentColor"
                                                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
                                            />
                                        </svg>
                                    <span className="ni-generate-ad-loading" aria-live="polite">
                                            <span className="ni-generate-ad-loading__text">{t('newCampaign_generatingAd')}</span>
                                        <span className="ni-generate-ad-loading__dots" aria-hidden="true">
                                            <span className="ni-generate-ad-loading__dot" />
                                            <span className="ni-generate-ad-loading__dot" />
                                            <span className="ni-generate-ad-loading__dot" />
                                            </span>
                                        </span>
                                    </span>
                                ) : (
                                    <span className="ni-generate-ad-btn__content">
                                        <svg
                                            className="ni-generate-ad-btn__spark"
                                            width="22"
                                            height="22"
                                                        viewBox="0 0 24 24"
                                                        fill="none"
                                                        xmlns="http://www.w3.org/2000/svg"
                                                        aria-hidden
                                                    >
                                                        <path
                                                fill="currentColor"
                                                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
                                                        />
                                                    </svg>
                                        <span className="btn-text">{t('newCampaign_generateAd')}</span>
                                                                </span>
                                                            )}
                                                        </button>
                            {jobAdvertisement && (
                                <div className="ni-job-ad-preview">
                                    <div className="ni-job-ad-preview__toolbar">
                                        <button
                                            type="button"
                                            className="ni-job-ad-toolbar-btn"
                                            onClick={() => setIsEditingJobAd(!isEditingJobAd)}
                                            title={isEditingJobAd ? 'Preview' : 'Edit'}
                                            aria-label={isEditingJobAd ? 'Preview' : 'Edit'}
                                        >
                                            {isEditingJobAd ? (
                                                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                                                    <path d="M16.6667 5L7.5 14.1667L3.33333 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                                </svg>
                                            ) : (
                                                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                                                    <path d="M14.1667 2.5C14.6083 2.05833 15.2917 2.05833 15.7333 2.5L17.5 4.26667C17.9417 4.70833 17.9417 5.39167 17.5 5.83333L9.16667 14.1667H6.66667V11.6667L14.1667 4.16667V2.5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                                    <path d="M15.8333 3.33333L16.6667 4.16667" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                                </svg>
                                            )}
                                        </button>
                                    </div>
                                    <div className={`ni-job-ad-preview__body${isEditingJobAd ? ' ni-job-ad-preview__body--edit' : ''}`}>
                                    {isEditingJobAd ? (
                                <textarea
                                    ref={jobAdTextareaRef}
                                    className="ni-job-ad-preview__textarea"
                                    value={jobAdvertisement ?? ''}
                                    onChange={(e) => setJobAdvertisement(e.target.value)}
                                    placeholder="Job advertisement will appear here..."
                                    rows={10}
                                            autoFocus
                                            dir={isRtlLanguage(adCurrentLanguage) ? 'rtl' : 'ltr'}
                                    style={{
                                                ...getJobAdTypography(adCurrentLanguage),
                                                textAlign: isRtlLanguage(adCurrentLanguage) ? 'right' : 'left'
                                            }}
                                        />
                                    ) : (
                                        <div
                                            className="ni-job-ad-preview__content"
                                            dir={isRtlLanguage(adCurrentLanguage) ? 'rtl' : 'ltr'}
                                            style={{
                                                ...getJobAdTypography(adCurrentLanguage),
                                                textAlign: isRtlLanguage(adCurrentLanguage) ? 'right' : 'left'
                                            }}
                                        >
                                            {renderJobAdvertisementPreview(jobAdvertisement)}
                                        </div>
                                    )}
                                    </div>
                                </div>
                            )}
                            </div>
                        )}

                        {/* Continue — شريط لاصق أسفل منطقة التمرير + تدرج في ni-continue-btn (design-styles) */}
                        {/* مسار «عام»: الزر يُنشئ الحملة ويولّد رابطاً عاماً بدل المتابعة لإنشاء مرشح */}
                        <div className="ni-continue-footer">
                            <button
                                type="button"
                                onClick={isGeneralVideo ? handleGenerateVideoPublicLink : isGeneralAudio ? handleGeneratePublicLink : handleContinue}
                                disabled={isGeneralPublic && generatingPublicLink}
                                className="workflow-btn-primary ni-continue-btn"
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '10px',
                                    padding: '14px 28px',
                                    fontSize: '1.05rem',
                                    fontWeight: '600',
                                    cursor: (isGeneralPublic && generatingPublicLink) ? 'not-allowed' : 'pointer',
                                    opacity: (isGeneralPublic && generatingPublicLink) ? 0.6 : 1
                                }}
                            >
                                <span style={{ fontSize: '1.25rem' }}>▶</span>
                                <span>
                                    {isGeneralPublic && generatingPublicLink
                                        ? t('newCampaign_loadingCampaign')
                                        : t('newCampaign_continue')}
                                </span>
                            </button>
                        </div>
                    </div>
                ) : showFormLink ? (
                    <>
                        {/* Form Link Display */}
                        <div style={{ 
                            flex: 1, 
                            display: 'flex', 
                            flexDirection: 'column',
                            gap: '20px'
                        }}>
                            {/* Single container: Advertisement + Form Link + Share options */}
                            <div className="ni-campaign-ready-shell" style={{
                                padding: '24px',
                                background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.98) 0%, rgba(30, 41, 59, 0.95) 100%)',
                                borderRadius: '12px',
                                border: '1px solid rgba(34, 211, 238, 0.2)',
                                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)'
                            }}>
                                {/* Job Advertisement */}
                                {jobAdvertisement && (
                                    <div className="ni-campaign-ready-job-ad-block" style={{ marginBottom: '20px', paddingBottom: '20px', borderBottom: '1px solid rgba(34, 211, 238, 0.15)' }}>
                                        <div className="campaign-action-buttons" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', gap: '12px' }}>
                                            <label className={`ni-campaign-share-toggle${includeAdWhenSharing ? ' ni-campaign-share-toggle--checked' : ''}`} style={shareToggleLabelStyle(includeAdWhenSharing)}>
                                                <input
                                                    type="checkbox"
                                                    checked={includeAdWhenSharing}
                                                    onChange={onToggleIncludeAd}
                                                    aria-label="Include job advertisement when sharing or copying"
                                                    style={shareToggleCheckboxStyle}
                                                />
                                                <h3 className="ni-campaign-ready-heading" style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px',
                                                    fontSize: '15px',
                                                    fontWeight: 700,
                                                    color: NT.title,
                                                    margin: 0
                                                }}>
                                                    <HeroJobAdFormIcon size={20} />
                                                    {t('newCampaign_jobAdHeading')}
                                                </h3>
                                            </label>
                                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                            <button
                                                type="button"
                                                className="ni-job-ad-toolbar-btn"
                                                onClick={() => setIsEditingJobAd(!isEditingJobAd)}
                                                title={isEditingJobAd ? 'View' : 'Edit'}
                                                aria-label={isEditingJobAd ? 'View' : 'Edit'}
                                            >
                                                {isEditingJobAd ? (
                                                    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                        <path d="M16.6667 5L7.5 14.1667L3.33333 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                                    </svg>
                                                ) : (
                                                    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                        <path d="M14.1667 2.5C14.6083 2.05833 15.2917 2.05833 15.7333 2.5L17.5 4.26667C17.9417 4.70833 17.9417 5.39167 17.5 5.83333L9.16667 14.1667H6.66667V11.6667L14.1667 4.16667V2.5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                                        <path d="M15.8333 3.33333L16.6667 4.16667" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                                    </svg>
                                                )}
                                            </button>
                                        </div>
                                        </div>
                                        {isEditingJobAd ? (
                                            <textarea
                                                ref={jobAdTextareaRef}
                                                value={jobAdvertisement ?? ''}
                                                onChange={(e) => setJobAdvertisement(e.target.value)}
                                                placeholder="Edit job advertisement..."
                                                rows={12}
                                                autoFocus
                                                dir={isRtlLanguage(adCurrentLanguage) ? 'rtl' : 'ltr'}
                                                className="ni-campaign-ready-textarea"
                                                style={{
                                                    width: '100%',
                                                    padding: '14px',
                                                    background: NT.itemBgMuted,
                                                    border: '1px solid rgba(34, 211, 238, 0.3)',
                                                    borderRadius: NT.radius,
                                                    color: NT.inputText,
                                                    ...getJobAdTypography(adCurrentLanguage),
                                                    resize: 'vertical',
                                                    minHeight: '200px',
                                                    boxSizing: 'border-box',
                                                    textAlign: isRtlLanguage(adCurrentLanguage) ? 'right' : 'left'
                                                }}
                                            />
                                        ) : (
                                            <div
                                                className="ni-job-ad-preview__content ni-job-ad-preview__content--embedded"
                                                dir={isRtlLanguage(adCurrentLanguage) ? 'rtl' : 'ltr'}
                                                style={{
                                                    ...getJobAdTypography(adCurrentLanguage),
                                                    textAlign: isRtlLanguage(adCurrentLanguage) ? 'right' : 'left'
                                                }}
                                            >
                                                {renderJobAdvertisementPreview(jobAdvertisement)}
                                    </div>
                                        )}
                                </div>
                                )}

                            {/* Voice / Video interview + form links */}
                                <label
                                    className={`ni-campaign-share-toggle${includeLinkWhenSharing ? ' ni-campaign-share-toggle--checked' : ''}`}
                                    style={{
                                        ...shareToggleLabelStyle(includeLinkWhenSharing),
                                        marginBottom: '8px',
                                        cursor: hasJobAd ? 'pointer' : 'default',
                                        opacity: hasJobAd ? 1 : 0.95
                                    }}
                                >
                                    <input
                                        type="checkbox"
                                        checked={includeLinkWhenSharing}
                                        onChange={onToggleIncludeLink}
                                        disabled={!hasJobAd}
                                        aria-label="Include links when sharing or copying"
                                        style={{
                                            ...shareToggleCheckboxStyle,
                                            cursor: hasJobAd ? 'pointer' : 'not-allowed',
                                            opacity: hasJobAd ? 1 : 0.6
                                        }}
                                    />
                                    <h3 className="ni-campaign-ready-heading" style={{
                                        fontSize: '15px',
                                        fontWeight: 700,
                                        color: NT.title,
                                        margin: 0,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px'
                                    }}>
                                        {publicScreeningLink
                                            ? t('newCampaign_publicLinkReady')
                                            : selectedInterviewType === 'video'
                                            ? 'Video interview link'
                                            : voiceInterviewLinkWithCandidate || videoInterviewLinkWithCandidate
                                            ? isSpecificAudioOrVideo
                                                ? 'Interview link'
                                                : 'Interview and form links'
                                            : 'Form Link'}
                                        {!hasJobAd && !publicScreeningLink ? (
                                            <span className="ni-campaign-ready-badge" style={{ fontSize: '11px', fontWeight: 500, color: '#64748B' }}>(always included)</span>
                                        ) : null}
                                    </h3>
                                </label>
                                {publicScreeningLink ? (
                                    <>
                                        <p className="ni-campaign-ready-meta" style={{ fontSize: '12px', color: NT.meta, margin: '0 0 10px', lineHeight: 1.5 }}>
                                            {selectedInterviewType === 'video'
                                                ? t('newCampaign_publicLinkShareHintVideo')
                                                : t('newCampaign_publicLinkShareHint')}
                                        </p>
                                        {publicLinkMeta.position ? (
                                            <p className="ni-campaign-ready-meta" style={{ fontSize: '12px', color: '#94a3b8', margin: '0 0 10px', lineHeight: 1.5 }}>
                                                {`Role locked in this link: ${publicLinkMeta.position}`}
                                                {publicLinkMeta.campaignId ? ` · campaign ${publicLinkMeta.campaignId}` : ''}
                                            </p>
                                        ) : null}
                                        <div className="ni-campaign-link-box ni-campaign-link-box--success" style={{
                                            padding: '14px 16px',
                                            background: NT.itemBgMuted,
                                            borderRadius: NT.radius,
                                            border: '1px solid rgba(34, 197, 94, 0.35)',
                                            marginBottom: '16px'
                                        }}>
                                            <div className="ni-campaign-link-url ni-campaign-link-url--success" style={{
                                                fontSize: '12px',
                                                color: '#4ade80',
                                                wordBreak: 'break-all',
                                                fontFamily: 'monospace',
                                                lineHeight: 1.5
                                            }}>
                                                {publicScreeningLink}
                                            </div>
                                        </div>
                                    </>
                                ) : null}
                                {voiceInterviewLinkWithCandidate ? (
                                    <>
                                        <div className="ni-campaign-ready-sublabel" style={{
                                            fontSize: '12px',
                                            fontWeight: 600,
                                            color: NT.title,
                                            marginBottom: '6px'
                                        }}>
                                            Voice interview
                                        </div>
                                        <div className="ni-campaign-link-box" style={{
                                            padding: '14px 16px',
                                            background: NT.itemBgMuted,
                                            borderRadius: NT.radius,
                                            border: '1px solid rgba(34, 211, 238, 0.2)',
                                            marginBottom: '12px'
                                        }}>
                                            <div className="ni-campaign-link-url" style={{
                                                fontSize: '12px',
                                                color: '#22d3ee',
                                                wordBreak: 'break-all',
                                                fontFamily: 'monospace',
                                                lineHeight: 1.5
                                            }}>
                                                {voiceInterviewLinkWithCandidate}
                                            </div>
                                        </div>
                                    </>
                                ) : null}
                                {videoInterviewLinkWithCandidate ? (
                                    <>
                                        <div className="ni-campaign-ready-sublabel" style={{
                                            fontSize: '12px',
                                            fontWeight: 600,
                                            color: NT.title,
                                            marginBottom: '6px'
                                        }}>
                                            Video interview (LiveKit)
                                        </div>
                                        <div className="ni-campaign-link-box" style={{
                                            padding: '14px 16px',
                                            background: NT.itemBgMuted,
                                            borderRadius: NT.radius,
                                            border: '1px solid rgba(34, 211, 238, 0.2)',
                                            marginBottom: '10px'
                                        }}>
                                            <div className="ni-campaign-link-url" style={{
                                                fontSize: '12px',
                                                color: '#22d3ee',
                                                wordBreak: 'break-all',
                                                fontFamily: 'monospace',
                                                lineHeight: 1.5
                                            }}>
                                                {videoInterviewLinkWithCandidate}
                                            </div>
                                        </div>
                                    </>
                                ) : null}
                                {/* Video / Specific audio-video: hide application form — voice or LiveKit link only */}
                                {selectedInterviewType !== 'video' && !publicScreeningLink && !isSpecificAudioOrVideo && (
                                    <>
                                {(voiceInterviewLinkWithCandidate || videoInterviewLinkWithCandidate) ? (
                                    <div className="ni-campaign-ready-sublabel" style={{
                                        fontSize: '12px',
                                        fontWeight: 600,
                                        color: NT.title,
                                        marginBottom: '6px'
                                    }}>
                                        Application form
                                    </div>
                                ) : null}
                                <div className="ni-campaign-link-box" style={{
                                    padding: '14px 16px',
                                    background: NT.itemBgMuted,
                                    borderRadius: NT.radius,
                                    border: '1px solid rgba(34, 211, 238, 0.2)',
                                    marginBottom: '16px'
                                }}>
                                    <div className="ni-campaign-link-url" style={{
                                        fontSize: '12px',
                                        color: '#22d3ee',
                                        wordBreak: 'break-all',
                                        fontFamily: 'monospace',
                                        lineHeight: 1.5
                                    }}>
                                        {formLinkWithCampaign || getCurrentFormLink(currentTemplateType, currentLang)}
                                    </div>
                                </div>
                                    </>
                                )}
                        </div>

                            {hasJobAd ? (
                                <p className="ni-campaign-ready-hint" style={{
                                    fontSize: '13px',
                                    color: NT.meta,
                                    margin: '12px 0 0 0',
                                    lineHeight: 1.45
                                }}>
                                    ✓ Tick the options above to include the job ad and/or links in <strong style={{ color: NT.inputText }}>Share</strong> and <strong style={{ color: NT.inputText }}>Copy</strong>.
                                </p>
                            ) : null}

                            {/* Action buttons: Back · Copy (start) · Share (end) */}
                            <div
                                className="campaign-action-buttons"
                                style={{
                                display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                gap: '12px',
                                    width: '100%',
                                marginTop: 'auto',
                                    flexWrap: 'wrap',
                                }}
                            >
                                <div
                                    style={{
                                        display: 'flex',
                                        gap: '12px',
                                        flexWrap: 'wrap',
                                        alignItems: 'center',
                                    }}
                                >
                            <button
                                onClick={() => {
                                    setShowFormLink(false);
                                    setSelectedInterviewType(null);
                                    setVoiceInterviewLinkWithCandidate(null);
                                    setVideoInterviewLinkWithCandidate(null);
                                    setPublicScreeningLink(null);
                                }}
                                    className="btn btn-secondary ni-campaign-ready-icon-btn"
                                    title="Back"
                                    aria-label="Back"
                                >
                                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                        const textToCopy = buildShareCopyText();
                                        if (!textToCopy) return;
                                        navigator.clipboard.writeText(textToCopy).then(() => {
                                            setCopiedLink(true);
                                            setTimeout(() => setCopiedLink(false), 2000);
                                    });
                                }}
                                    className={`btn btn-secondary ni-campaign-ready-icon-btn ${copiedLink ? 'btn-copied' : ''}`}
                                    disabled={!canShareOrCopy()}
                                    title={!canShareOrCopy() ? 'Select job ad and/or form link' : (copiedLink ? 'Copied' : 'Copy')}
                                    aria-label={!canShareOrCopy() ? 'Select what to copy' : (copiedLink ? 'Copied' : 'Copy')}
                                    style={!canShareOrCopy() ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                                >
                                    {copiedLink ? (
                                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M16.6667 5L7.5 14.1667L3.33333 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                        </svg>
                                    ) : (
                                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <rect x="6.66667" y="6.66667" width="10" height="10" rx="1" stroke="currentColor" strokeWidth="2"/>
                                            <path d="M4.16667 13.3333V4.16667C4.16667 3.25 4.91667 2.5 5.83333 2.5H13.3333" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                        </svg>
                                    )}
                                </button>
                                </div>
                                <button
                                    type="button"
                                    onClick={async () => {
                                        const textToShare = buildShareCopyText();
                                        if (!textToShare) return;
                                        const formLink = resolveFormLink();
                                        try {
                                            if (navigator.share) {
                                                const shareData = {
                                                    title: jobDetails.job || jobDetails.position || 'Job Application',
                                                    text: textToShare
                                                };
                                                if (
                                                    includeLinkWhenSharing &&
                                                    formLink &&
                                                    !textToShare.includes(formLink)
                                                ) {
                                                    shareData.url = formLink;
                                                }
                                                await navigator.share(shareData);
                                            } else {
                                                await navigator.clipboard.writeText(textToShare);
                                                setCopiedLink(true);
                                                setTimeout(() => setCopiedLink(false), 2000);
                                            }
                                        } catch (err) {
                                            await navigator.clipboard.writeText(textToShare);
                                            setCopiedLink(true);
                                            setTimeout(() => setCopiedLink(false), 2000);
                                        }
                                    }}
                                    className="workflow-btn-primary ni-continue-btn ni-campaign-share-icon-btn"
                                    disabled={!canShareOrCopy()}
                                    title={!canShareOrCopy() ? 'Select job ad and/or form link' : 'Share'}
                                    aria-label={!canShareOrCopy() ? 'Select what to share' : 'Share'}
                                    style={{
                                        marginInlineStart: 'auto',
                                        ...(!canShareOrCopy() ? { opacity: 0.45, cursor: 'not-allowed' } : {}),
                                    }}
                                >
                                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M15 6.66667C16.3807 6.66667 17.5 5.54738 17.5 4.16667C17.5 2.78595 16.3807 1.66667 15 1.66667C13.6193 1.66667 12.5 2.78595 12.5 4.16667C12.5 5.54738 13.6193 6.66667 15 6.66667Z" stroke="currentColor" strokeWidth="2"/>
                                        <path d="M5 12.5C6.38071 12.5 7.5 11.3807 7.5 10C7.5 8.61929 6.38071 7.5 5 7.5C3.61929 7.5 2.5 8.61929 2.5 10C2.5 11.3807 3.61929 12.5 5 12.5Z" stroke="currentColor" strokeWidth="2"/>
                                        <path d="M15 18.3333C16.3807 18.3333 17.5 17.214 17.5 15.8333C17.5 14.4526 16.3807 13.3333 15 13.3333C13.6193 13.3333 12.5 14.4526 12.5 15.8333C12.5 17.214 13.6193 18.3333 15 18.3333Z" stroke="currentColor" strokeWidth="2"/>
                                        <path d="M7.15833 11.175L12.85 14.6583M12.8417 5.34167L7.15833 8.825" stroke="currentColor" strokeWidth="2"/>
                                    </svg>
                            </button>
                        </div>
                    </div>
                    </>
                ) : (
                    <>
                        {/*
                         * مساحة رأس ثابتة + نافذة عريضة (900px) مع 4 صفوف فقط → تبدو القائمة «صغيرة» وسط فراغ أسفلي.
                         * نوسط الصفوف عمودياً ونرفع أحجام الخط والبطاقات في design-styles.
                         */}
                        <div
                            className="ni-campaign-ready-options-shell"
                            style={{
                                flex: 1,
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'center',
                                minHeight: 'min(400px, 46vh)',
                                width: '100%',
                            }}
                        >
                            <div
                                className="ni-campaign-ready-options-list"
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '14px',
                                    width: '100%',
                                }}
                            >
                            {CAMPAIGN_READY_OPTIONS.map((option) => (
                                <NiCampaignOptionRow
                                    key={option.id}
                                    option={localizeCampaignReadyOption(option, t)}
                                    tokens={NT}
                                    onClick={() => handleOptionClick(option.id)}
                                />
                            ))}
                </div>
                        </div>
                    </>
                )}
            </div>

            {/* Link Modal */}
            {showLinkModal && (
                <>
                    <div
                        style={{
                            position: 'fixed',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            background: 'rgba(0, 0, 0, 0.8)',
                            backdropFilter: 'blur(8px)',
                            zIndex: 10003,
                            animation: 'fadeIn 0.3s ease'
                        }}
                        onClick={handleCloseModal}
                    />
                    <div
                        style={{
                            position: 'fixed',
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, -50%)',
                            width: '90%',
                            maxWidth: '500px',
                            background: NT.shellBg,
                            backdropFilter: 'blur(24px)',
                            WebkitBackdropFilter: 'blur(24px)',
                            borderRadius: '16px',
                            border: NT.shellBorder,
                            boxShadow: NT.shellShadow,
                            zIndex: 10004,
                            padding: '32px',
                            animation: 'fadeIn 0.3s ease'
                        }}
                    >
                        <div style={{ marginBottom: '24px' }}>
                            <h3 style={{
                                fontSize: '20px',
                                fontWeight: 700,
                                color: NT.title,
                                marginBottom: '12px',
                                letterSpacing: '0.02em',
                            }}>
                                رابط الاستمارة جاهز!
                            </h3>
                            <p style={{
                                fontSize: '14px',
                                color: NT.meta,
                                margin: 0
                            }}>
                                القالب المختار: <strong style={{ color: '#06B6D4' }}>{getSelectedTemplateByType(currentTemplateType)?.name}</strong>
                            </p>
                        </div>

                        <div style={{
                            marginBottom: '24px',
                            padding: '20px',
                            background: NT.itemBg,
                            borderRadius: NT.radius,
                            border: NT.itemBorder,
                            boxShadow: NT.itemShadow
                        }}>
                            <div style={{
                                fontSize: '12px',
                                color: NT.meta,
                                marginBottom: '8px',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px'
                            }}>
                                رابط المشاركة:
                            </div>
                            <div style={{
                                fontSize: '13px',
                                color: '#22d3ee',
                                wordBreak: 'break-all',
                                fontFamily: 'monospace',
                                padding: '12px',
                                background: NT.itemBgMuted,
                                borderRadius: NT.radius,
                                border: '1px solid rgba(34, 211, 238, 0.2)'
                            }}>
                                {getCurrentFormLink(currentTemplateType, currentLang)}
                            </div>
                        </div>

                        <div style={{
                            display: 'flex',
                            gap: '12px'
                        }}>
                            <button
                                onClick={handleCopyLink}
                                style={{
                                    flex: 1,
                                    padding: '14px 28px',
                                    background: copiedLink
                                        ? 'linear-gradient(135deg, #10B981, #059669)'
                                        : 'linear-gradient(135deg, #22d3ee 0%, #06b6d4 50%, #0891b2 100%)',
                                    border: `1px solid ${copiedLink ? 'rgba(16, 185, 129, 0.3)' : 'rgba(34, 211, 238, 0.3)'}`,
                                    borderRadius: '12px',
                                    color: '#fff',
                                    fontSize: '15px',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    transition: 'all 0.3s ease',
                                    boxShadow: copiedLink 
                                        ? '0 4px 16px rgba(16, 185, 129, 0.3)' 
                                        : '0 4px 16px rgba(34, 211, 238, 0.3)',
                                    letterSpacing: '0.3px'
                                }}
                                onMouseEnter={(e) => {
                                    if (!copiedLink) {
                                        e.currentTarget.style.transform = 'translateY(-2px)';
                                        e.currentTarget.style.boxShadow = '0 6px 20px rgba(34, 211, 238, 0.5)';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                }}
                            >
                                {copiedLink ? '✓ تم النسخ!' : 'نسخ الرابط'}
                            </button>
                            <button
                                onClick={handleCloseModal}
                                className="btn-secondary"
                                style={{
                                    padding: '14px 28px',
                                    background: 'rgba(255, 255, 255, 0.1)',
                                    border: '1px solid rgba(34, 211, 238, 0.2)',
                                    borderRadius: '12px',
                                    color: '#E2E8F0',
                                    fontSize: '15px',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    transition: 'all 0.3s ease',
                                    letterSpacing: '0.3px'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background = 'rgba(34, 211, 238, 0.2)';
                                    e.currentTarget.style.borderColor = 'rgba(34, 211, 238, 0.4)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                                    e.currentTarget.style.borderColor = 'rgba(34, 211, 238, 0.2)';
                                }}
                            >
                                إغلاق
                            </button>
                        </div>
                    </div>
                </>
            )}

            {/* CSS Animations */}
            <style>{`
                @keyframes fadeIn {
                    from {
                        opacity: 0;
                    }
                    to {
                        opacity: 1;
                    }
                }

                @keyframes modalFadeIn {
                    from {
                        opacity: 0;
                        transform: translate(-50%, -48%);
                        scale: 0.95;
                    }
                    to {
                        opacity: 1;
                        transform: translate(-50%, -50%);
                        scale: 1;
                    }
                }

                @keyframes slideIn {
                    from {
                        opacity: 0;
                        transform: translateY(-10px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }

                @media (max-width: 768px) {
                    .new-interview-modal {
                        width: calc(100% - 20px) !important;
                        max-width: calc(100% - 20px) !important;
                        padding: 14px 12px calc(16px + env(safe-area-inset-bottom, 0px)) !important;
                        max-height: min(92dvh, calc(100dvh - 20px)) !important;
                        border-radius: 14px !important;
                    }
                }
                
                @media (max-width: 480px) {
                    .new-interview-modal {
                        width: calc(100% - 12px) !important;
                        max-width: calc(100% - 12px) !important;
                        padding: 12px 10px calc(14px + env(safe-area-inset-bottom, 0px)) !important;
                        max-height: min(94dvh, calc(100dvh - 12px)) !important;
                    }
                }

                .new-interview-modal::-webkit-scrollbar {
                    display: none;
                    width: 0;
                    height: 0;
                }

                .new-interview-modal {
                    scrollbar-width: none;
                    -ms-overflow-style: none;
                }

                .new-interview-modal *::-webkit-scrollbar {
                    display: none;
                    width: 0;
                    height: 0;
                }

                .new-interview-modal * {
                    scrollbar-width: none;
                    -ms-overflow-style: none;
                }

                .new-interview-modal .workflow-btn-primary:not(.ni-continue-btn):not(.ni-generate-ad-btn) {
                    box-shadow: none !important;
                }

                .new-interview-modal .workflow-btn-primary:not(.ni-continue-btn):not(.ni-generate-ad-btn):hover {
                    box-shadow: none !important;
                }

                .new-interview-modal .workflow-btn-primary:not(.ni-continue-btn):not(.ni-generate-ad-btn)::after {
                    display: none !important;
                }

                /* Generate button — animated loading dots */
                .ni-generate-ad-loading {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    line-height: 1;
                }
                .ni-generate-ad-loading__text {
                    display: inline-block;
                    background: linear-gradient(90deg,
                        rgba(255, 255, 255, 0.95) 0%,
                        rgba(186, 230, 253, 1) 45%,
                        rgba(255, 255, 255, 0.95) 55%,
                        rgba(186, 230, 253, 1) 100%);
                    background-size: 200% 100%;
                    -webkit-background-clip: text;
                    background-clip: text;
                    -webkit-text-fill-color: transparent;
                    animation: ni-generate-shine 2s linear infinite;
                    font-weight: 600;
                }
                .ni-generate-ad-loading__dots {
                    display: inline-flex;
                    align-items: flex-end;
                    gap: 4px;
                    height: 12px;
                }
                .ni-generate-ad-loading__dot {
                    width: 6px;
                    height: 6px;
                    border-radius: 50%;
                    background: #ffffff;
                    box-shadow: 0 0 8px rgba(186, 230, 253, 0.9), 0 0 16px rgba(56, 189, 248, 0.6);
                    animation: ni-generate-bounce 1.1s ease-in-out infinite;
                }
                .ni-generate-ad-loading__dot:nth-child(2) {
                    animation-delay: 0.18s;
                }
                .ni-generate-ad-loading__dot:nth-child(3) {
                    animation-delay: 0.36s;
                }
                @keyframes ni-generate-bounce {
                    0%, 80%, 100% {
                        transform: translateY(0) scale(0.85);
                        opacity: 0.55;
                    }
                    40% {
                        transform: translateY(-8px) scale(1);
                        opacity: 1;
                    }
                }
                @keyframes ni-generate-shine {
                    0% { background-position: 200% 0; }
                    100% { background-position: -200% 0; }
                }
                .ni-generate-ad-btn:disabled {
                    cursor: progress !important;
                    opacity: 0.92 !important;
                }

                /* Language picker (globe): styles in design-styles.css — match ni-job-ad-toolbar-btn */

                /* Job ad toolbar — Edit: styles in design-styles.css (match Design question-item-btn) */

                .new-interview-modal .campaign-action-buttons .btn:not(.ni-campaign-ready-icon-btn) {
                    display: inline-flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    background: rgba(15, 23, 42, 0.8) !important;
                    backdrop-filter: blur(10px) !important;
                    -webkit-backdrop-filter: blur(10px) !important;
                    border: 1px solid rgba(34, 211, 238, 0.3) !important;
                    color: rgba(255, 255, 255, 0.95) !important;
                    padding: 12px !important;
                    width: 44px !important;
                    height: 44px !important;
                    min-width: 44px !important;
                    min-height: 44px !important;
                    border-radius: 8px !important;
                    font-weight: 500 !important;
                    transition: all 0.3s ease !important;
                }

                .new-interview-modal .campaign-action-buttons .btn:not(.ni-campaign-ready-icon-btn) svg {
                    color: rgba(34, 211, 238, 0.8);
                    transition: all 0.3s ease;
                }

                .new-interview-modal .campaign-action-buttons .btn:not(.ni-campaign-ready-icon-btn):hover svg {
                    color: rgba(34, 211, 238, 1);
                }

                .new-interview-modal .campaign-action-buttons .btn:not(.ni-campaign-ready-icon-btn):hover {
                    background: rgba(15, 23, 42, 0.95) !important;
                    border-color: rgba(34, 211, 238, 0.6) !important;
                    transform: translateY(-2px) !important;
                    color: #ffffff !important;
                    box-shadow: 0 4px 16px rgba(34, 211, 238, 0.3), 0 0 20px rgba(34, 211, 238, 0.2) !important;
                }

                /* Share & Post: ni-continue-btn gradient + ni-campaign-share/post-icon-btn 44×44 */

                .new-interview-modal .campaign-action-buttons .btn.btn-copied {
                    background: rgba(16, 185, 129, 0.25) !important;
                    border-color: rgba(16, 185, 129, 0.5) !important;
                    color: #10B981 !important;
                }

                .new-interview-modal .campaign-action-buttons .btn.btn-copied svg {
                    color: #10B981 !important;
                }
            `}</style>
        </>
    );
};

export default NewInterviewSidebar;

