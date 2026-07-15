import React, { useMemo } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { CampaignReadyIcon } from './CampaignReadyIcon.jsx';
import { CAMPAIGN_READY_OPTIONS } from '../constants/campaignReadyOptions.js';

const HOW_WORKS_ICON_TYPES = ['rocket', 'form', 'phone', 'video'];

export default function ProcessHowWorksPanel() {
    const { t } = useLanguage();

    const cards = useMemo(
        () =>
            HOW_WORKS_ICON_TYPES.map((iconType, index) => {
                const theme = CAMPAIGN_READY_OPTIONS[index];
                return {
                    number: String(index + 1).padStart(2, '0'),
                    titleKey: `processHowWorks${index + 1}Title`,
                    descKey: `processHowWorks${index + 1}Description`,
                    iconType,
                    accent: theme?.accent ?? '#3b82f6',
                    accent2: theme?.accent2 ?? '#06b6d4',
                };
            }),
        []
    );

    return (
        <div className="process-how-works-row">
            {cards.map((card, index) => (
                <React.Fragment key={card.number}>
                    <div
                        className="process-step process-step--how-works process-step--reveal process-step--reveal-flow process-how-card--reveal"
                        style={{
                            '--process-reveal-delay': `${index * 0.16}s`,
                            '--ni-c1': card.accent,
                            '--ni-c2': card.accent2,
                        }}
                    >
                        <div className="step-number">{card.number}</div>
                        <div className="process-how-works-icon-wrap">
                            <CampaignReadyIcon type={card.iconType} color="#ffffff" size={28} />
                        </div>
                        <h3 className="step-title">{t(card.titleKey)}</h3>
                        <p className="step-description">{t(card.descKey)}</p>
                    </div>
                    {index < cards.length - 1 ? (
                        <div
                            className="process-connector process-connector--reveal"
                            style={{ '--process-reveal-delay': `${index * 0.16 + 0.08}s` }}
                            aria-hidden
                        />
                    ) : null}
                </React.Fragment>
            ))}
        </div>
    );
}
