import React, { useMemo } from 'react';
import {
    fromJobLevelUiValue,
    getLevelOptionsForRoleUI,
    toJobLevelUiValue,
    UI_CAREER_LEVELS,
} from '@evaalo/job-catalog';
import { useLanguage } from '../contexts/LanguageContext';
import LanguageStyleSingleSelect from './LanguageStyleSingleSelect.jsx';

/** Sentinel for clearing back to the implicit default, which stores as ''. */
const CLEAR_VALUE = '__none__';

/**
 * Job Level dropdown — careerLevel only (mid is implicit, not listed).
 *
 * Every level stays selectable: the ones the catalog defines for the role are
 * grouped as recommended, the rest below them. Uses the same menu UI as other
 * site dropdowns (LanguageStyleSingleSelect).
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

    const levelOptions = useMemo(() => {
        const toOption = (level, group) => ({
            value: level,
            label: t(`careerLevel_${level}`) || level,
            group,
        });

        if (!roleKey) {
            return UI_CAREER_LEVELS.map((level) => toOption(level, ''));
        }

        const { recommended, other } = getLevelOptionsForRoleUI(roleKey);
        const grouped = recommended.length > 0;
        const options = [
            ...recommended.map((l) => toOption(l, grouped ? t('jobRole_level_group_recommended') : '')),
            ...other.map((l) => toOption(l, grouped ? t('jobRole_level_group_other') : '')),
        ];

        if (uiValue) {
            options.unshift({ value: CLEAR_VALUE, label: t('jobRole_level_none'), group: '' });
        }

        return options;
    }, [roleKey, uiValue, t]);

    const mergedClassName = ['ni-career-level-select', 'career-level-select', className]
        .filter(Boolean)
        .join(' ');

    return (
        <LanguageStyleSingleSelect
            id={id}
            value={uiValue}
            onChange={(picked) => {
                if (!onChange) return;
                const uiPicked = picked === CLEAR_VALUE ? '' : picked;
                const rk = String(roleKey || '').trim();
                const nextLevel = rk ? fromJobLevelUiValue(rk, uiPicked) : uiPicked || 'mid';
                onChange(nextLevel, uiPicked);
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
