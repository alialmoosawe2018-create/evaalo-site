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
                ? `linear-gradient(180deg, ${color}, rgba(99,102,241,0.45))`
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

const profileCardStyle = {
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
 * @param {string} [props.audioBlockedMessage] - Shown when playback needs a tap.
 * @param {string} [props.audioBlockedAction] - Label of the resume-audio button.
 * @param {string} [props.completedTitle] - Heading shown after the server ends the interview.
 * @param {string|null} [props.completedMessage] - Optional line under that heading.
 */
const VoiceInterviewStage = ({
  title = 'Voice Interview',
  subtitle = '',
  candidateName = 'Candidate',
  session,
  canStart = true,
  startHint = null,
  recordingNotice = null,
  audioBlockedMessage = 'Sound is paused on this device.',
  audioBlockedAction = 'Tap to hear the interviewer',
  completedTitle = 'The interview has ended',
  completedMessage = null,
}) => {
  const {
    connectionStatus,
    serverState,
    lastError,
    interviewComplete,
    micActive,
    lastTranscript,
    streamingTranscript,
    lastAgentReply,
    streamingAgentReply,
    apiKeysReady,
    userAudioLevel,
    agentAudioLevel,
    interviewTimeLeft,
    audioBlocked,
    resumeAudio,
    connect,
    disconnect,
  } = session;

  return (
    <div className="voice-interview-stage" dir="ltr">
      <div className="voice-interview-stage__card">
        <div className="voice-interview-stage__shimmer" aria-hidden />
        {/* Header */}
        <div className="voice-interview-stage__header">
          <h1
            className="voice-interview-stage__title"
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
          <p style={{ margin: '12px 0 0', fontSize: '0.9rem', color: '#475569' }}>
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
              background: connectionStatus === 'connected' ? 'linear-gradient(135deg, rgba(56, 189, 248, 0.12), rgba(99, 102, 241, 0.12))' : 'rgba(241, 245, 249, 0.95)',
              borderRadius: '12px',
              border: '1px solid rgba(99, 102, 241, 0.25)',
            }}
          >
            <span
              style={{
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                fontSize: '1.5rem',
                fontWeight: 700,
                color: interviewTimeLeft <= 60 ? '#dc2626' : '#0284c7',
                minWidth: '60px',
              }}
            >
              {formatTimeMMSS(interviewTimeLeft)}
            </span>
          </div>
          {recordingNotice && (
            <p style={{ margin: '14px 0 0', fontSize: '0.78rem', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444', display: 'inline-block', boxShadow: '0 0 8px rgba(239,68,68,0.45)' }} />
              {recordingNotice}
            </p>
          )}
        </div>

        {/* Agent card (top) */}
        <div className="voice-interview-stage__profile-wrap voice-interview-stage__profile-wrap--agent">
          <div className="voice-interview-stage__profile" style={profileCardStyle}>
            <div className="voice-interview-stage__profile-row">
              <div className="voice-interview-stage__profile-identity">
                <div
                  className="voice-interview-stage__avatar voice-interview-stage__avatar--agent"
                  aria-hidden
                >
                  🤖
                </div>
                <div className="voice-interview-stage__profile-name">evaalo</div>
              </div>
              <div className="voice-interview-stage__waveform">
                <AudioWaveform
                  active={serverState === 'SPEAKING'}
                  level={agentAudioLevel}
                  color={serverState === 'SPEAKING' ? 'rgba(34, 211, 238, 0.95)' : 'rgba(96, 165, 250, 0.95)'}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Transcript panels: candidate | agent (desktop side-by-side; mobile stacked — agent top, candidate below) */}
        <div className="voice-interview-stage__panels">
          <div className="voice-interview-stage__panel voice-interview-stage__panel--candidate">
            <div className="voice-interview-stage__panel-shimmer" aria-hidden />
            <div className="voice-interview-stage__panel-body">
              <span
                className="voice-interview-stage__panel-text"
                style={{
                  fontFamily: isArabicText(lastTranscript || streamingTranscript)
                    ? "'Noto Sans Arabic', 'Cairo', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
                    : 'inherit',
                }}
              >
                {(lastTranscript || streamingTranscript)
                  ? `«${[lastTranscript, streamingTranscript].filter(Boolean).join(' ')}»`
                  : ''}
              </span>
            </div>
          </div>
          <div className="voice-interview-stage__panel voice-interview-stage__panel--agent">
            <div className="voice-interview-stage__panel-shimmer" aria-hidden />
            <div className="voice-interview-stage__panel-body">
              <span
                className="voice-interview-stage__panel-text"
                style={{
                  fontFamily: isArabicText(lastAgentReply || streamingAgentReply)
                    ? "'Noto Sans Arabic', 'Cairo', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
                    : 'inherit',
                }}
              >
                {lastAgentReply || streamingAgentReply || ''}
              </span>
            </div>
          </div>
        </div>

        {/* Candidate card */}
        <div className="voice-interview-stage__profile-wrap voice-interview-stage__profile-wrap--candidate">
          <div className="voice-interview-stage__profile" style={profileCardStyle}>
            <div className="voice-interview-stage__profile-row">
              <div className="voice-interview-stage__profile-identity">
                <div
                  className="voice-interview-stage__avatar voice-interview-stage__avatar--candidate"
                  aria-hidden
                >
                  👤
                </div>
                <div className="voice-interview-stage__profile-name voice-interview-stage__profile-name--wrap">
                  {candidateName}
                </div>
              </div>
              <div className="voice-interview-stage__waveform">
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
              background: 'rgba(239, 68, 68, 0.08)',
              borderRadius: '10px',
              border: '1px solid rgba(239, 68, 68, 0.35)',
            }}
          >
            <p style={{ margin: 0, fontSize: '0.95rem', color: '#dc2626', fontWeight: 600 }}>
              API keys not found on server
            </p>
            <p style={{ margin: '8px 0 0', fontSize: '0.85rem', color: '#64748b' }}>
              Please add OPENAI_API_KEY and ELEVENLABS_API_KEY to the .env file in apps/backend
            </p>
          </div>
        )}

        {/* Playback refused or interrupted (iOS does this on calls, screen lock
            and app switches). Only a real tap can restart it, so ask for one
            instead of leaving the candidate in silence. */}
        {audioBlocked && (
          <div
            style={{
              marginBottom: '16px',
              padding: '14px 18px',
              background: 'rgba(245, 158, 11, 0.1)',
              borderRadius: '10px',
              border: '1px solid rgba(245, 158, 11, 0.4)',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
              textAlign: 'center',
            }}
          >
            <span style={{ fontSize: '0.9rem', color: '#92400e', fontWeight: 600 }}>
              {audioBlockedMessage}
            </span>
            <button
              type="button"
              onClick={resumeAudio}
              style={{
                padding: '10px 20px',
                fontSize: '0.9rem',
                fontWeight: 600,
                color: '#fff',
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                border: 'none',
                borderRadius: '10px',
                cursor: 'pointer',
              }}
            >
              {audioBlockedAction}
            </button>
          </div>
        )}

        {lastError && (
          <p style={{ textAlign: 'center', marginBottom: '12px', fontSize: '0.85rem', color: '#dc2626' }}>{lastError}</p>
        )}

        {/* Start / End button — or the completion card once the server hangs up
            on its own: falling back to Start here reads as a dropped call, and
            the link is already consumed so pressing it would only be blocked. */}
        <div className="voice-interview-stage__actions">
          {interviewComplete ? (
            <div
              role="status"
              style={{
                width: '100%',
                padding: '20px 24px',
                background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(56, 189, 248, 0.1))',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                borderRadius: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '14px',
                textAlign: 'center',
              }}
            >
              <span
                aria-hidden
                style={{
                  flex: '0 0 auto',
                  width: '38px',
                  height: '38px',
                  borderRadius: '50%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.2rem',
                  color: '#fff',
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  boxShadow: '0 4px 16px rgba(16, 185, 129, 0.35)',
                }}
              >
                ✓
              </span>
              <span>
                <span style={{ display: 'block', fontSize: '1.05rem', fontWeight: 700, color: '#047857' }}>
                  {completedTitle}
                </span>
                {completedMessage ? (
                  <span style={{ display: 'block', marginTop: '6px', fontSize: '0.88rem', color: '#475569' }}>
                    {completedMessage}
                  </span>
                ) : null}
              </span>
            </div>
          ) : connectionStatus !== 'connected' ? (
            <button
              type="button"
              className="workflow-btn-primary ni-continue-btn vi-interview-start-btn"
              onClick={connect}
              disabled={!canStart || connectionStatus === 'connecting'}
            >
              <span className="vi-interview-start-btn__icon" aria-hidden>▶</span>
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
          {startHint && !interviewComplete && (
            <p style={{ width: '100%', marginTop: '10px', fontSize: '0.85rem', color: '#64748b' }}>
              {startHint}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default VoiceInterviewStage;
