import React, { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInterviewTemplate } from '../contexts/InterviewTemplateContext';
import { useLanguage } from '../contexts/LanguageContext';
import { fillI18nTemplate } from '../utils/i18nTemplate.js';
import '../design-styles.css';

/** Built-ins retired from the grid — excluded from defaults and from persisted context merges. */
const RETIRED_TEMPLATE_IDS = new Set(['template-standard', 'template-technical', 'template-executive']);

/** عينات قوالب — `updatedAt` لسطر «Edited …» (ISO) */
const SAMPLE_FORM_TEMPLATES = [
    {
        id: 'template-remote',
        name: 'Standard',
        description:
            'Full professional profile: contact, experience, education, skills, and languages. Best for most roles.',
        fieldsCount: 20,
        estMinutes: 14,
        badge: 'Default',
        badgeTone: 'default',
        accent: '#10b981',
        updatedAt: '2026-04-01T16:45:00.000Z',
    },
];

function formatRelativeTime(iso, tr) {
    if (!iso) return tr('interviewTemplatesEditedRecently');
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return tr('interviewTemplatesEditedRecently');
    const now = Date.now();
    const sec = Math.floor((now - then) / 1000);
    if (sec < 45) return tr('interviewTemplatesEditedNow');
    const min = Math.floor(sec / 60);
    if (min < 60)
        return min <= 1
            ? tr('interviewTemplatesEditedOneMinute')
            : fillI18nTemplate(tr('interviewTemplatesEditedMinutes'), { n: String(min) });
    const hr = Math.floor(min / 60);
    if (hr < 24)
        return hr <= 1
            ? tr('interviewTemplatesEditedOneHour')
            : fillI18nTemplate(tr('interviewTemplatesEditedHours'), { n: String(hr) });
    const day = Math.floor(hr / 24);
    if (day < 30)
        return day <= 1
            ? tr('interviewTemplatesEditedOneDay')
            : fillI18nTemplate(tr('interviewTemplatesEditedDays'), { n: String(day) });
    const mo = Math.floor(day / 30);
    if (mo < 12)
        return mo <= 1
            ? tr('interviewTemplatesEditedOneMonth')
            : fillI18nTemplate(tr('interviewTemplatesEditedMonths'), { n: String(mo) });
    const yr = Math.floor(mo / 12);
    return yr <= 1
        ? tr('interviewTemplatesEditedOneYear')
        : fillI18nTemplate(tr('interviewTemplatesEditedYears'), { n: String(yr) });
}

function localizedBadge(badge, tr) {
    if (badge === 'Default') return tr('interviewTemplatesBadgeDefault');
    if (badge === 'Custom') return tr('interviewTemplatesBadgeCustom');
    return badge;
}

function templateTitle(tpl, tr) {
    if (tpl.id === 'template-remote') return tr('interviewTemplates_standardName');
    return tpl.name;
}

const InterviewTemplates = () => {
    const navigate = useNavigate();
    const { t } = useLanguage();
    const { templates, setTemplates, selectTemplate, selectedTemplate } = useInterviewTemplate();

    useEffect(() => {
        setTemplates((prev) => {
            const base = prev.length > 0 ? prev : SAMPLE_FORM_TEMPLATES;
            const sanitized = base.filter((row) => !RETIRED_TEMPLATE_IDS.has(row.id));
            return sanitized.length > 0 ? sanitized : SAMPLE_FORM_TEMPLATES;
        });
    }, [setTemplates]);

    const mergedList = useMemo(() => {
        const byId = new Map(SAMPLE_FORM_TEMPLATES.map((row) => [row.id, { ...row }]));
        templates.forEach((row) => {
            if (row?.id) {
                const prev = byId.get(row.id) || {};
                byId.set(row.id, {
                    accent: '#22d3ee',
                    fieldsCount: 0,
                    estMinutes: 10,
                    badge: 'Custom',
                    badgeTone: 'muted',
                    updatedAt: new Date().toISOString(),
                    ...prev,
                    ...row,
                });
            }
        });
        return Array.from(byId.values()).filter((row) => !RETIRED_TEMPLATE_IDS.has(row.id));
    }, [templates]);

    const displayList = useMemo(() => {
        return [...mergedList].sort((a, b) => {
                const ta = new Date(a.updatedAt || 0).getTime();
                const tb = new Date(b.updatedAt || 0).getTime();
                return tb - ta;
            });
    }, [mergedList]);

    const handleUseTemplate = (tpl) => {
        selectTemplate(tpl);
        navigate(`/form?template=${encodeURIComponent(tpl.id)}&preview=1`);
    };

    return (
        <div className="dashboard-page dashboard-page--evaalo-visual interview-templates-page dashboard-page--full-viewport-shell">
            <div className="design-background design-background--evaalo-visual">
                    <div className="design-orb-1" />
                    <div className="design-orb-2" />
                    <div className="design-orb-3" />
                </div>
                <div className="dashboard-evaalo-visual-texture" aria-hidden="true" />
                <div className="dashboard-evaalo-visual-gridlines" aria-hidden="true" />

            <div className="container dashboard-visual-container">
                <div className="dashboard-grid">
                    <div className="dashboard-card dashboard-card--page-active platform-features-card">
                        <div className="dashboard-card-header">
                            <h2 className="dashboard-card-title">{t('interviewTemplatesPageTitle')}</h2>
                            </div>
                        <div className="dashboard-card-body interview-templates-card-body">
                            <div className="interview-templates-grid">
                                {displayList.map((tpl) => {
                                const isSelected = selectedTemplate?.id === tpl.id;
                                return (
                                    <article
                                        key={tpl.id}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => handleUseTemplate(tpl)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                handleUseTemplate(tpl);
                                            }
                                        }}
                                            className="interview-template-card"
                                        >
                                            <div className="interview-template-card-preview-wrap">
                                                <div
                                                    className={
                                                        'interview-template-card-preview' +
                                                        (isSelected ? ' interview-template-card-preview--selected' : '')
                                                    }
                                                    style={{ '--tpl-accent': tpl.accent }}
                                                >
                                                    <div className="interview-template-card-preview-inset">
                                                        <div
                                                            className="interview-template-card-preview-chrome"
                                                            aria-hidden="true"
                                                        >
                                                            <span className="interview-template-card-preview-dot" />
                                                            <span className="interview-template-card-preview-dot" />
                                                            <span className="interview-template-card-preview-dot" />
                                                        </div>
                                                        <div className="interview-template-card-preview-doc">
                                                            <div
                                                                className="interview-template-card-preview-doc-bar"
                                                                aria-hidden="true"
                                                            />
                                                            {tpl.badge ? (
                                                                <span className="interview-template-card-badge-label">
                                                                    {localizedBadge(tpl.badge, t)}
                                                                </span>
                                                            ) : null}
                                                            <div
                                                                className="interview-template-card-preview-lines"
                                                                aria-hidden="true"
                                                            >
                                                                <span className="interview-template-card-preview-line" />
                                                                <span className="interview-template-card-preview-line interview-template-card-preview-line--md" />
                                                                <span className="interview-template-card-preview-line interview-template-card-preview-line--sm" />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            <h3
                                                className="interview-template-card-title"
                                                title={templateTitle(tpl, t)}
                                            >
                                                {templateTitle(tpl, t)}
                                            </h3>
                                            <div className="interview-template-card-meta">
                                                <span
                                                    className="interview-template-card-meta-dot"
                                                    aria-hidden
                                                    style={{ background: tpl.accent }}
                                                />
                                                <span className="interview-template-card-meta-date">
                                                    {formatRelativeTime(tpl.updatedAt, t)}
                                                </span>
                                            </div>
                                    </article>
                                );
                            })}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default InterviewTemplates;
