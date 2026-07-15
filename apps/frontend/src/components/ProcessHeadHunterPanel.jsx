import React, { useId } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

const HeadHunterPerson = ({ cx, cy, scale = 1 }) => (
    <g transform={`translate(${cx} ${cy}) scale(${scale})`}>
        <circle cy="-1.8" r="2.2" />
        <path d="M-3.6 2.2c0-2 1.6-3.6 3.6-3.6s3.6 1.6 3.6 3.6v2.8H-3.6V2.2Z" />
    </g>
);

const HeadHunterSearchIcon = () => {
    const lensClipId = useId();

    return (
        <div className="step-icon process-head-hunter-card__icon" aria-hidden="true">
            <svg width="40" height="40" viewBox="0 0 48 48" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <clipPath id={lensClipId}>
                        <circle cx="23.5" cy="30.5" r="9.8" />
                    </clipPath>
                </defs>

                <HeadHunterPerson cx={11.5} cy={10.5} scale={0.82} />
                <HeadHunterPerson cx={24} cy={7.5} scale={0.88} />
                <HeadHunterPerson cx={36.5} cy={10.5} scale={0.82} />
                <HeadHunterPerson cx={16.5} cy={14.5} scale={0.72} />
                <HeadHunterPerson cx={32.5} cy={14.5} scale={0.72} />

                <g clipPath={`url(#${lensClipId})`}>
                    <HeadHunterPerson cx={18.5} cy={30.5} scale={0.78} />
                    <HeadHunterPerson cx={28.5} cy={30.5} scale={0.78} />
                    <HeadHunterPerson cx={23.5} cy={27.5} scale={0.92} />
                </g>

                <circle
                    cx="23.5"
                    cy="30.5"
                    r="11"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.8"
                />
                <path
                    d="M32.2 38.2 40.8 44.2"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.8"
                    strokeLinecap="round"
                />
            </svg>
        </div>
    );
};

const HeadHunterInterviewIcon = () => (
    <div className="step-icon process-head-hunter-card__icon process-head-hunter-card__icon--interview" aria-hidden="true">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3" y="6" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
            <path
                d="M16 10l5-3v10l-5-3"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    </div>
);

export default function ProcessHeadHunterPanel() {
    const { t } = useLanguage();

    return (
        <div className="process-head-hunter-cards-row">
            <div
                className="process-step process-head-hunter-card process-head-hunter-card--reveal process-stage-back-card--from-left"
                style={{ '--process-reveal-delay': '0s' }}
            >
                <HeadHunterSearchIcon />
                <div className="process-head-hunter-panel__body">
                    <h3 className="step-title">{t('headHunterPageP1')}</h3>
                    <p className="step-description">{t('headHunterPageP2')}</p>
                </div>
            </div>
            <div
                className="process-step process-head-hunter-card process-head-hunter-card--reveal process-stage-back-card--from-right"
                style={{ '--process-reveal-delay': '0.18s' }}
            >
                <HeadHunterInterviewIcon />
                <div className="process-head-hunter-panel__body">
                    <h3 className="step-title">{t('headHunterPageP3')}</h3>
                    <p className="step-description">{t('headHunterPageP4')}</p>
                    <p className="step-description">{t('headHunterPageP5')}</p>
                </div>
            </div>
        </div>
    );
}
