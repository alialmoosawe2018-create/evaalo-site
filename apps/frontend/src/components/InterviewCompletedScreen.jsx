import React from 'react';
import '../design-styles.css';

/**
 * The "your interview is finished" screen, shared by the voice (Stage 2) and video
 * (Stage 3) interviews.
 *
 * The two stages had grown separate end screens: the voice one on a shimmering card
 * with a gradient-filled tick and an emerald heading, the video one a plain white
 * card with a flat ✅ emoji on a 12% tint and a grey heading. Same words, visibly
 * different quality — and the voice one was the better of the two, so it is the one
 * kept here. Extracted rather than copied so they cannot drift apart again.
 *
 * @param {object} props
 * @param {string} props.title - Heading, e.g. "The interview has ended".
 * @param {string} [props.message] - Optional line under the heading.
 * @param {'rtl'|'ltr'} [props.dir] - Reading direction; callers know the language.
 */
export default function InterviewCompletedScreen({ title, message, dir = 'ltr' }) {
    return (
        <div className="voice-interview-stage" dir={dir}>
            <div className="voice-interview-stage__card">
                <div className="voice-interview-stage__shimmer" aria-hidden />
                <div
                    role="status"
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        textAlign: 'center',
                        gap: '18px',
                        padding: '56px 24px',
                        minHeight: '320px',
                    }}
                >
                    <span
                        aria-hidden
                        style={{
                            width: '76px',
                            height: '76px',
                            borderRadius: '50%',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '2.4rem',
                            color: '#fff',
                            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                            boxShadow: '0 8px 28px rgba(16, 185, 129, 0.4)',
                        }}
                    >
                        {/* A drawn glyph, not the ✅ emoji the video stage used — an emoji
                            renders differently on every platform and cannot take the
                            gradient and shadow that make this read as finished. */}
                        ✓
                    </span>
                    <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 800, color: '#047857' }}>
                        {title}
                    </h1>
                    {message ? (
                        <p
                            style={{
                                margin: 0,
                                maxWidth: '460px',
                                fontSize: '1rem',
                                lineHeight: 1.7,
                                color: '#475569',
                            }}
                        >
                            {message}
                        </p>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
