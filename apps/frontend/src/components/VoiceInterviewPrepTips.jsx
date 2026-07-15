import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import '../design-styles.css';

const TIP_KEYS = [
  'voiceInterviewPrep_tip1',
  'voiceInterviewPrep_tip2',
  'voiceInterviewPrep_tip3',
  'voiceInterviewPrep_tip4',
];

const shellStyle = {
  minHeight: '100vh',
  padding: '40px 20px',
  background: 'linear-gradient(160deg, #0f172a 0%, #1e293b 35%, #0f172a 100%)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
};

const cardStyle = {
  position: 'relative',
  width: '100%',
  maxWidth: '900px',
  background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.98) 0%, rgba(2, 6, 23, 0.98) 100%)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  borderRadius: '12px',
  padding: '32px 40px',
  border: '2px solid rgba(34, 211, 238, 0.3)',
  boxShadow:
    '0 8px 24px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(34, 211, 238, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.03)',
  overflow: 'hidden',
};

/**
 * Pre-interview tips screen shown before the live voice interview UI.
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
    <div style={shellStyle} dir={dir}>
      <div style={cardStyle}>
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '2px',
            background:
              'linear-gradient(90deg, transparent, rgba(34, 211, 238, 0.5), rgba(34, 211, 238, 0.8), rgba(34, 211, 238, 0.5), transparent)',
            animation: 'shimmer 3s ease-in-out infinite',
          }}
        />
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <h1
            style={{
              fontSize: '30px',
              fontWeight: 700,
              margin: 0,
              background: 'linear-gradient(135deg, #60A5FA, #3B82F6)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            {heading}
          </h1>
          {sub ? (
            <p style={{ margin: '12px 0 0', fontSize: '0.95rem', color: '#F1F5F9', lineHeight: 1.5 }}>
              {sub}
            </p>
          ) : null}
        </div>

        <ul
          style={{
            listStyle: 'none',
            margin: '0 0 32px',
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          {TIP_KEYS.map((key) => (
            <li
              key={key}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '14px',
                padding: '16px 18px',
                borderRadius: '12px',
                background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.98) 0%, rgba(2, 6, 23, 0.98) 100%)',
                border: '1px solid rgba(34, 211, 238, 0.22)',
                boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.03)',
              }}
            >
              <span
                aria-hidden
                style={{
                  flexShrink: 0,
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'linear-gradient(135deg, rgba(34, 211, 238, 0.25), rgba(129, 140, 248, 0.25))',
                  border: '1px solid rgba(34, 211, 238, 0.45)',
                  color: '#22D3EE',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                }}
              >
                ✓
              </span>
              <span
                style={{
                  flex: 1,
                  color: 'rgba(226, 232, 240, 0.95)',
                  fontSize: '1rem',
                  lineHeight: 1.55,
                  textAlign: dir === 'rtl' ? 'right' : 'left',
                }}
              >
                {t(key)}
              </span>
            </li>
          ))}
        </ul>

        <div style={{ textAlign: 'center' }}>
          <button
            type="button"
            className="workflow-btn-primary ni-continue-btn"
            onClick={onContinue}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              padding: '14px 32px',
              fontSize: '1.05rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t('voiceInterviewPrep_continue')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default VoiceInterviewPrepTips;
