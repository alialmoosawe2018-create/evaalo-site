// ============================================
// File: components/VoiceInterviewStage.jsx
// Purpose: Presentational UI for a live voice interview session.
// ============================================
//
// Pure UI: renders the agent/candidate cards, transcript panels, timer and
// Start/End controls. All session state + handlers are passed in via the
// `session` prop (the return value of useVoiceInterview()). This component is
// shared by the candidate-specific /interview page and the public
// /screening-call page so the call UI is never duplicated.

import React, { useState, useEffect } from 'react';
import '../design-styles.css';

function formatTimeMMSS(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** موجات صوتية ناعمة (bars موجية بلون واحد) - نفس الحركة للإيجنت والمرشح */
function AudioWaveform({ active, level = 0.5, color = 'rgba(96, 165, 250, 0.9)' }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 55);
    return () => clearInterval(id);
  }, [active]);

  // شكل عام للموجة (lobes) من اليسار لليمين
  const baseHeights = [0.25, 0.45, 0.7, 0.95, 0.8, 0.6, 0.4, 0.3, 0.4, 0.6, 0.8, 0.95, 0.7, 0.45, 0.25];
  const barCount = baseHeights.length;
  // مستوى ثابت للحركة عند active حتى تكون متطابقة للإيجنت والمرشح
  const energy = active ? 0.5 : 0;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '4px',
        height: '42px',
        padding: '0 6px',
        background: 'transparent',
      }}
    >
      {baseHeights.map((base, i) => {
        const tNorm = i / Math.max(1, barCount - 1);
        // موجة ناعمة: sin واحد مستمر مع إزاحة لكل عمود
        const phase = (tick * 0.35) + i * 0.35;
        const wave = Math.sin(phase);
        const heightFactor = Math.max(0.22, base * (0.5 + energy) + wave * 0.22 * (0.6 + energy));
        const hPx = 8 + heightFactor * 30;
        const widthPx = 3 + (1 - Math.abs(tNorm - 0.5)) * 4; // أعرض في المنتصف

        return (
          <div
            key={i}
            style={{
              width: `${widthPx}px`,
              height: `${hPx}px`,
              minHeight: '8px',
              background: active
                ? `linear-gradient(180deg, ${color}, rgba(15,23,42,0.95))`
                : 'rgba(148, 163, 184, 0.25)',
              borderRadius: `${widthPx}px`,
              boxShadow: active ? `0 0 10px ${color}33` : 'none',
              transition: active ? 'none' : 'height 0.25s ease, background 0.25s ease',
            }}
          />
        );
      })}
    </div>
  );
}

const isArabicText = (t) => /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(t || '');

/* Same design as the main container in Design page (questions container) */
const questionContainerStyle = {
  position: 'relative',
  minHeight: '260px',
  padding: '32px',
  background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.98) 0%, rgba(2, 6, 23, 0.98) 100%)',
  backdropFilter: 'blur(22px)',
  WebkitBackdropFilter: 'blur(22px)',
  borderRadius: '14px',
  border: '2px solid rgba(34, 211, 238, 0.3)',
  boxShadow: '0 10px 28px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(34, 211, 238, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.03)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
};

const profileCardStyle = {
  flex: 0,
  minWidth: 340,
  background: 'linear-gradient(180deg, rgba(248, 250, 252, 0.92) 0%, rgba(241, 245, 249, 0.88) 100%)',
  borderRadius: '12px',
  padding: '12px 20px',
  border: '1px solid rgba(148, 163, 184, 0.35)',
  boxShadow: '0 8px 20px rgba(2, 6, 23, 0.2)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
};

/**
 * @param {Object} props
 * @param {string} [props.title] - Header title (default "Voice Interview").
 * @param {string} props.subtitle - Line under the title (name - position).
 * @param {string} props.candidateName - Name shown on the candidate card.
 * @param {Object} props.session - useVoiceInterview() return value.
 * @param {boolean} [props.canStart] - Whether the Start button is enabled.
 * @param {string|null} [props.startHint] - Hint shown when Start is disabled.
 */
const VoiceInterviewStage = ({
  title = 'Voice Interview',
  subtitle = '',
  candidateName = 'Candidate',
  session,
  canStart = true,
  startHint = null,
  recordingNotice = null,
}) => {
  const {
    connectionStatus,
    serverState,
    lastError,
    micActive,
    lastTranscript,
    streamingTranscript,
    lastAgentReply,
    streamingAgentReply,
    apiKeysReady,
    userAudioLevel,
    agentAudioLevel,
    interviewTimeLeft,
    connect,
    disconnect,
  } = session;

  return (
    <div dir="ltr"
      style={{
      minHeight: '100vh',
      padding: '40px 20px',
        background: 'linear-gradient(160deg, #0f172a 0%, #1e293b 35%, #0f172a 100%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          position: 'relative',
        width: '100%',
          maxWidth: '900px',
          background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.98) 0%, rgba(2, 6, 23, 0.98) 100%)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRadius: '12px',
          padding: '32px 40px',
          border: '2px solid rgba(34, 211, 238, 0.3)',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(34, 211, 238, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.03)',
          overflow: 'hidden',
        }}
      >
        {/* Shimmer bar at top of container - like Design page */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '2px',
            background: 'linear-gradient(90deg, transparent, rgba(34, 211, 238, 0.5), rgba(34, 211, 238, 0.8), rgba(34, 211, 238, 0.5), transparent)',
            animation: 'shimmer 3s ease-in-out infinite',
          }}
        />
        {/* Header */}
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
            {title}
          </h1>
          <p style={{ margin: '12px 0 0', fontSize: '0.9rem', color: '#F1F5F9' }}>
            {subtitle}
          </p>
          {/* عداد وقت المقابلة: 10:00 → 00:00 */}
          <div
            style={{
              marginTop: '16px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 20px',
              background: connectionStatus === 'connected' ? 'linear-gradient(135deg, rgba(34, 211, 238, 0.15), rgba(59, 130, 246, 0.15))' : 'rgba(30, 41, 59, 0.5)',
              borderRadius: '12px',
              border: '1px solid rgba(34, 211, 238, 0.3)',
            }}
          >
            <span
              style={{
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                fontSize: '1.5rem',
                fontWeight: 700,
                color: interviewTimeLeft <= 60 ? '#F87171' : '#22D3EE',
                minWidth: '60px',
              }}
            >
              {formatTimeMMSS(interviewTimeLeft)}
            </span>
          </div>
          {recordingNotice && (
            <p style={{ margin: '14px 0 0', fontSize: '0.78rem', color: 'rgba(148, 163, 184, 0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444', display: 'inline-block', boxShadow: '0 0 8px rgba(239,68,68,0.7)' }} />
              {recordingNotice}
            </p>
          )}
        </div>

        {/* Agent card (top, like illustration) */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '24px' }}>
          <div style={{ ...profileCardStyle, maxWidth: '50%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexDirection: 'row-reverse' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexDirection: 'row-reverse' }}>
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    flexShrink: 0,
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.25rem',
                    boxShadow: '0 8px 14px rgba(139, 92, 246, 0.25)',
                  }}
                >
                  🤖
                </div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#0f172a' }}>
                  evaalo
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{ width: '120px' }}>
                  <AudioWaveform
                    active={serverState === 'SPEAKING'}
                    level={agentAudioLevel}
                    color={serverState === 'SPEAKING' ? 'rgba(34, 211, 238, 0.95)' : 'rgba(96, 165, 250, 0.95)'}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Two panels: User transcript | Agent reply */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '20px',
            marginBottom: '24px',
          }}
        >
          <div style={questionContainerStyle}>
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: '2px',
                background: 'linear-gradient(90deg, transparent, rgba(34, 211, 238, 0.5), rgba(34, 211, 238, 0.8), rgba(34, 211, 238, 0.5), transparent)',
                animation: 'shimmer 3s ease-in-out infinite',
              }}
            />
            <div style={{ width: '100%', padding: '0 12px' }}>
              <span style={{ color: 'rgba(203, 213, 225, 0.9)', fontSize: '1rem', display: 'block', textAlign: 'left', fontFamily: isArabicText(lastTranscript || streamingTranscript) ? "'Noto Sans Arabic', 'Cairo', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" : 'inherit' }}>
                {(lastTranscript || streamingTranscript) ? `«${[lastTranscript, streamingTranscript].filter(Boolean).join(' ')}»` : ''}
              </span>
            </div>
          </div>
          <div style={questionContainerStyle}>
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: '2px',
                background: 'linear-gradient(90deg, transparent, rgba(34, 211, 238, 0.5), rgba(34, 211, 238, 0.8), rgba(34, 211, 238, 0.5), transparent)',
                animation: 'shimmer 3s ease-in-out infinite',
              }}
            />
            <div style={{ width: '100%', padding: '0 12px' }}>
              <span style={{ color: 'rgba(203, 213, 225, 0.9)', fontSize: '1rem', display: 'block', textAlign: 'left', fontFamily: isArabicText(lastAgentReply || streamingAgentReply) ? "'Noto Sans Arabic', 'Cairo', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" : 'inherit' }}>
                {lastAgentReply || streamingAgentReply || ''}
              </span>
            </div>
          </div>
        </div>

        {/* Candidate card under candidate transcript */}
        <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '20px' }}>
          <div style={{ ...profileCardStyle, maxWidth: '50%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  flexShrink: 0,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.25rem',
                  boxShadow: '0 8px 14px rgba(14, 165, 233, 0.25)',
                }}
              >
                👤
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: '0.9rem',
                    fontWeight: 600,
                    color: '#0f172a',
                    lineHeight: 1.35,
                    wordBreak: 'break-word',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {candidateName}
                </div>
              </div>
              <div style={{ flexShrink: 0, width: '120px' }}>
                <AudioWaveform
                  active={serverState === 'LISTENING' && (!!lastTranscript || !!streamingTranscript || micActive)}
                  level={userAudioLevel}
                  color={serverState === 'LISTENING' && (!!lastTranscript || !!streamingTranscript || micActive) ? 'rgba(34, 211, 238, 0.95)' : 'rgba(96, 165, 250, 0.95)'}
                />
              </div>
            </div>
          </div>
        </div>

        {/* API keys warning */}
        {connectionStatus === 'connected' && apiKeysReady && (!apiKeysReady.hasOpenAI || !apiKeysReady.hasElevenLabs) && (
          <div
            style={{
              marginBottom: '20px',
              padding: '16px 20px',
              background: 'rgba(239, 68, 68, 0.1)',
              borderRadius: '10px',
              border: '1px solid rgba(239, 68, 68, 0.4)',
            }}
          >
            <p style={{ margin: 0, fontSize: '0.95rem', color: 'rgba(248, 113, 113, 0.95)', fontWeight: 600 }}>
              API keys not found on server
            </p>
            <p style={{ margin: '8px 0 0', fontSize: '0.85rem', color: 'rgba(203, 213, 225, 0.9)' }}>
              Please add OPENAI_API_KEY and ELEVENLABS_API_KEY to the .env file in apps/backend
            </p>
          </div>
        )}

        {lastError && (
          <p style={{ textAlign: 'center', marginBottom: '12px', fontSize: '0.85rem', color: 'rgba(248, 113, 113, 0.95)' }}>{lastError}</p>
        )}

        {/* Start / End button */}
        <div style={{ textAlign: 'center', marginTop: '28px', display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'center' }}>
          {connectionStatus !== 'connected' ? (
            <button
              type="button"
              className="workflow-btn-primary ni-continue-btn"
              onClick={connect}
              disabled={!canStart || connectionStatus === 'connecting'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                padding: '14px 28px',
                fontSize: '1.05rem',
                fontWeight: '600',
                cursor: canStart && connectionStatus !== 'connecting' ? 'pointer' : 'not-allowed',
                opacity: canStart && connectionStatus !== 'connecting' ? 1 : 0.6,
              }}
            >
              <span style={{ fontSize: '1.25rem' }}>▶</span>
              <span>{connectionStatus === 'connecting' ? 'Starting...' : 'Start'}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={disconnect}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '10px',
                padding: '14px 28px',
                fontSize: '1.05rem',
            fontWeight: '600',
                color: '#fff',
                background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                border: 'none',
                borderRadius: '12px',
                boxShadow: '0 4px 20px rgba(239, 68, 68, 0.35)',
                cursor: 'pointer',
                transition: 'transform 0.2s ease, box-shadow 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 6px 24px rgba(239, 68, 68, 0.45)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 20px rgba(239, 68, 68, 0.35)';
              }}
            >
              <span style={{ fontSize: '1.25rem' }}>⏹</span>
              <span>End</span>
            </button>
          )}
          {startHint && (
            <p style={{ width: '100%', marginTop: '10px', fontSize: '0.85rem', color: 'rgba(148, 163, 184, 0.9)' }}>
              {startHint}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default VoiceInterviewStage;
