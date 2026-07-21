import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import '../design-styles.css';

const TIP_KEYS = [
  'voiceInterviewPrep_tip1',
  'voiceInterviewPrep_tip2',
  'voiceInterviewPrep_tip3',
  'voiceInterviewPrep_tip4',
];

/**
 * Pre-interview tips screen shown before the live voice interview UI.
 * On mobile the card fills the viewport; on desktop it stays as a centered card.
 */
const VoiceInterviewPrepTips = ({
  title,
  subtitle,
  onContinue,
  dir = 'ltr',
}) => {
  const { t } = useLanguage();
  const heading = title || t('voiceInterviewPrep_title');
  const sub = subtitle || t('voiceInterviewPrep_subtitle');

  return (
    <div className="voice-interview-prep" dir={dir}>
      <div className="voice-interview-prep__card">
        <div className="voice-interview-prep__shimmer" aria-hidden />
        <div className="voice-interview-prep__header">
          <h1 className="voice-interview-prep__title">{heading}</h1>
          {sub ? <p className="voice-interview-prep__subtitle">{sub}</p> : null}
        </div>

        <ul className="voice-interview-prep__tips">
          {TIP_KEYS.map((key) => (
            <li key={key} className="voice-interview-prep__tip">
              <span className="voice-interview-prep__tip-check" aria-hidden>
                ✓
              </span>
              <span className="voice-interview-prep__tip-text">{t(key)}</span>
            </li>
          ))}
        </ul>

        <div className="voice-interview-prep__actions">
          <button
            type="button"
            className="workflow-btn-primary ni-continue-btn voice-interview-prep__continue"
            onClick={onContinue}
          >
            {t('voiceInterviewPrep_continue')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default VoiceInterviewPrepTips;
