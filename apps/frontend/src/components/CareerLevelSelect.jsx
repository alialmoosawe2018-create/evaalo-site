import React, { useMemo } from 'react';
import {
    fromJobLevelUiValue,
    getLevelsForRoleUI,
    toJobLevelUiValue,
    UI_CAREER_LEVELS,
} from '@evaalo/job-catalog';
import { useLanguage } from '../contexts/LanguageContext';
import LanguageStyleSingleSelect from './LanguageStyleSingleSelect.jsx';

/**
 * Job Level dropdown — careerLevel only (mid is implicit, not listed).
 * Uses the same menu UI as other site dropdowns (LanguageStyleSingleSelect).
 */
export default function CareerLevelSelect({
    id,
    roleKey,
    careerLevel,
    onChange,
    placeholder,
    title,
    className = '',
    wrapperClassName = '',
    wrapperStyle,
    disabled,
    listboxId,
}) {
    const { t } = useLanguage();

    const uiValue = useMemo(() => {
        const rk = String(roleKey || '').trim();
        const cl = String(careerLevel || '').trim();
        if (!rk) {
            return cl && cl !== 'mid' ? cl : '';
        }
        return toJobLevelUiValue(rk, careerLevel);
    }, [roleKey, careerLevel]);

    const availableLevels = useMemo(
        () => (roleKey ? getLevelsForRoleUI(roleKey) : UI_CAREER_LEVELS),
        [roleKey]
    );

    const levelOptions = useMemo(() => {
        const levels = availableLevels.length > 0 ? availableLevels : UI_CAREER_LEVELS;
        return levels.map((level) => ({
            value: level,
            label: t(`careerLevel_${level}`) || level,
        }));
    }, [availableLevels, t]);

    const mergedClassName = ['ni-career-level-select', 'career-level-select', className]
        .filter(Boolean)
        .join(' ');

    return (
        <LanguageStyleSingleSelect
            id={id}
            value={uiValue}
            onChange={(picked) => {
                if (!onChange) return;
                const rk = String(roleKey || '').trim();
                const nextLevel = rk ? fromJobLevelUiValue(rk, picked) : picked || 'mid';
                onChange(nextLevel, picked);
            }}
            options={levelOptions}
            placeholder={placeholder || t('jobRole_level_placeholder')}
            title={title}
            aria-label={t('newCampaign_jc_job_label')}
            listboxId={listboxId || (id ? `${id}-menu` : undefined)}
            className={mergedClassName}
            wrapperClassName={wrapperClassName}
            style={wrapperStyle}
            disabled={disabled || levelOptions.length === 0}
        />
    );
}
