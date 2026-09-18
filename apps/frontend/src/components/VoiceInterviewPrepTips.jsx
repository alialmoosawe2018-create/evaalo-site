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
 *
 * `continueDisabled` / `statusNote` / `onRetry` are the readiness gate: the video
 * path holds the candidate here until the campaign's competencies exist, because
 * a specialist interview that starts without them is graded against a rubric it
 * never asked about (measured: coverage 0.22, 0.11, 0, 0.33 — one scored zero).
 *
 * ⚠️ All three are OPTIONAL and default to today's behaviour. This screen is
 * shared with the voice interview, which has no blueprint to wait for and must
 * not be gated.
 */
const VoiceInterviewPrepTips = ({
  title,
  subtitle,
  onContinue,
  dir = 'ltr',
  continueDisabled = false,
  statusNote = '',
  onRetry = null,
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

        {statusNote ? (
          <p className="voice-interview-prep__status" role="status" aria-live="polite">
            {statusNote}
          </p>
        ) : null}

        <div className="voice-interview-prep__actions">
          <button
            type="button"
            className="workflow-btn-primary ni-continue-btn voice-interview-prep__continue"
            onClick={onContinue}
            disabled={continueDisabled}
            aria-disabled={continueDisabled}
          >
            {t('voiceInterviewPrep_continue')}
          </button>
          {/* Only for a terminal failure. A generation still running needs no
              button — polling restarts it on its own. */}
          {onRetry ? (
            <button
              type="button"
              className="ni-continue-btn voice-interview-prep__retry"
              onClick={onRetry}
            >
              {t('voiceInterviewPrep_retry')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default VoiceInterviewPrepTips;
