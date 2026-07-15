import React from 'react';
import {
    PdfCvLink,
    candidateAvatarImageProps,
    candidateCvUrl,
    candidatePhotoUrl,
    GenderAvatar,
    inferGenderFromName,
    shouldUseGenderAvatar,
    stage1FilesFromCandidate,
} from '../utils/candidateAssets';
import { onHorizontalDragScrollPointerDown } from '../utils/candidatesHorizontalDragScroll.js';
import { resolveCandidateEvaluation, evaluationSourceLabelKey } from '../utils/candidateEvaluation.js';
/** Shared table UX for Short list vs Employees roster inside [/candidates] */
export default function CandidatesStoredLedgerPanel({
    t,
    formFields,
    getFieldValue,
    formatCandidateGenderLabel,
    candidatePrimaryId,
    idsMatch,
    records,
    selectedIds,
    setSelectedIds,
    emptyTitle,
    emptyDescription,
    emptyPrimaryLabel,
    onEmptyPrimary,
    variant,
    rowDetailsTitleKey = 'candidates_rowDetailsTitle',
    onDetailsOpen,
}) {
    const isEmerald = variant === 'emerald';
    const panelVariantClass = isEmerald
        ? 'candidates-stored-ledger-panel--emerald'
        : 'candidates-stored-ledger-panel--amber';
    const panelBg = isEmerald ? 'rgba(15, 23, 42, 0.25)' : 'rgba(15, 23, 42, 0.2)';
    const accentRgb = isEmerald ? '34, 197, 94' : '234, 179, 8';
    const ringBorder = `2px solid rgba(${accentRgb}, 0.4)`;
    const ringGlow = `0 2px 8px rgba(${isEmerald ? '34,197,94' : '234,179,8'}, 0.28)`;
    const ringBg = isEmerald
        ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
        : 'linear-gradient(135deg, #FACC15 0%, #CA8A04 100%)';

    const openModal = onDetailsOpen ?? (() => {});

    if (records.length === 0) {
        return (
            <div
                className={`dashboard-card-body candidates-scroll-outer candidates-stored-ledger-panel ${panelVariantClass}`}
                style={{
                    padding: '0',
                    overflowX: 'hidden',
                    overflowY: 'auto',
                    scrollBehavior: 'smooth',
                    WebkitOverflowScrolling: 'touch',
                    flex: 1,
                    height: '100%',
                    minHeight: 0,
                    background: panelBg,
                }}
            >
                <div
                    style={{
                        minHeight: 'min(65vh, 560px)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '48px 24px',
                        boxSizing: 'border-box',
                    }}
                >
                    <div style={{ textAlign: 'center', maxWidth: 460 }}>
                        <svg
                            width="56"
                            height="56"
                            viewBox="0 0 24 24"
                            fill="none"
                            style={{
                                color: 'rgba(148, 163, 184, 0.55)',
                                margin: '0 auto 16px',
                                display: 'block',
                            }}
                            aria-hidden
                        >
                            <rect x="3" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="2" />
                            <rect x="13" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="2" />
                            <rect x="3" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="2" />
                            <rect x="13" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="2" />
                        </svg>
                        <p
                            style={{
                                color: '#f1f5f9',
                                fontSize: '17px',
                                fontWeight: 600,
                                margin: '0 0 8px',
                            }}
                        >
                            {emptyTitle}
                        </p>
                        <div style={{ color: '#94a3b8', fontSize: '14px', margin: '0 0 20px', lineHeight: 1.6 }}>
                            {emptyDescription}
                        </div>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={onEmptyPrimary}
                            style={{ padding: '12px 22px', cursor: 'pointer' }}
                        >
                            <span className="btn-text">{emptyPrimaryLabel}</span>
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div
            className={`dashboard-card-body candidates-scroll-outer candidates-stored-ledger-panel ${panelVariantClass}`}
            style={{
                padding: '0',
                overflowX: 'hidden',
                overflowY: 'auto',
                scrollBehavior: 'smooth',
                WebkitOverflowScrolling: 'touch',
                flex: 1,
                height: '100%',
                minHeight: 0,
                background: panelBg,
            }}
        >
            <div
                className="candidates-scroll-inner h-scroll-pan"
                style={{
                    overflowX: 'auto',
                    overflowY: 'hidden',
                    minWidth: 0,
                    cursor: 'grab',
                    WebkitOverflowScrolling: 'touch',
                }}
                onPointerDown={onHorizontalDragScrollPointerDown}
            >
                <table className="candidates-data-table" style={{ width: '100%', minWidth: '100%' }}>
                    <thead>
                        <tr>
                            <th>
                                <input
                                    type="checkbox"
                                    checked={
                                        selectedIds.length === records.length && records.length > 0
                                    }
                                    onChange={(e) => {
                                        if (e.target.checked) {
                                            setSelectedIds(
                                                records
                                                    .map((c) => candidatePrimaryId(c))
                                                    .filter((id) => id != null)
                                            );
                                        } else {
                                            setSelectedIds([]);
                                        }
                                    }}
                                    style={{
                                        width: '18px',
                                        height: '18px',
                                        cursor: 'pointer',
                                    }}
                                    className="candidates-row-checkbox"
                                />
                            </th>
                            <th style={{ minWidth: '280px', width: '280px' }}>{t('candidates_colName')}</th>
                            <th style={{ width: '100px', minWidth: '96px', whiteSpace: 'nowrap' }}>
                                {t('candidates_colGender')}
                            </th>
                            <th style={{ minWidth: '260px', width: '260px' }}>{t('candidates_colContact')}</th>
                            <th style={{ textAlign: 'center', width: '80px', minWidth: '72px' }}>
                                {t('candidates_colCv')}
                            </th>
                            {formFields.map((field) => (
                                <th
                                    key={field.key}
                                    style={{
                                        minWidth:
                                            field.type === 'textarea'
                                                ? '260px'
                                                : field.type === 'array'
                                                  ? '200px'
                                                  : '170px',
                                        width:
                                            field.type === 'textarea'
                                                ? '260px'
                                                : field.type === 'array'
                                                  ? '200px'
                                                  : '170px',
                                    }}
                                >
                                    {field.label}
                                </th>
                            ))}
                            <th style={{ minWidth: '220px', width: '220px' }}>{t('candidates_colAiEval')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {records.map((candidate, idx) => {
                            const rowKey = candidatePrimaryId(candidate) ?? `row-${idx}`;
                            const rowPrimaryId = candidatePrimaryId(candidate);
                            const isSelected =
                                rowPrimaryId != null &&
                                selectedIds.some((sid) => idsMatch(sid, rowPrimaryId));
                            const photoUrl = candidatePhotoUrl(candidate);
                            const cvUrl = candidateCvUrl(candidate);
                            const { cv } = stage1FilesFromCandidate(candidate);
                            const candEval = resolveCandidateEvaluation(candidate);

                            return (
                                <tr
                                    key={String(rowKey)}
                                    className={isSelected ? 'is-selected' : undefined}
                                    style={{
                                        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                                        transition: 'all 0.2s ease',
                                        cursor: 'pointer',
                                    }}
                                    title={t(rowDetailsTitleKey)}
                                    onDoubleClick={(e) => {
                                        if (
                                            e.target.tagName === 'INPUT' ||
                                            e.target.tagName === 'BUTTON' ||
                                            e.target.closest('button')
                                        ) {
                                            return;
                                        }
                                        openModal(candidate);
                                    }}
                                >
                                    <td className="candidates-table-cell">
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={(e) => {
                                                if (rowPrimaryId == null) return;
                                                if (e.target.checked) {
                                                    setSelectedIds((prev) =>
                                                        prev.some((sid) => idsMatch(sid, rowPrimaryId))
                                                            ? prev
                                                            : [...prev, rowPrimaryId]
                                                    );
                                                } else {
                                                    setSelectedIds((prev) =>
                                                        prev.filter((sid) => !idsMatch(sid, rowPrimaryId))
                                                    );
                                                }
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                            className="candidates-row-checkbox"
                                            style={{
                                                width: '18px',
                                                height: '18px',
                                                cursor: 'pointer',
                                            }}
                                        />
                                    </td>
                                    <td className="candidates-table-cell" style={{ minWidth: '280px', width: '280px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <div
                                                className="candidate-avatar-ring"
                                                style={{
                                                    width: '54px',
                                                    height: '54px',
                                                    borderRadius: '50%',
                                                    overflow: 'hidden',
                                                    flexShrink: 0,
                                                    border: ringBorder,
                                                    background: ringBg,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    boxShadow: ringGlow,
                                                }}
                                            >
                                                {photoUrl ? (
                                                    <img
                                                        alt={
                                                            (
                                                                (candidate.full_name || candidate.fullName) ||
                                                                ''
                                                            ).trim() || t('candidates_avatarAlt')
                                                        }
                                                        className="candidate-avatar-photo"
                                                        decoding="async"
                                                        loading="lazy"
                                                        draggable={false}
                                                        {...candidateAvatarImageProps(photoUrl, 54)}
                                                        style={{
                                                            width: '100%',
                                                            height: '100%',
                                                            objectFit: 'cover',
                                                        }}
                                                        onError={(e) => {
                                                            e.target.style.display = 'none';
                                                            const fall = e.target.nextElementSibling;
                                                            if (fall) fall.style.display = 'flex';
                                                        }}
                                                    />
                                                ) : null}
                                                {shouldUseGenderAvatar(candidate, photoUrl) ? (
                                                    <GenderAvatar
                                                        gender={inferGenderFromName(candidate)}
                                                        size={54}
                                                    />
                                                ) : (
                                                    <div
                                                        style={{
                                                            display: photoUrl ? 'none' : 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            width: '100%',
                                                            height: '100%',
                                                            fontSize: '20px',
                                                            fontWeight: 600,
                                                            color: '#fff',
                                                        }}
                                                    >
                                                        {(
                                                            (candidate.full_name || candidate.fullName)?.[0] ||
                                                            candidate.email?.[0] ||
                                                            candidate.candidate?.[0] ||
                                                            '?'
                                                        ).toUpperCase()}
                                                    </div>
                                                )}
                                            </div>
                                            <div
                                                className="candidates-cell-primary"
                                                style={{
                                                    marginBottom: '2px',
                                                    fontSize: '13px',
                                                    whiteSpace: 'normal',
                                                    wordWrap: 'break-word',
                                                    lineHeight: '1.4',
                                                    flex: 1,
                                                    minWidth: 0,
                                                }}
                                            >
                                                {((candidate.full_name || candidate.fullName) || '')
                                                    .trim()
                                                    ? ((candidate.full_name || candidate.fullName) || '').trim()
                                                    : candidate.candidate ||
                                                      candidate.email?.split('@')[0] ||
                                                      t('stageEval_notApplicable')}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="candidates-table-cell" style={{ whiteSpace: 'nowrap' }}>
                                        <span className="candidates-cell-secondary" style={{ fontSize: '12px', fontWeight: 500 }}>
                                            {formatCandidateGenderLabel(candidate)}
                                        </span>
                                    </td>
                                    <td
                                        className="candidates-table-cell"
                                        style={{ minWidth: '260px', verticalAlign: 'top' }}
                                    >
                                        <div className="candidates-cell-secondary" style={{ fontSize: '11px', marginBottom: '4px', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                                            {candidate.email}
                                        </div>
                                        <div className="candidates-cell-muted" style={{ fontSize: '10px', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                                            {candidate.phone}
                                        </div>
                                    </td>
                                    <td className="candidates-table-cell candidates-table-cv" onClick={(e) => e.stopPropagation()}>
                                        <div
                                            style={{
                                                display: 'flex',
                                                justifyContent: 'center',
                                                alignItems: 'center',
                                                width: '100%',
                                                minHeight: '48px',
                                            }}
                                        >
                                            {cvUrl ? (
                                                <PdfCvLink href={cvUrl} fileName={cv?.originalName} size={44} />
                                            ) : (
                                                <span className="candidates-cell-muted" style={{ fontSize: '11px' }}>—</span>
                                            )}
                                        </div>
                                    </td>
                                    {formFields.map((field) => (
                                        <td
                                            key={field.key}
                                            className="candidates-table-cell"
                                            style={{
                                                verticalAlign: 'top',
                                                minWidth:
                                                    field.type === 'textarea'
                                                        ? '260px'
                                                        : field.type === 'array'
                                                          ? '200px'
                                                          : '170px',
                                            }}
                                        >
                                            <div className="candidates-cell-secondary" style={{ fontSize: '11px', lineHeight: '1.45', whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                                                {getFieldValue(candidate, field.key)}
                                            </div>
                                        </td>
                                    ))}
                                    <td className="candidates-table-cell" style={{ minWidth: '220px', verticalAlign: 'top' }}>
                                        {candEval ? (
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '6px',
                                                    flexWrap: 'wrap',
                                                }}
                                            >
                                                <span
                                                    style={{
                                                        fontSize: '16px',
                                                        fontWeight: 700,
                                                        background:
                                                            candEval.score >= 80
                                                                ? 'linear-gradient(135deg, #10B981, #059669)'
                                                                : candEval.score >= 60
                                                                  ? 'linear-gradient(135deg, #F59E0B, #D97706)'
                                                                  : 'linear-gradient(135deg, #EF4444, #DC2626)',
                                                        WebkitBackgroundClip: 'text',
                                                        WebkitTextFillColor: 'transparent',
                                                        backgroundClip: 'text',
                                                    }}
                                                >
                                                    {candEval.score}%
                                                </span>
                                                <span
                                                    style={{
                                                        fontSize: '9px',
                                                        fontWeight: 600,
                                                        color: '#38BDF8',
                                                        background: 'rgba(56, 189, 248, 0.12)',
                                                        border: '1px solid rgba(56, 189, 248, 0.28)',
                                                        borderRadius: '6px',
                                                        padding: '1px 6px',
                                                        whiteSpace: 'nowrap',
                                                    }}
                                                >
                                                    {t(evaluationSourceLabelKey(candEval.source))}
                                                </span>
                                            </div>
                                        ) : (
                                            <span style={{ color: '#94A3B8', fontSize: '12px' }}>
                                                {t('candidates_aiPending')}
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
