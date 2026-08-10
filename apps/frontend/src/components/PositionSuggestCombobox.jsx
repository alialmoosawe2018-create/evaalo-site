import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { POSITION_CATALOG_OPTIONS, POSITION_SUGGESTIONS, ROLE_CATALOG_OPTIONS } from '../constants/positionSuggestions.js';
import { composeRoleResolution, resolveJobRole, SECTION_ORDER } from '@evaalo/job-catalog';
import { useLanguage } from '../contexts/LanguageContext';
import positionLabelsAr from '../constants/positionLabels.ar.json';
import positionLabelsKu from '../constants/positionLabels.ku.json';
import locationLabelsAr from '../constants/locationLabels.ar.json';
import locationLabelsKu from '../constants/locationLabels.ku.json';

/**
 * Hybrid position combobox: catalog pick + free-text with resolveJobRole on blur.
 * catalogMode="full" — legacy flat JOB_CATALOG titles (non-position fields only).
 * catalogMode="roleOnly" — Position picker (roleKey + separate Job Level).
 */
export default function PositionSuggestCombobox({
    id,
    name,
    value,
    onChange,
    onRoleResolved,
    onFocus: onFocusProp,
    onBlur: onBlurProp,
    onKeyDown: onKeyDownProp,
    placeholder,
    className = '',
    required,
    disabled,
    autoComplete = 'off',
    suggestions = POSITION_SUGGESTIONS,
    suggestionOptions: suggestionOptionsProp,
    catalogMode = 'full',
    inputStyle,
    chevronStyle,
    listboxId: listboxIdProp,
    wrapperClassName = '',
    showResolutionHint = true,
}) {
    const { currentLang, t } = useLanguage();
    const wrapperRef = useRef(null);
    const inputWrapRef = useRef(null);
    const dropdownRef = useRef(null);
    const blurCloseTimer = useRef(null);
    const [modalDropdownMaxHeight, setModalDropdownMaxHeight] = useState(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const [resolutionHint, setResolutionHint] = useState('');
    const listboxId = listboxIdProp || (id ? `${id}-suggestions` : undefined);

    const labelCatalog = useMemo(() => {
        if (currentLang === 'ar') return { ...positionLabelsAr, ...locationLabelsAr };
        if (currentLang === 'ku') return { ...positionLabelsKu, ...locationLabelsKu };
        return null;
    }, [currentLang]);

    const usePositionCatalog =
        !suggestionOptionsProp?.length &&
        suggestions === POSITION_SUGGESTIONS &&
        (catalogMode === 'full' || catalogMode === 'roleOnly');

    const useRoleOnlyCatalog = usePositionCatalog && catalogMode === 'roleOnly';

    const effectiveSuggestionOptions = useMemo(() => {
        if (suggestionOptionsProp?.length) {
            return suggestionOptionsProp.map((o) => ({
                ...o,
                label: labelCatalog?.[o.labelKey] ?? labelCatalog?.[o.value] ?? o.label ?? o.value,
            }));
        }
        if (!usePositionCatalog) {
            return [];
        }
        const base = useRoleOnlyCatalog
            ? ROLE_CATALOG_OPTIONS
            : POSITION_CATALOG_OPTIONS.length
              ? POSITION_CATALOG_OPTIONS
              : suggestions.map((en) => ({ value: en, labelKey: en, label: en }));
        return base.map((o) => ({
            ...o,
            label:
                labelCatalog?.[o.labelKey]
                ?? (useRoleOnlyCatalog && o.roleKey
                    ? labelCatalog?.[`${o.roleKey}.mid`]
                      ?? labelCatalog?.[`${o.roleKey}.manager`]
                      ?? labelCatalog?.[`${o.roleKey}.executive`]
                      ?? labelCatalog?.[`${o.roleKey}.head`]
                      ?? labelCatalog?.[`${o.roleKey}.senior`]
                    : undefined)
                ?? labelCatalog?.[o.value]
                ?? (o.label ? labelCatalog?.[o.label] : undefined)
                ?? o.label
                ?? (typeof o.value === 'string' ? o.value.replace(/_/g, ' ') : o.value),
        }));
    }, [suggestionOptionsProp, suggestions, labelCatalog, usePositionCatalog, useRoleOnlyCatalog]);

    const useOptionsMode = effectiveSuggestionOptions.length > 0;

    const labelByValue = useMemo(() => {
        if (!useOptionsMode) return null;
        return Object.fromEntries(effectiveSuggestionOptions.map((o) => [o.value, o.label]));
    }, [useOptionsMode, effectiveSuggestionOptions]);

    const optionByValue = useMemo(() => {
        if (!useOptionsMode) return null;
        return Object.fromEntries(effectiveSuggestionOptions.map((o) => [o.value, o]));
    }, [useOptionsMode, effectiveSuggestionOptions]);

    const displayFromStored = useCallback(
        (v) => {
            if (v == null || v === '') return '';
            if (labelByValue && Object.prototype.hasOwnProperty.call(labelByValue, v)) {
                return labelByValue[v];
            }
            return String(v);
        },
        [labelByValue]
    );

    const [text, setText] = useState(() => displayFromStored(value));

    useEffect(() => {
        setText(displayFromStored(value));
    }, [value, displayFromStored]);

    const fireRoleResolved = useCallback(
        (storedValue, opt) => {
            if (!onRoleResolved) return;
            if (useRoleOnlyCatalog && opt?.roleKey) {
                const resolution = composeRoleResolution(opt.roleKey);
                onRoleResolved({
                    ...resolution,
                    domain: opt.domain,
                    specialization: opt.specialization,
                    matchSource: 'exact_catalog',
                    confidence: 0.98,
                });
                setResolutionHint('');
                return;
            }
            if (opt?.roleKey) {
                onRoleResolved({
                    roleKey: opt.roleKey,
                    careerLevel: opt.careerLevel,
                    managementTrack: opt.managementTrack,
                    displayTitle: opt.value,
                    labelKey: opt.labelKey,
                    domain: opt.domain,
                    specialization: opt.specialization,
                    matchSource: 'exact_catalog',
                    confidence: 0.95,
                });
                if (showResolutionHint) {
                    setResolutionHint(
                        opt.roleKey
                            ? `${opt.roleKey.replace(/_/g, ' ')} · ${opt.careerLevel}`
                            : ''
                    );
                }
                return;
            }
            const resolved = resolveJobRole(storedValue);
            onRoleResolved(resolved);
            if (showResolutionHint) {
                if (resolved.roleKey) {
                    setResolutionHint(`${resolved.roleKey.replace(/_/g, ' ')} · ${resolved.careerLevel}`);
                } else if (resolved.matchSource === 'ambiguous_legacy') {
                    setResolutionHint('Ambiguous title — domain from job description');
                } else {
                    setResolutionHint('');
                }
            } else {
                setResolutionHint('');
            }
        },
        [onRoleResolved, showResolutionHint, useRoleOnlyCatalog]
    );

    const resolveStoredFromText = useCallback(
        (typed) => {
            if (!useOptionsMode) return typed;
            const trimmed = typed.trim();
            if (!trimmed) return '';
            const byLabel = effectiveSuggestionOptions.find(
                (o) => o.label.toLowerCase() === trimmed.toLowerCase()
            );
            if (byLabel) return byLabel.value;
            const byVal = effectiveSuggestionOptions.find(
                (o) => o.value.toLowerCase() === trimmed.toLowerCase()
            );
            if (byVal) return byVal.value;
            return typed;
        },
        [useOptionsMode, effectiveSuggestionOptions]
    );

    const plainSuggestionLabels = useMemo(() => {
        if (useOptionsMode || !labelCatalog) return null;
        return Object.fromEntries(
            suggestions.map((s) => [s, labelCatalog[s] ?? s])
        );
    }, [useOptionsMode, labelCatalog, suggestions]);

    const filtered = useMemo(() => {
        if (!useOptionsMode) {
            const q = String(value ?? text ?? '').trim().toLowerCase();
            if (!q) return suggestions;
            return suggestions.filter((x) => {
                const label = plainSuggestionLabels?.[x] ?? x;
                return (
                    String(x).toLowerCase().includes(q) ||
                    String(label).toLowerCase().includes(q)
                );
            });
        }
        const q = String(text ?? '').trim().toLowerCase();
        if (!q) return effectiveSuggestionOptions;
        return effectiveSuggestionOptions.filter(
            (o) =>
                o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
        );
    }, [useOptionsMode, text, value, suggestions, effectiveSuggestionOptions, plainSuggestionLabels]);

    /** Group catalog options by section (HR, Technology, Oil & Gas, …) for the dropdown. */
    const groupedBySection = useMemo(() => {
        if (!useOptionsMode || !usePositionCatalog) return null;
        const bySection = new Map();
        for (const opt of filtered) {
            const sec = opt.section || 'admin';
            if (!bySection.has(sec)) bySection.set(sec, []);
            bySection.get(sec).push(opt);
        }
        return SECTION_ORDER.filter((sec) => bySection.has(sec)).map((sec) => ({
            section: sec,
            label: t(`positionCatalogSection_${sec}`) || sec,
            options: bySection.get(sec),
        }));
    }, [useOptionsMode, usePositionCatalog, filtered, t]);

    const menuItemCount = groupedBySection
        ? groupedBySection.reduce((n, g) => n + g.options.length, 0)
        : filtered.length;

    const showMenu = menuOpen && menuItemCount > 0 && !disabled;

    const listScrollRef = useRef(null);
    const sectionRefs = useRef(new Map());
    const scrollSyncRaf = useRef(null);
    const activeSectionLabelRef = useRef('');
    const [activeSectionLabel, setActiveSectionLabel] = useState('');

    const resolveActiveSectionLabel = useCallback(() => {
        const el = listScrollRef.current;
        if (!el || !groupedBySection?.length) return '';
        const y = el.scrollTop + 10;
        let current = groupedBySection[0];
        for (const group of groupedBySection) {
            const node = sectionRefs.current.get(group.section);
            if (node && node.offsetTop <= y) current = group;
        }
        return current.label;
    }, [groupedBySection]);

    const syncActiveSectionFromScroll = useCallback(() => {
        const nextLabel = resolveActiveSectionLabel();
        if (!nextLabel || nextLabel === activeSectionLabelRef.current) return;
        activeSectionLabelRef.current = nextLabel;
        setActiveSectionLabel(nextLabel);
    }, [resolveActiveSectionLabel]);

    const handleListScroll = useCallback(() => {
        if (scrollSyncRaf.current != null) return;
        scrollSyncRaf.current = requestAnimationFrame(() => {
            scrollSyncRaf.current = null;
            syncActiveSectionFromScroll();
        });
    }, [syncActiveSectionFromScroll]);

    useEffect(() => {
        if (!showMenu || !groupedBySection?.length) {
            activeSectionLabelRef.current = '';
            setActiveSectionLabel('');
            return;
        }
        const initialLabel = groupedBySection[0].label;
        activeSectionLabelRef.current = initialLabel;
        setActiveSectionLabel(initialLabel);
        const el = listScrollRef.current;
        if (el) el.scrollTop = 0;
    }, [showMenu, groupedBySection]);

    useEffect(() => {
        if (!showMenu) return;
        syncActiveSectionFromScroll();
    }, [showMenu, groupedBySection, syncActiveSectionFromScroll]);

    useEffect(
        () => () => {
            if (scrollSyncRaf.current != null) {
                cancelAnimationFrame(scrollSyncRaf.current);
                scrollSyncRaf.current = null;
            }
        },
        []
    );

    const clearCloseTimer = () => {
        if (blurCloseTimer.current) {
            clearTimeout(blurCloseTimer.current);
            blurCloseTimer.current = null;
        }
    };

    const emitChange = useCallback(
        (nextValue, opt) => {
            if (!onChange) return;
            onChange({ target: { name: name ?? '', value: nextValue } });
            fireRoleResolved(nextValue, opt);
        },
        [name, onChange, fireRoleResolved]
    );

    const pickSuggestion = (item) => {
        clearCloseTimer();
        if (useOptionsMode && item && typeof item === 'object' && 'value' in item) {
            setText(item.label);
            emitChange(item.value, item);
        } else {
            emitChange(item);
        }
        setMenuOpen(false);
    };

    useEffect(() => {
        if (!showMenu) return;
        const onDocDown = (e) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
                setMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', onDocDown);
        return () => document.removeEventListener('mousedown', onDocDown);
    }, [showMenu]);

    const updateModalDropdownMaxHeight = useCallback(() => {
        const wrap = inputWrapRef.current;
        if (!wrap || !wrapperRef.current?.closest('.new-interview-modal')) {
            setModalDropdownMaxHeight(null);
            return;
        }
        const shell = wrapperRef.current.closest('.ni-job-details-shell');
        const footer = shell?.querySelector('.ni-continue-footer');
        if (!footer) {
            setModalDropdownMaxHeight(null);
            return;
        }
        const gap = 10;
        const preferMax = Math.min(420, window.innerHeight * 0.55);
        const available = footer.getBoundingClientRect().top - wrap.getBoundingClientRect().bottom - gap;
        const maxHeight = Math.max(120, Math.min(preferMax, available));
        setModalDropdownMaxHeight(`${maxHeight}px`);
    }, []);

    useLayoutEffect(() => {
        if (!showMenu) {
            setModalDropdownMaxHeight(null);
            return undefined;
        }
        updateModalDropdownMaxHeight();
        window.addEventListener('resize', updateModalDropdownMaxHeight);
        window.addEventListener('scroll', updateModalDropdownMaxHeight, true);
        return () => {
            window.removeEventListener('resize', updateModalDropdownMaxHeight);
            window.removeEventListener('scroll', updateModalDropdownMaxHeight, true);
        };
    }, [showMenu, updateModalDropdownMaxHeight]);

    useEffect(() => () => clearCloseTimer(), []);

    return (
        <div
            className={['position-suggest-combobox-wrapper', wrapperClassName].filter(Boolean).join(' ')}
            ref={wrapperRef}
        >
            <div className="position-suggest-input-wrap" ref={inputWrapRef}>
                <input
                    type="text"
                    id={id}
                    name={name}
                    value={useOptionsMode ? text : (value ?? '')}
                    onChange={(e) => {
                        const raw = e.target.value;
                        if (useOptionsMode) {
                            setText(raw);
                            const trimmed = raw.trim();
                            // Commit only on exact catalog match or clear — never fuzzy-resolve while typing
                            // (short tokens like "st"/"er" used to snap to unrelated titles e.g. Customer Success Specialist).
                            if (!trimmed) {
                                emitChange('', null);
                            } else {
                                const exact = effectiveSuggestionOptions.find(
                                    (o) =>
                                        String(o.label).toLowerCase() === trimmed.toLowerCase() ||
                                        String(o.value).toLowerCase() === trimmed.toLowerCase()
                                );
                                if (exact) {
                                    emitChange(exact.value, exact);
                                }
                            }
                        } else {
                            onChange?.(e);
                        }
                        setMenuOpen(true);
                    }}
                    onKeyDown={(e) => {
                        onKeyDownProp?.(e);
                    }}
                    onFocus={(e) => {
                        clearCloseTimer();
                        setMenuOpen(true);
                        onFocusProp?.(e);
                    }}
                    onBlur={(e) => {
                        blurCloseTimer.current = setTimeout(() => setMenuOpen(false), 180);
                        if (useOptionsMode) {
                            const trimmed = String(text ?? '').trim();
                            if (!trimmed) {
                                emitChange('', null);
                            } else {
                                const exact = effectiveSuggestionOptions.find(
                                    (o) =>
                                        String(o.label).toLowerCase() === trimmed.toLowerCase() ||
                                        String(o.value).toLowerCase() === trimmed.toLowerCase()
                                );
                                if (exact) {
                                    setText(exact.label);
                                    emitChange(exact.value, exact);
                                } else if (useRoleOnlyCatalog) {
                                    // Role picker: incomplete typing does not invent a role — revert display
                                    setText(displayFromStored(value));
                                } else {
                                    const stored = resolveStoredFromText(trimmed);
                                    const opt = optionByValue?.[stored];
                                    if (opt) {
                                        setText(opt.label);
                                        emitChange(opt.value, opt);
                                    } else {
                                        // Free text: resolve only confident catalog/alias hits (not weak fuzzy)
                                        const resolved = resolveJobRole(trimmed);
                                        const confident =
                                            resolved.roleKey &&
                                            (resolved.matchSource === 'exact_catalog' ||
                                                resolved.matchSource === 'legacy_alias' ||
                                                (resolved.matchSource === 'fuzzy' &&
                                                    resolved.confidence >= 0.85 &&
                                                    trimmed.length >= 4));
                                        if (confident) {
                                            fireRoleResolved(trimmed, null);
                                        } else {
                                            emitChange(trimmed, null);
                                        }
                                    }
                                }
                            }
                        }
                        onBlurProp?.(e);
                    }}
                    placeholder={placeholder}
                    className={className}
                    required={required}
                    disabled={disabled}
                    autoComplete={autoComplete}
                    aria-expanded={showMenu}
                    aria-controls={listboxId}
                    aria-autocomplete="list"
                    role="combobox"
                    style={inputStyle ? { paddingRight: '2.75rem', ...inputStyle } : { paddingRight: '2.75rem' }}
                />
                <span
                    aria-hidden
                    className="position-suggest-chevron"
                    style={{
                        position: 'absolute',
                        right: '14px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        pointerEvents: 'none',
                        color: 'var(--primary-color, #6366f1)',
                        opacity: 0.85,
                        display: 'flex',
                        alignItems: 'center',
                        ...(chevronStyle || {}),
                    }}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </span>
                <div
                    ref={dropdownRef}
                    id={listboxId}
                    className={`language-dropdown-menu position-suggest-dropdown ${showMenu ? 'active' : ''}${groupedBySection ? ' position-suggest-dropdown--grouped' : ''}`}
                    role="listbox"
                    hidden={!showMenu}
                    style={modalDropdownMaxHeight ? { maxHeight: modalDropdownMaxHeight } : undefined}
                >
                    <div
                        className="position-suggest-dropdown-scroll"
                        ref={listScrollRef}
                        onScroll={groupedBySection ? handleListScroll : undefined}
                    >
                        {useOptionsMode
                            ? groupedBySection
                                ? groupedBySection.map((group) => (
                                  <div
                                      key={group.section}
                                      className="position-suggest-section"
                                      role="presentation"
                                      ref={(node) => {
                                          if (node) sectionRefs.current.set(group.section, node);
                                          else sectionRefs.current.delete(group.section);
                                      }}
                                  >
                                      <div
                                          className="position-suggest-section-heading nav-product-dropdown-heading"
                                          role="presentation"
                                      >
                                          {group.label}
                                      </div>
                                      {group.options.map((opt) => (
                                          <button
                                              key={`${group.section}-${opt.labelKey || opt.value}`}
                                              type="button"
                                              className={`language-option ${String(value ?? '') === opt.value ? 'active' : ''}`}
                                              role="option"
                                              aria-selected={String(value ?? '') === opt.value}
                                              onMouseDown={(e) => e.preventDefault()}
                                              onClick={() => pickSuggestion(opt)}
                                          >
                                              <span className="language-name">{opt.label}</span>
                                          </button>
                                      ))}
                                  </div>
                              ))
                            : filtered.map((opt) => (
                                  <button
                                      key={`${opt.labelKey || opt.value}`}
                                      type="button"
                                      className={`language-option ${String(value ?? '') === opt.value ? 'active' : ''}`}
                                      role="option"
                                      aria-selected={String(value ?? '') === opt.value}
                                      onMouseDown={(e) => e.preventDefault()}
                                      onClick={() => pickSuggestion(opt)}
                                  >
                                      <span className="language-name">{opt.label}</span>
                                  </button>
                              ))
                        : filtered.map((title) => (
                              <button
                                  key={title}
                                  type="button"
                                  className={`language-option ${String(value ?? '') === title ? 'active' : ''}`}
                                  role="option"
                                  aria-selected={String(value ?? '') === title}
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => pickSuggestion(title)}
                              >
                                  <span className="language-name">
                                      {plainSuggestionLabels?.[title] ?? title}
                                  </span>
                              </button>
                          ))}
                </div>
                {groupedBySection && activeSectionLabel ? (
                    <div
                        className="position-suggest-section-indicator nav-product-dropdown-heading"
                        aria-live="polite"
                        aria-atomic="true"
                    >
                        {activeSectionLabel}
                    </div>
                ) : null}
            </div>
            </div>
            {showResolutionHint && resolutionHint ? (
                <span
                    className="position-suggest-resolution-hint"
                    style={{
                        display: 'block',
                        fontSize: '11px',
                        color: 'var(--text-muted, #64748b)',
                        marginTop: '4px',
                        paddingLeft: '2px',
                    }}
                >
                    {resolutionHint}
                </span>
            ) : null}
        </div>
    );
}
