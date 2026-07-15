import React, { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../../services/apiClient.js';

function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

function PlayIcon() {
    return (
        <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor" aria-hidden>
            <path d="M1 0.5v11L9.5 6L1 0.5Z" />
        </svg>
    );
}

function PauseIcon() {
    return (
        <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor" aria-hidden>
            <rect x="0.5" y="0.5" width="3" height="11" rx="0.5" />
            <rect x="6.5" y="0.5" width="3" height="11" rx="0.5" />
        </svg>
    );
}

/**
 * عمود التسجيل في جدول تقييم المرحلة الصوتية — زر تشغيل + مشغّل مدمج بثيم داكن.
 */
export default function VoiceRecordingCell({ candidateId, hasRecording, t }) {
    const audioRef = useRef(null);
    const [url, setUrl] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);

    const fetchUrl = useCallback(async () => {
        if (!candidateId) return null;
        setError(false);
        setLoading(true);
        try {
            const json = await apiClient.get(`/api/candidates/${candidateId}/voice-recording`);
            const nextUrl = json?.data?.url;
            if (!nextUrl) throw new Error('no url');
            setUrl(nextUrl);
            return nextUrl;
        } catch {
            setError(true);
            return null;
        } finally {
            setLoading(false);
        }
    }, [candidateId]);

    useEffect(() => {
        setUrl(null);
        setError(false);
        setPlaying(false);
        setCurrentTime(0);
        setDuration(0);
    }, [candidateId]);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio || !url) return;

        const onTimeUpdate = () => setCurrentTime(audio.currentTime);
        const onDurationChange = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
        const onPlay = () => setPlaying(true);
        const onPause = () => setPlaying(false);
        const onEnded = () => {
            setPlaying(false);
            setCurrentTime(0);
        };
        const onError = () => {
            setPlaying(false);
            setUrl(null);
            setError(true);
        };

        audio.addEventListener('timeupdate', onTimeUpdate);
        audio.addEventListener('durationchange', onDurationChange);
        audio.addEventListener('loadedmetadata', onDurationChange);
        audio.addEventListener('play', onPlay);
        audio.addEventListener('pause', onPause);
        audio.addEventListener('ended', onEnded);
        audio.addEventListener('error', onError);

        return () => {
            audio.removeEventListener('timeupdate', onTimeUpdate);
            audio.removeEventListener('durationchange', onDurationChange);
            audio.removeEventListener('loadedmetadata', onDurationChange);
            audio.removeEventListener('play', onPlay);
            audio.removeEventListener('pause', onPause);
            audio.removeEventListener('ended', onEnded);
            audio.removeEventListener('error', onError);
        };
    }, [url]);

    const stopRowToggle = (e) => e.stopPropagation();

    const togglePlayback = async () => {
        if (loading) return;
        if (!url) {
            const nextUrl = await fetchUrl();
            if (!nextUrl) return;
            requestAnimationFrame(() => {
                audioRef.current?.play().catch(() => {});
            });
            return;
        }
        const audio = audioRef.current;
        if (!audio) return;
        if (audio.paused) {
            audio.play().catch(() => {});
        } else {
            audio.pause();
        }
    };

    const handleSeek = (e) => {
        stopRowToggle(e);
        const audio = audioRef.current;
        if (!audio || !Number.isFinite(audio.duration)) return;
        audio.currentTime = Number(e.target.value);
        setCurrentTime(audio.currentTime);
    };

    if (!hasRecording) {
        return <span className="stage-eval-recording__empty">—</span>;
    }

    if (url) {
        return (
            <div className="stage-eval-recording stage-eval-recording--player" onClick={stopRowToggle}>
                <audio ref={audioRef} preload="metadata" src={url} />
                <button
                    type="button"
                    className="stage-eval-recording__toggle"
                    onClick={(e) => {
                        stopRowToggle(e);
                        togglePlayback();
                    }}
                    title={playing ? t('voiceInterview_pause') : t('voiceInterview_play')}
                    aria-label={playing ? t('voiceInterview_pause') : t('voiceInterview_play')}
                >
                    {playing ? <PauseIcon /> : <PlayIcon />}
                </button>
                <div className="stage-eval-recording__track">
                    <input
                        type="range"
                        className="stage-eval-recording__progress"
                        min={0}
                        max={duration || 0}
                        step={0.1}
                        value={Math.min(currentTime, duration || 0)}
                        onChange={handleSeek}
                        onClick={stopRowToggle}
                        aria-label={t('voiceInterview_recording')}
                    />
                    <span className="stage-eval-recording__time">
                        {formatTime(currentTime)} / {formatTime(duration)}
                    </span>
                </div>
            </div>
        );
    }

    return (
        <div className="stage-eval-recording" onClick={stopRowToggle}>
            <button
                type="button"
                className={`stage-eval-recording__play-btn${error ? ' stage-eval-recording__play-btn--error' : ''}`}
                onClick={(e) => {
                    stopRowToggle(e);
                    togglePlayback();
                }}
                disabled={loading}
                title={t('voiceInterview_recording')}
            >
                {loading ? (
                    <>
                        <span className="stage-eval-recording__spinner" aria-hidden />
                        <span>{t('voiceInterview_loading')}</span>
                    </>
                ) : error ? (
                    <span>{t('voiceInterview_retry')}</span>
                ) : (
                    <>
                        <span className="stage-eval-recording__play-icon" aria-hidden>
                            <PlayIcon />
                        </span>
                        <span>{t('voiceInterview_play')}</span>
                    </>
                )}
            </button>
        </div>
    );
}
