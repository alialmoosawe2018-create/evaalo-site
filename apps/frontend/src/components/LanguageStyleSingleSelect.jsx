import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Single-choice menu using the same visuals as the nav language dropdown
 * (`.language-dropdown-menu` + `.language-option`).
 */
export default function LanguageStyleSingleSelect({
    id,
    value,
    onChange,
    options,
    placeholder = 'Select…',
    title,
    'aria-label': ariaLabel,
    listboxId: listboxIdProp,
    className = '',
    wrapperClassName = '',
    style,
    disabled = false,
}) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);
    const listboxId = listboxIdProp || (id ? `${id}-menu` : undefined);

    const selectedLabel = useMemo(
        () => options.find((o) => o.value === value)?.label ?? '',
        [options, value]
    );

    useEffect(() => {
        if (!open) return;
        const onDoc = (e) => {
            if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [open]);

    return (
        <div
            ref={rootRef}
            className={['position-suggest-combobox-wrapper', 'language-style-single-select', wrapperClassName, className]
                .filter(Boolean)
                .join(' ')}
            style={style}
        >
            <button
                type="button"
                id={id}
                className="language-style-single-select-trigger"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={listboxId}
                aria-label={ariaLabel}
                disabled={disabled}
                title={title}
                onClick={() => {
                    if (disabled) return;
                    setOpen((o) => !o);
                }}
            >
                <span className={selectedLabel ? 'language-style-single-select-value' : 'language-style-single-select-placeholder'}>
                    {selectedLabel || placeholder}
                </span>
                <span className="language-style-single-select-chevron" aria-hidden>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </span>
            </button>
            <div
                id={listboxId}
                className={`language-dropdown-menu position-suggest-dropdown language-style-single-select-menu ${open ? 'active' : ''}`}
                role="listbox"
                hidden={!open}
            >
                {/* The menu itself is `overflow: hidden` with a max-height (min(420px, 55vh),
                    and only 50vh on the application form). Scrolling is delegated to this
                    inner area — `position-suggest-dropdown-scroll` carries flex:1/min-height:0
                    /overflow-y:auto. PositionSuggestCombobox always rendered it; this menu did
                    not, so on a short viewport every option past the cap was clipped away with
                    no way to reach it. On a phone that hid most of the Job Level list and the
                    field read as frozen. `overscroll-behavior: contain` keeps a flick inside
                    the list instead of scrolling the page behind it. */}
                <div className="position-suggest-dropdown-scroll" style={{ overscrollBehavior: 'contain' }}>
                {options.map((opt, i) => {
                    const group = opt.group || '';
                    const startsGroup = group && group !== (options[i - 1]?.group || '');
                    return (
                        <React.Fragment key={opt.value}>
                            {startsGroup ? (
                                <div className="language-style-single-select-group" role="presentation">
                                    {group}
                                </div>
                            ) : null}
                            <button
                                type="button"
                                role="option"
                                aria-selected={value === opt.value}
                                className={`language-option ${value === opt.value ? 'active' : ''}`}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                    onChange(opt.value);
                                    setOpen(false);
                                }}
                            >
                                <span className="language-name">{opt.label}</span>
                            </button>
                        </React.Fragment>
                    );
                })}
                </div>
            </div>
        </div>
    );
}
