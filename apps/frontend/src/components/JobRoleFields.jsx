import React, { useCallback, useMemo } from 'react';
import {
    composeRoleResolution,
    fromJobLevelUiValue,
    getRepresentativeEntry,
    toJobLevelUiValue,
} from '@evaalo/job-catalog';
import { useLanguage } from '../contexts/LanguageContext';
import PositionSuggestCombobox from './PositionSuggestCombobox.jsx';
import CareerLevelSelect from './CareerLevelSelect.jsx';
import {
    applyRoleResolutionToState,
    RESEARCH_DOMAIN_OPTIONS,
} from '../utils/jobCatalogRole.js';

/**
 * Combined Position (role) + Job Level picker.
 * Position = roleKey only; careerLevel defaults to mid when level UI is empty.
 */
export default function JobRoleFields({
    roleKey = '',
    careerLevel = '',
    position = '',
    researchDomain = '',
    onStateChange,
    onRoleResolved,
    roleInputId,
    roleInputName = 'position',
    levelInputId,
    levelInputName = 'careerLevel',
    rolePlaceholder,
    levelPlaceholder,
    roleListboxId,
    disabled,
    roleRequired,
    layout = 'stacked',
    showSectionHint = true,
    showLevelField = true,
    showResearchDomainField = false,
    roleInputClassName = '',
    levelInputClassName = '',
    levelWrapperClassName = '',
    roleWrapperClassName = '',
    researchDomainClassName = '',
    roleInputStyle,
    roleChevronStyle,
    levelInputStyle,
    researchDomainStyle,
    roleOnFocus,
    roleOnBlur,
    levelOnFocus,
    levelOnBlur,
}) {
    const { t } = useLanguage();

    const sectionLabel = useMemo(() => {
        if (!showSectionHint || !roleKey) return '';
        const rep = getRepresentativeEntry(roleKey);
        if (!rep?.section) return '';
        return t(`positionCatalogSection_${rep.section}`) || rep.section;
    }, [roleKey, showSectionHint, t]);

    const showResearchDomain = showResearchDomainField || roleKey === 'researcher';

    const emitResolution = useCallback(
        (resolution) => {
            onRoleResolved?.(resolution);
            if (onStateChange) {
                onStateChange((prev) => applyRoleResolutionToState(prev, resolution));
            }
        },
        [onRoleResolved, onStateChange]
    );

    const handleRolePick = useCallback(
        (nextRoleKey, currentLevel) => {
            const rk = String(nextRoleKey || '').trim();
            if (!rk) {
                emitResolution({
                    roleKey: null,
                    careerLevel: '',
                    managementTrack: 'ic',
                    displayTitle: '',
                    confidence: 0,
                    matchSource: 'unknown',
                });
                return;
            }
            if (!getRepresentativeEntry(rk)) {
                return;
            }
            const levelUi = toJobLevelUiValue(rk, currentLevel || careerLevel);
            const effectiveLevel = fromJobLevelUiValue(rk, levelUi);
            const resolution = composeRoleResolution(rk, effectiveLevel);
            emitResolution(resolution);
        },
        [careerLevel, emitResolution]
    );

    const handleLevelPick = useCallback(
        (nextLevel) => {
            if (!roleKey) return;
            const resolution = composeRoleResolution(roleKey, nextLevel);
            emitResolution(resolution);
        },
        [roleKey, emitResolution]
    );

    const roleBlock = (
        <div className={roleWrapperClassName || undefined}>
            <PositionSuggestCombobox
                id={roleInputId}
                name={roleInputName}
                catalogMode="roleOnly"
                value={roleKey}
                onChange={(e) => handleRolePick(e.target.value, careerLevel)}
                onRoleResolved={(resolution) => {
                    if (resolution?.roleKey) {
                        const levelUi = toJobLevelUiValue(resolution.roleKey, careerLevel);
                        emitResolution(
                            composeRoleResolution(
                                resolution.roleKey,
                                fromJobLevelUiValue(resolution.roleKey, levelUi)
                            )
                        );
                    }
                }}
                placeholder={rolePlaceholder}
                required={roleRequired}
                disabled={disabled}
                showResolutionHint={false}
                listboxId={roleListboxId}
                className={roleInputClassName}
                inputStyle={roleInputStyle}
                chevronStyle={roleChevronStyle}
                onFocus={roleOnFocus}
                onBlur={roleOnBlur}
            />
            {sectionLabel ? (
                <span
                    className="job-role-section-hint"
                    style={{
                        display: 'block',
                        fontSize: '11px',
                        color: 'var(--text-muted, #64748b)',
                        marginTop: '4px',
                        paddingLeft: '2px',
                    }}
                >
                    {t('jobRole_section_label')}: {sectionLabel}
                </span>
            ) : null}
        </div>
    );

    const levelBlock = showLevelField ? (
        <div className={['job-role-level-field', levelWrapperClassName].filter(Boolean).join(' ')}>
            <CareerLevelSelect
                id={levelInputId}
                roleKey={roleKey}
                careerLevel={careerLevel}
                onChange={(nextLevel) => handleLevelPick(nextLevel)}
                placeholder={levelPlaceholder}
                disabled={disabled || !roleKey}
                className={levelInputClassName}
                wrapperStyle={levelInputStyle}
                listboxId={levelInputId ? `${levelInputId}-menu` : undefined}
                onFocus={levelOnFocus}
                onBlur={levelOnBlur}
            />
        </div>
    ) : null;

    const researchDomainBlock = showResearchDomain ? (
        <div className={researchDomainClassName || undefined}>
            <input
                type="text"
                list={roleInputId ? `${roleInputId}-research-domain` : 'research-domain-options'}
                value={researchDomain ?? ''}
                onChange={(e) => {
                    if (!onStateChange) return;
                    onStateChange((prev) => ({ ...prev, researchDomain: e.target.value }));
                }}
                placeholder={t('jobRole_research_domain_ph') || 'Research domain (optional): Energy, Market Intelligence…'}
                disabled={disabled}
                className={roleInputClassName}
                style={researchDomainStyle}
            />
            <datalist id={roleInputId ? `${roleInputId}-research-domain` : 'research-domain-options'}>
                {RESEARCH_DOMAIN_OPTIONS.map((d) => (
                    <option key={d} value={d} />
                ))}
            </datalist>
        </div>
    ) : null;

    if (layout === 'inline') {
        return (
            <div className="job-role-fields job-role-fields--inline">
                {roleBlock}
                {levelBlock}
                {researchDomainBlock}
            </div>
        );
    }

    return (
        <div className="job-role-fields job-role-fields--stacked">
            {roleBlock}
            {levelBlock}
            {researchDomainBlock}
        </div>
    );
}
