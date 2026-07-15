import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { fillI18nTemplate } from '../utils/i18nTemplate.js';
const SHELL_BG =
    'linear-gradient(158deg, rgba(48, 43, 99, 0.42) 0%, rgba(15, 12, 41, 0.88) 42%, rgba(30, 41, 69, 0.78) 100%)';
const SHELL_BORDER = '1px solid rgba(255, 255, 255, 0.1)';
const SHELL_SHADOW =
    '0 0 0 1px rgba(56, 189, 248, 0.12) inset, 0 0 0 1px rgba(167, 139, 250, 0.06) inset, 0 28px 64px rgba(0, 0, 0, 0.55), 0 0 48px rgba(99, 102, 241, 0.14)';
const MUTED = '#94a3b8';
const BORDER = 'rgba(255, 255, 255, 0.12)';
const INPUT_BG = 'rgba(15, 23, 42, 0.65)';
const YEARLY_PER_USER = 32;
const MONTHLY_PER_USER = 40;

function IconCheckSmall(props) {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden {...props}>
            <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function IconClose(props) {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden {...props}>
            <path d="M18 6L6 18M6 6l12 12" />
        </svg>
    );
}

const fieldLabelStyle = {
    display: 'block',
    fontSize: 13,
    fontWeight: 500,
    color: MUTED,
    marginBottom: 8,
};

const inputBaseStyle = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '11px 14px',
    fontSize: 15,
    color: '#f1f5f9',
    background: INPUT_BG,
    border: `1px solid ${BORDER}`,
    borderRadius: 10,
    outline: 'none',
};

/**
 * “Tell us about your team” — matches Account shell (glass, cyan rim).
 * @param {object} props
 * @param {boolean} props.isOpen
 * @param {() => void} props.onClose
 * @param {(data: { teamName: string; memberCount: number; billing: 'yearly' | 'monthly'; shareAnalytics: boolean }) => void} [props.onContinue]
 */
export function CreateTeamModal({ isOpen, onClose, onContinue }) {
    const { t, currentLang } = useLanguage();
    const modalDir = currentLang === 'ar' || currentLang === 'ku' ? 'rtl' : 'ltr';
    const [teamName, setTeamName] = useState('');
    const [memberCount, setMemberCount] = useState(3);
    const [billing, setBilling] = useState('yearly');
    const [shareAnalytics, setShareAnalytics] = useState(true);

    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prev;
        };
    }, [isOpen, onClose]);

    const costs = useMemo(() => {
        const fullMonthly = memberCount * MONTHLY_PER_USER;
        const discounted = memberCount * YEARLY_PER_USER;
        return { fullMonthly, discounted };
    }, [memberCount]);

    const displayStrikethrough = billing === 'yearly';
    const primaryPrice = billing === 'yearly' ? costs.discounted : costs.fullMonthly;

    const billingOptions = useMemo(
        () => [
            {
                id: 'yearly',
                title: t('create_team_billingYearly'),
                badge: t('create_team_badgeSave'),
                price: fillI18nTemplate(t('create_team_priceUserMo'), { price: String(YEARLY_PER_USER) }),
            },
            {
                id: 'monthly',
                title: t('create_team_billingMonthly'),
                badge: null,
                price: fillI18nTemplate(t('create_team_priceUserMo'), { price: String(MONTHLY_PER_USER) }),
            },
        ],
        [t]
    );

    const handleContinue = () => {
        onContinue?.({
            teamName: teamName.trim() || t('create_team_defaultName'),
            memberCount,
            billing,
            shareAnalytics,
        });
        onClose();
    };

    if (!isOpen) return null;

    return createPortal(
        <>
            <div
                role="presentation"
                onClick={onClose}
                style={{
                    position: 'fixed',
                    inset: 0,
                    background: 'rgba(2, 6, 23, 0.78)',
                    backdropFilter: 'blur(10px)',
                    WebkitBackdropFilter: 'blur(10px)',
                    zIndex: 10050,
                }}
            />
            <div
                dir={modalDir}
                role="dialog"
                aria-modal="true"
                aria-labelledby="create-team-modal-title"
                className="create-team-modal"
                onClick={(e) => e.stopPropagation()}
                style={{
                    position: 'fixed',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: 'min(100% - 32px, 492px)',
                    maxHeight: 'min(92vh, 760px)',
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    background: SHELL_BG,
                    backdropFilter: 'blur(26px)',
                    WebkitBackdropFilter: 'blur(26px)',
                    border: SHELL_BORDER,
                    borderRadius: 20,
                    boxShadow: SHELL_SHADOW,
                    zIndex: 10051,
                    padding: '26px 24px 22px',
                    isolation: 'isolate',
                }}
            >
                <div
                    className="create-team-modal__accent"
                    aria-hidden
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: '12%',
                        right: '12%',
                        height: 3,
                        borderRadius: '0 0 8px 8px',
                        background: 'linear-gradient(90deg, transparent, rgba(56, 189, 248, 0.55), rgba(167, 139, 250, 0.55), transparent)',
                        opacity: 0.9,
                        pointerEvents: 'none',
                    }}
                />
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: 14,
                        marginBottom: 22,
                        position: 'relative',
                        zIndex: 1,
                    }}
                >
                    <div style={{ flex: 1, minWidth: 0, paddingRight: 4 }}>
                        <p
                            style={{
                                margin: '0 0 6px',
                                fontSize: 11,
                                fontWeight: 600,
                                letterSpacing: '0.14em',
                                textTransform: 'uppercase',
                                color: 'rgba(148, 163, 184, 0.95)',
                            }}
                        >
                            {t('create_team_kicker')}
                        </p>
                        <h2
                            id="create-team-modal-title"
                            className="create-team-modal__title"
                            style={{
                                margin: 0,
                                fontSize: 22,
                                fontWeight: 800,
                                letterSpacing: '-0.025em',
                                lineHeight: 1.28,
                                background: 'linear-gradient(135deg, #ffffff 0%, rgba(248, 250, 252, 0.92) 45%, rgba(226, 232, 240, 0.88) 100%)',
                                WebkitBackgroundClip: 'text',
                                backgroundClip: 'text',
                                color: 'transparent',
                                WebkitTextFillColor: 'transparent',
                            }}
                        >
                            {t('create_team_title')}
                        </h2>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="create-team-modal__close"
                        aria-label={t('adjust_plan_closeAria')}
                    >
                        <IconClose />
                    </button>
                </div>

                <div
                    style={{
                        position: 'relative',
                        zIndex: 1,
                        background: 'rgba(15, 23, 42, 0.38)',
                        border: `1px solid ${BORDER}`,
                        borderRadius: 14,
                        padding: '18px 18px 16px',
                        marginBottom: 20,
                        boxShadow: '0 0 0 1px rgba(255,255,255,0.04) inset',
                    }}
                >
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr',
                            gap: '18px 20px',
                        }}
                        className="create-team-modal-grid"
                    >
                    <div style={{ minWidth: 0 }}>
                        <label htmlFor="create-team-name" style={fieldLabelStyle}>
                            {t('create_team_labelName')}
                        </label>
                        <input
                            id="create-team-name"
                            type="text"
                            value={teamName}
                            onChange={(e) => setTeamName(e.target.value)}
                            placeholder={t('create_team_placeholderName')}
                            autoComplete="organization"
                            style={inputBaseStyle}
                        />
                    </div>
                    <div style={{ minWidth: 0 }}>
                        <span style={fieldLabelStyle}>{t('create_team_labelMembers')}</span>
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'stretch',
                                border: `1px solid ${BORDER}`,
                                borderRadius: 10,
                                overflow: 'hidden',
                                background: INPUT_BG,
                                height: 44,
                            }}
                        >
                            <button
                                type="button"
                                aria-label={t('create_team_decAria')}
                                className="btn btn-secondary"
                                onClick={() => setMemberCount((n) => Math.max(1, n - 1))}
                                style={{
                                    width: 44,
                                    minWidth: 44,
                                    padding: 0,
                                    borderRadius: 0,
                                    border: 'none',
                                    fontSize: 20,
                                    lineHeight: 1,
                                }}
                            >
                                −
                            </button>
                            <div
                                style={{
                                    flex: 1,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontWeight: 600,
                                    fontSize: 15,
                                    color: '#e2e8f0',
                                }}
                            >
                                {memberCount}
                            </div>
                            <button
                                type="button"
                                aria-label={t('create_team_incAria')}
                                className="btn btn-secondary"
                                onClick={() => setMemberCount((n) => Math.min(99, n + 1))}
                                style={{
                                    width: 44,
                                    minWidth: 44,
                                    padding: 0,
                                    borderRadius: 0,
                                    border: 'none',
                                    fontSize: 20,
                                    lineHeight: 1,
                                }}
                            >
                                +
                            </button>
                        </div>
                    </div>
                    </div>
                </div>

                <div style={{ marginBottom: 16, position: 'relative', zIndex: 1 }}>
                    <div
                        style={{
                            ...fieldLabelStyle,
                            marginBottom: 12,
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            fontSize: 11,
                            fontWeight: 700,
                            color: 'rgba(203, 213, 225, 0.88)',
                        }}
                    >
                        {t('create_team_billingHeading')}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }} className="create-team-modal-billing">
                        {billingOptions.map((opt) => {
                            const selected = billing === opt.id;
                            return (
                            <button
                                key={opt.id}
                                type="button"
                                data-selected={selected ? 'true' : 'false'}
                                className={`create-team-billing-card${selected ? ' create-team-billing-card--selected' : ''}`}
                                onClick={() => setBilling(opt.id)}
                                style={{
                                    position: 'relative',
                                    textAlign: modalDir === 'rtl' ? 'right' : 'left',
                                    padding: '15px 15px 17px',
                                    borderRadius: 14,
                                    cursor: 'pointer',
                                    background:
                                        selected ? 'rgba(56, 189, 248, 0.1)' : 'rgba(15, 23, 42, 0.45)',
                                    border:
                                        selected
                                            ? '1px solid rgba(56, 189, 248, 0.45)'
                                            : `1px solid ${BORDER}`,
                                    color: '#e2e8f0',
                                    transition:
                                        'border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease',
                                    boxShadow: selected
                                        ? '0 0 0 1px rgba(56, 189, 248, 0.2), 0 12px 32px rgba(0, 0, 0, 0.25), 0 0 24px rgba(56, 189, 248, 0.12)'
                                        : '0 4px 16px rgba(0, 0, 0, 0.12)',
                                    transform: selected ? 'translateY(-1px)' : 'none',
                                    fontFamily: 'inherit',
                                    outline: 'none',
                                }}
                            >
                                {selected ? (
                                    <span
                                        style={{
                                            position: 'absolute',
                                            top: 10,
                                            right: 10,
                                            width: 22,
                                            height: 22,
                                            borderRadius: '50%',
                                            background: 'linear-gradient(135deg, #38bdf8, #2563eb)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: '#fff',
                                        }}
                                        aria-hidden
                                    >
                                        <IconCheckSmall />
                                    </span>
                                ) : null}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                                    <span style={{ fontWeight: 600, fontSize: 15 }}>{opt.title}</span>
                                    {opt.badge ? (
                                        <span
                                            style={{
                                                fontSize: 11,
                                                fontWeight: 700,
                                                padding: '3px 8px',
                                                borderRadius: 999,
                                                background: 'rgba(34, 197, 94, 0.22)',
                                                color: '#86efac',
                                            }}
                                        >
                                            {opt.badge}
                                        </span>
                                    ) : null}
                                </div>
                                <div dir="ltr" style={{ fontSize: 14, color: MUTED }}>{opt.price}</div>
                            </button>
                            );
                        })}
                    </div>
                </div>

                <label
                    style={{
                        display: 'flex',
                        gap: 14,
                        alignItems: 'flex-start',
                        marginBottom: 22,
                        cursor: 'pointer',
                        padding: '16px 16px 17px',
                        borderRadius: 14,
                        border: `1px solid rgba(148, 163, 184, 0.12)`,
                        background: 'rgba(15, 23, 42, 0.32)',
                        position: 'relative',
                        zIndex: 1,
                        transition: 'border-color 0.2s ease, background 0.2s ease',
                    }}
                    className="create-team-analytics"
                >
                    <input
                        type="checkbox"
                        checked={shareAnalytics}
                        onChange={(e) => setShareAnalytics(e.target.checked)}
                        style={{
                            width: 18,
                            height: 18,
                            marginTop: 2,
                            accentColor: '#22d3ee',
                            flexShrink: 0,
                        }}
                    />
                    <span>
                        <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#f1f5f9', marginBottom: 4 }}>
                            {t('create_team_analyticsTitle')}
                        </span>
                        <span style={{ fontSize: 12, color: MUTED, lineHeight: 1.45 }}>
                            {t('create_team_analyticsDesc')}
                        </span>
                    </span>
                </label>

                <div
                    style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                        gap: 12,
                        marginBottom: 18,
                        borderTop: `1px solid ${BORDER}`,
                        paddingTop: 18,
                        position: 'relative',
                        zIndex: 1,
                    }}
                    className="create-team-summary"
                >
                    <span style={{ fontSize: 14, color: 'rgba(203, 213, 225, 0.88)', fontWeight: 500 }}>
                        {t('create_team_summaryLabel')}
                    </span>
                    <div dir="ltr" style={{ textAlign: modalDir === 'rtl' ? 'left' : 'right' }}>
                        {displayStrikethrough ? (
                            <span
                                style={{
                                    fontSize: 14,
                                    color: MUTED,
                                    textDecoration: 'line-through',
                                    marginRight: 10,
                                }}
                            >
                                {fillI18nTemplate(t('create_team_priceMo'), { price: String(costs.fullMonthly) })}
                            </span>
                        ) : null}
                        <span style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>
                            {fillI18nTemplate(t('create_team_priceMo'), { price: String(primaryPrice) })}
                        </span>
                    </div>
                </div>

                <button
                    type="button"
                    className="create-team-modal__submit btn btn-large"
                    onClick={handleContinue}
                    style={{
                        width: '100%',
                        position: 'relative',
                        zIndex: 1,
                        borderRadius: 12,
                        fontWeight: 700,
                        letterSpacing: '0.02em',
                        padding: '14px 20px',
                        border: 'none',
                        cursor: 'pointer',
                        background: 'linear-gradient(135deg, #38bdf8 0%, #22d3ee 26%, #a78bfa 58%, #c084fc 100%)',
                        backgroundSize: '200% auto',
                        color: '#fff',
                        boxShadow: '0 8px 28px rgba(99, 102, 241, 0.42), 0 2px 12px rgba(192, 132, 252, 0.2)',
                        transition: 'filter 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease',
                    }}
                >
                    {t('create_team_continue')}
                </button>
            </div>
            <style>{`
                .create-team-modal {
                    scrollbar-width: thin;
                    scrollbar-color: rgba(100,116,139,0.5) transparent;
                }
                .create-team-modal__close {
                    flex-shrink: 0;
                    width: 40px;
                    height: 40px;
                    padding: 0;
                    border-radius: 50%;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    border: 1px solid rgba(167, 139, 250, 0.32);
                    background: rgba(15, 12, 41, 0.55);
                    color: rgba(226, 232, 240, 0.92);
                    backdrop-filter: blur(8px);
                    -webkit-backdrop-filter: blur(8px);
                    cursor: pointer;
                    transition: transform 0.2s cubic-bezier(0.22, 1, 0.36, 1), background 0.2s ease, border-color 0.2s ease,
                        box-shadow 0.2s ease, color 0.2s ease;
                }
                .create-team-modal__close:hover {
                    color: #fff;
                    transform: rotate(90deg) scale(1.04);
                    background: rgba(167, 139, 250, 0.14);
                    border-color: rgba(192, 132, 252, 0.5);
                    box-shadow: 0 6px 20px rgba(167, 139, 250, 0.2);
                }
                .create-team-modal__close:active {
                    transform: rotate(90deg) scale(0.96);
                }
                .create-team-modal__close:focus-visible {
                    outline: 2px solid rgba(56, 189, 248, 0.65);
                    outline-offset: 3px;
                }
                .create-team-modal input#create-team-name:focus {
                    border-color: rgba(56, 189, 248, 0.45);
                    box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.12);
                }
                .create-team-modal .create-team-billing-card:not([data-selected="true"]):hover {
                    border-color: rgba(56, 189, 248, 0.25);
                    background: rgba(30, 41, 69, 0.45);
                    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.2);
                }
                .create-team-analytics:hover {
                    border-color: rgba(56, 189, 248, 0.2);
                    background: rgba(15, 23, 42, 0.45);
                }
                .create-team-modal__submit:hover {
                    filter: brightness(1.06);
                    box-shadow: 0 12px 36px rgba(167, 139, 250, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.06) inset;
                }
                .create-team-modal__submit:active {
                    transform: translateY(1px) scale(0.99);
                }
                .create-team-modal__submit:focus-visible {
                    outline: 2px solid rgba(226, 232, 240, 0.5);
                    outline-offset: 3px;
                }
                @media (max-width: 520px) {
                  .create-team-modal-grid {
                    grid-template-columns: 1fr !important;
                  }
                  .create-team-modal-billing {
                    grid-template-columns: 1fr !important;
                  }
                }
                @media (prefers-reduced-motion: reduce) {
                  .create-team-modal__close,
                  .create-team-billing-card,
                  .create-team-modal__submit {
                    transition: none !important;
                  }
                  .create-team-modal__close:hover {
                    transform: none;
                  }
                  .create-team-billing-card[data-selected='true'] {
                    transform: none !important;
                  }
                }
            `}</style>
        </>,
        document.body
    );
}

export default CreateTeamModal;
