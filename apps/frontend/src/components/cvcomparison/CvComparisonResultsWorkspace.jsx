import React, { useMemo, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { fillI18nTemplate } from '../../utils/i18nTemplate.js';
import AiWorkingIndicator from '../AiWorkingIndicator.jsx';

function isPlainRecord(v) {
    return v != null && typeof v === 'object' && !Array.isArray(v);
}

function pickStr(obj, keys) {
    for (const k of keys) {
        const v = obj[k];
        if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
}

function pickStringArray(obj, keys) {
    for (const k of keys) {
        const v = obj[k];
        if (!Array.isArray(v)) continue;
        const items = v.map((item) => String(item).trim()).filter(Boolean);
        if (items.length) return items;
    }
    return [];
}

function parsePayloadRoot(payload) {
    if (payload == null) return null;
    let raw = payload;
    if (typeof raw === 'string') {
        try {
            raw = JSON.parse(raw);
        } catch {
            return null;
        }
    }
    return isPlainRecord(raw) || Array.isArray(raw) ? raw : null;
}

function extractRowArray(root, keys) {
    if (Array.isArray(root)) return root.filter(isPlainRecord);
    if (!isPlainRecord(root)) return [];
    for (const key of keys) {
        const v = root[key];
        if (Array.isArray(v)) return v.filter(isPlainRecord);
    }
    if (isPlainRecord(root.comparison)) return [root.comparison];
    return [];
}

function normalizeNameKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\.pdf$/i, '');
}

function findMatchingCandidate(candidates, comp, index) {
    if (!candidates.length) return null;
    if (candidates[index] && isPlainRecord(candidates[index])) return candidates[index];

    const compName = normalizeNameKey(pickStr(comp, ['name', 'fileName', 'filename', 'cvName']));
    if (!compName) return null;

    return (
        candidates.find((c) => {
            const candName = normalizeNameKey(pickStr(c, ['name', 'fileName', 'filename', 'cvName']));
            return candName && (candName === compName || candName.includes(compName) || compName.includes(candName));
        }) || null
    );
}

function looksLikeNonCvRow(row) {
    const name = String(row.fileName || row.name || '').toLowerCase();
    const summary = String(row.summary || '').toLowerCase();
    if (name.includes('no text') || name.includes('(no text)')) return true;
    if (row.isCv === false) return true;
    if (summary.includes('no extractable text') || summary.includes('not a cv') || summary.includes('not a resume')) {
        return true;
    }
    if (summary.includes('little or no') && summary.includes('text')) return true;
    return false;
}

function extractSkippedFiles(root) {
    if (!isPlainRecord(root)) return [];
    const raw = root.skippedFiles;
    if (!Array.isArray(raw)) return [];
    return raw
        .filter(isPlainRecord)
        .map((x) => ({
            fileName: pickStr(x, ['fileName', 'filename', 'name']),
            reason: pickStr(x, ['reason']),
        }))
        .filter((x) => x.fileName);
}

function normalizeComparisonRows(payload) {
    const root = parsePayloadRoot(payload);
    if (!root) return { rows: [], skippedFiles: [] };

    const skippedFiles = extractSkippedFiles(root);
    let rows = [];

    const comparisons = extractRowArray(root, ['comparisons']);
    const candidates = extractRowArray(root, ['candidates']);

    if (comparisons.length) {
        rows = comparisons.map((comp, index) =>
            normalizeRow(comp, index, findMatchingCandidate(candidates, comp, index))
        );
    } else if (candidates.length) {
        rows = candidates.map((c, index) => normalizeRow(c, index));
    } else {
        rows = extractRowArray(root, ['results', 'items', 'data', 'records']).map((row, index) =>
            normalizeRow(row, index)
        );
    }

    rows = rows.filter((row) => !looksLikeNonCvRow(row));
    rows.forEach((row, index) => {
        row.rank = index + 1;
    });

    return { rows, skippedFiles };
}

function normalizeRow(row, index, candidateExtra = null) {
    const merged = candidateExtra ? { ...candidateExtra, ...row } : row;
    const fileName = pickStr(merged, ['fileName', 'filename', 'name', 'cvName', 'title']);
    const rankRaw = merged.rank ?? merged.position ?? merged.order;
    const rank = typeof rankRaw === 'number' ? rankRaw : parseInt(String(rankRaw), 10);
    const scoreRaw =
        merged.score ?? merged.matchScore ?? merged.overallScore ?? merged.rating ?? merged.fitScore;
    const score = typeof scoreRaw === 'number' ? scoreRaw : parseFloat(String(scoreRaw));
    const summary = pickStr(merged, ['summary', 'overview', 'analysis', 'notes']);
    const finalHrReport = pickStr(merged, [
        'finalHrReport',
        'finalHrEvaluation',
        'final_hr_report',
        'hrReport',
        'finalHRReport',
    ]);
    const education = pickStr(merged, ['education']);
    const experienceRaw = merged.experienceYears ?? merged.yearsOfExperience ?? merged.experience;
    const experienceYears =
        typeof experienceRaw === 'number'
            ? experienceRaw
            : parseFloat(String(experienceRaw ?? '').replace(/[^\d.]/g, ''));
    const skills = pickStringArray(merged, ['skills']);
    const strengths = pickStringArray(merged, ['strengths']);
    const weaknesses = pickStringArray(merged, ['weaknesses']);

    const hasDetails =
        Boolean(summary) ||
        Boolean(finalHrReport) ||
        Boolean(education) ||
        Number.isFinite(experienceYears) ||
        skills.length > 0 ||
        strengths.length > 0 ||
        weaknesses.length > 0 ||
        Boolean(fileName);

    return {
        id: pickStr(merged, ['id', 'candidateId']) || `row-${index}`,
        fileName: fileName || `CV ${index + 1}`,
        rank: Number.isFinite(rank) ? rank : index + 1,
        score: Number.isFinite(score) ? score : null,
        summary,
        finalHrReport,
        education,
        experienceYears: Number.isFinite(experienceYears) ? experienceYears : null,
        skills,
        strengths,
        weaknesses,
        hasDetails,
    };
}

function RowExpandIcon() {
    return (
        <svg
            className="cv-comparison-results__expand-icon"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
        >
            <path d="M6 9l6 6 6-6" />
        </svg>
    );
}

function CvComparisonDetailsPanel({ row, t }) {
    const noneLabel = t('stageEval_none');

    return (
        <div className="cv-comparison-details-panel">
            <div className="cv-comparison-details-panel__grid">
                <div className="stage-eval-detail-card">
                    <h4 className="stage-eval-detail-card__title">{t('cvComparisonDetailFinalHrReport')}</h4>
                    {row.finalHrReport ? (
                        <p className="stage-eval-detail-card__body">{row.finalHrReport}</p>
                    ) : null}
                    <dl className="cv-comparison-summary-facts">
                        <div className="cv-comparison-summary-facts__row">
                            <dt>{t('cvComparisonDetailName')}</dt>
                            <dd>{row.fileName}</dd>
                        </div>
                        <div className="cv-comparison-summary-facts__row">
                            <dt>{t('cvComparisonDetailExperience')}</dt>
                            <dd>
                                {row.experienceYears != null
                                    ? `${row.experienceYears} ${t('cvComparisonDetailYears')}`
                                    : '—'}
                            </dd>
                        </div>
                        <div className="cv-comparison-summary-facts__row">
                            <dt>{t('cvComparisonDetailEducation')}</dt>
                            <dd>{row.education || '—'}</dd>
                        </div>
                    </dl>
                </div>

                <div className="stage-eval-detail-card">
                    <h4 className="stage-eval-detail-card__title">{t('cvComparisonDetailStrengths')}</h4>
                    {row.strengths.length > 0 ? (
                        <ul className="stage-eval-detail-card__list">
                            {row.strengths.map((item) => (
                                <li key={item}>{item}</li>
                            ))}
                        </ul>
                    ) : (
                        <span className="stage-eval-detail-card__muted">{noneLabel}</span>
                    )}
                </div>

                <div className="stage-eval-detail-card">
                    <h4 className="stage-eval-detail-card__title">{t('cvComparisonDetailSkills')}</h4>
                    {row.skills.length > 0 ? (
                        <ul className="cv-comparison-skill-tags">
                            {row.skills.map((skill) => (
                                <li key={skill} className="cv-comparison-skill-tags__item">
                                    {skill}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <span className="stage-eval-detail-card__muted">{noneLabel}</span>
                    )}
                </div>

                <div className="stage-eval-detail-card">
                    <h4 className="stage-eval-detail-card__title">{t('cvComparisonDetailWeaknesses')}</h4>
                    {row.weaknesses.length > 0 ? (
                        <ul className="stage-eval-detail-card__list">
                            {row.weaknesses.map((item) => (
                                <li key={item}>{item}</li>
                            ))}
                        </ul>
                    ) : (
                        <span className="stage-eval-detail-card__muted">{noneLabel}</span>
                    )}
                </div>
            </div>
        </div>
    );
}

function CvComparisonResultRow({ row, summaryLabel, t, expanded, onToggle }) {
    const expandable = row.hasDetails;

    const handleKeyDown = (e) => {
        if (!expandable) return;
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
        }
    };

    return (
        <>
            <tr
                className={[
                    'cv-comparison-results__row',
                    expandable ? 'cv-comparison-results__row--expandable' : '',
                    expanded ? 'cv-comparison-results__row--expanded' : '',
                ]
                    .filter(Boolean)
                    .join(' ')}
                onClick={expandable ? onToggle : undefined}
                onKeyDown={handleKeyDown}
                tabIndex={expandable ? 0 : undefined}
                role={expandable ? 'button' : undefined}
                aria-expanded={expandable ? expanded : undefined}
                aria-label={
                    expandable
                        ? `${row.fileName} — ${expanded ? t('cvComparisonHideDetails') : t('cvComparisonShowDetails')}`
                        : undefined
                }
            >
                <td data-label={t('cvComparisonColRank')}>
                    <span className="cv-comparison-results__rank">#{row.rank}</span>
                </td>
                <td data-label={t('cvComparisonColFile')}>
                    <span className="cv-comparison-results__file">
                        <span className="cv-comparison-results__file-name">{row.fileName}</span>
                        {expandable ? <RowExpandIcon /> : null}
                    </span>
                </td>
                <td data-label={t('cvComparisonColScore')}>
                    <span className="cv-comparison-results__score">
                        {row.score != null ? `${Math.round(row.score)}%` : '—'}
                    </span>
                </td>
                <td className="cv-comparison-results__summary-cell" data-label={summaryLabel}>
                    <p className="cv-comparison-summary__text">{row.summary || '—'}</p>
                </td>
            </tr>
            {expandable && expanded ? (
                <tr className="cv-comparison-results__details-row">
                    <td colSpan={4} className="cv-comparison-results__details-cell">
                        <CvComparisonDetailsPanel row={row} t={t} />
                    </td>
                </tr>
            ) : null}
        </>
    );
}

export default function CvComparisonResultsWorkspace({ payload, receivedAt, loading, error }) {
    const { t } = useLanguage();
    const summaryLabel = t('cvComparisonColSummary');
    const [expandedRowId, setExpandedRowId] = useState(null);

    const rows = useMemo(() => {
        const { rows: normalized } = normalizeComparisonRows(payload);
        return normalized.sort((a, b) => a.rank - b.rank);
    }, [payload]);

    const skippedFiles = useMemo(() => {
        const root = parsePayloadRoot(payload);
        return extractSkippedFiles(root);
    }, [payload]);

    const toggleRow = (rowId) => {
        setExpandedRowId((current) => (current === rowId ? null : rowId));
    };

    if (loading) {
        return <AiWorkingIndicator kind="cvComparison" />;
    }

    if (error) {
        return (
            <p className="head-hunter-feedback head-hunter-feedback--err" role="alert">
                {error}
            </p>
        );
    }

    if (!rows.length) {
        return (
            <p className="headhunter-discovery__meta" role="status">
                {t('cvComparisonResultsEmpty')}
            </p>
        );
    }

    return (
        <div className="cv-comparison-results">
            {receivedAt ? (
                <p className="headhunter-discovery__meta">
                    {t('cvComparisonResultsReceivedLabel')}: {new Date(receivedAt).toLocaleString()}
                </p>
            ) : null}
            {skippedFiles.length > 0 ? (
                <p className="cv-comparison-results__skipped headhunter-discovery__meta" role="status">
                    {fillI18nTemplate(t('cvComparisonSkippedFiles'), { count: skippedFiles.length })}
                    {' '}
                    <span className="cv-comparison-results__skipped-names">
                        {skippedFiles.map((f) => f.fileName).join(' · ')}
                    </span>
                </p>
            ) : null}
            <div className="cv-comparison-results__table-wrap">
                <table className="cv-comparison-results__table">
                    <thead>
                        <tr>
                            <th scope="col">{t('cvComparisonColRank')}</th>
                            <th scope="col">{t('cvComparisonColFile')}</th>
                            <th scope="col">{t('cvComparisonColScore')}</th>
                            <th scope="col">{summaryLabel}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <CvComparisonResultRow
                                key={row.id}
                                row={row}
                                summaryLabel={summaryLabel}
                                t={t}
                                expanded={expandedRowId === row.id}
                                onToggle={() => toggleRow(row.id)}
                            />
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
