import React, { useEffect, useState, useRef } from 'react';
import { BarVisualizer } from '@livekit/components-react';
import '@livekit/components-styles';
import { RoomEvent } from 'livekit-client';
import useSoundEffects from '../hooks/useSoundEffects';

/**
 * Agent Audio Visualizer Component
 * يعرض حالة الـ Agent (initializing, listening, thinking, speaking) مع Audio Visualizer
 */
const AgentAudioVisualizer = ({ room, syncedAgentState = null, style = {}, enableSounds = true }) => {
    // ⚠️ CRITICAL: يجب استدعاء hooks دائماً قبل أي early return
    const [internalState, setInternalState] = useState('initializing');
    const [connectionStatus, setConnectionStatus] = useState('disconnected');
    const [audioTrack, setAudioTrack] = useState(null);
    const { playSound, triggerHaptic } = useSoundEffects();
    const previousStateRef = useRef('initializing');
    const audioElementRef = useRef(null);

    const displayState = syncedAgentState != null ? syncedAgentState : internalState;

    useEffect(() => {
        if (!enableSounds) return;
        if (displayState === 'initializing') {
            previousStateRef.current = displayState;
            return;
        }
        if (displayState === previousStateRef.current) return;
        if (displayState === 'listening') {
            playSound('agentListening');
            triggerHaptic('light');
        } else if (displayState === 'thinking') {
            playSound('agentThinking');
            triggerHaptic('medium');
        } else if (displayState === 'speaking') {
            playSound('agentSpeaking');
            triggerHaptic('light');
        }
        previousStateRef.current = displayState;
    }, [displayState, enableSounds, playSound, triggerHaptic]);

    useEffect(() => {
        if (!room) return;

        // Monitor room connection state (map all SDK values — avoids "Unknown" for unlisted enums)
        const updateConnectionStatus = () => {
            const state = room.connectionState;
            if (state === 'disconnected' && room.state !== 'disconnected') {
                setConnectionStatus('connecting');
            } else {
                setConnectionStatus(state ?? 'disconnected');
            }
        };

        updateConnectionStatus();
        room.on('connectionStateChanged', updateConnectionStatus);

        const onDisconnected = () => {
            setConnectionStatus('disconnected');
            setInternalState('initializing');
            setAudioTrack(null);
            previousStateRef.current = 'initializing';
        };
        room.on(RoomEvent.Disconnected, onDisconnected);

        // Find agent participant and get audio track
        const findAgentAudioTrack = () => {
            if (room.state === 'disconnected') {
                setInternalState('initializing');
                setAudioTrack(null);
                return;
            }
            const agentParticipant = Array.from(room.remoteParticipants.values())
                .find(p => p.identity.startsWith('agent-') || p.identity === 'bey-avatar-agent');
            
            if (agentParticipant) {
                // Find audio track from agent participant
                const audioPublication = Array.from(agentParticipant.audioTrackPublications.values())
                    .find(pub => pub.track && pub.isSubscribed);
                
                if (audioPublication && audioPublication.track) {
                    setAudioTrack(audioPublication.track);
                } else {
                    setAudioTrack(null);
                }
                
                // Agent state is stored in participant metadata
                // ⚠️ CRITICAL: attributes قد يكون object عادي وليس Map
                // ✅ FIX: محاولة قراءة attributes من مصادر متعددة
                let agentStateAttr = null;
                
                // محاولة 1: attributes كـ object
                if (agentParticipant.attributes && typeof agentParticipant.attributes === 'object') {
                    agentStateAttr = agentParticipant.attributes['lk.agent.state'] || 
                                    agentParticipant.attributes.get?.('lk.agent.state');
                }
                
                // محاولة 2: attributes كـ Map
                if (!agentStateAttr && agentParticipant.attributes instanceof Map) {
                    agentStateAttr = agentParticipant.attributes.get('lk.agent.state');
                }
                
                // محاولة 3: metadata (fallback)
                if (!agentStateAttr && agentParticipant.metadata) {
                    try {
                        const metadata = typeof agentParticipant.metadata === 'string' 
                            ? JSON.parse(agentParticipant.metadata) 
                            : agentParticipant.metadata;
                        agentStateAttr = metadata?.['lk.agent.state'];
                    } catch (e) {
                        // ignore
                    }
                }
                
                if (agentStateAttr) {
                    if (syncedAgentState == null) {
                        setInternalState((prev) => (prev !== agentStateAttr ? agentStateAttr : prev));
                    }
                } else {
                    if (syncedAgentState != null) {
                        /* الحالة من VideoInterviewCall عند توفرها */
                    } else {
                        setInternalState((prev) => {
                            if (prev && prev !== 'initializing') return prev;
                            if (audioPublication && audioPublication.track) return 'speaking';
                            return 'listening';
                        });
                    }
                    // ✅ إذا كان state موجوداً (مثل 'listening')، لا نغيره إلى fallback
                    // هذا يمنع الوميض عندما attributes غير متاح مؤقتاً
                }
            } else {
                if (syncedAgentState == null) {
                    setInternalState('initializing');
                }
                setAudioTrack(null);
            }
        };

        findAgentAudioTrack();
        // ✅ FIX: تقليل polling interval من 500ms إلى 1000ms لتقليل race conditions
        const interval = setInterval(findAgentAudioTrack, 1000);

        // Listen for participant connected events
        const onParticipantConnected = () => {
            findAgentAudioTrack();
        };
        
        // Listen for track subscribed events
        const onTrackSubscribed = () => {
            findAgentAudioTrack();
        };
        
        room.on('participantConnected', onParticipantConnected);
        room.on('trackSubscribed', onTrackSubscribed);

        return () => {
            room.off('connectionStateChanged', updateConnectionStatus);
            room.off(RoomEvent.Disconnected, onDisconnected);
            room.off('participantConnected', onParticipantConnected);
            room.off('trackSubscribed', onTrackSubscribed);
            clearInterval(interval);
        };
    }, [room, syncedAgentState]);
    
    // ✅ PRODUCTION FIX: تعطيل audio playback في AgentAudioVisualizer
    // ❌ المشكلة: AgentAudioVisualizer كان يشغّل الصوت عبر audioTrack.attach()
    // ❌ هذا يسبب Double Playback مع audioRef.current في VideoInterviewCall.jsx
    // ✅ الحل: AgentAudioVisualizer يستخدم audio track فقط للـ visualization (BarVisualizer)
    // ✅ لا audio playback - الصوت يأتي فقط من audioRef.current في VideoInterviewCall.jsx
    useEffect(() => {
        // ✅ PRODUCTION FIX: لا نرفق audio track للـ playback
        // AgentAudioVisualizer يستخدم audio track فقط للـ visualization
        // الصوت يأتي فقط من audioRef.current في VideoInterviewCall.jsx
        if (audioTrack && audioElementRef.current) {
            return () => {};
        }
    }, [audioTrack]);

    if (!room) {
        return null;
    }

    // State colors
    const getStateColor = () => {
        switch (displayState) {
            case 'initializing':
                return '#94a3b8'; // gray
            case 'listening':
                return '#22d3ee'; // cyan
            case 'thinking':
                return '#f59e0b'; // amber
            case 'speaking':
                return '#10b981'; // green
            default:
                return '#22d3ee';
        }
    };

    // State labels
    const getStateLabel = () => {
        switch (displayState) {
            case 'initializing':
                return 'Initializing...';
            case 'listening':
                return 'Listening';
            case 'thinking':
                return 'Thinking...';
            case 'speaking':
                return 'Speaking';
            default:
                return 'Ready';
        }
    };

    // Connection status indicator
    const getConnectionIndicator = () => {
        switch (connectionStatus) {
            case 'connected':
                return { color: '#10b981', label: 'Connected', icon: '🟢' };
            case 'connecting':
                return { color: '#f59e0b', label: 'Connecting...', icon: '🟡' };
            case 'disconnected':
                return { color: '#ef4444', label: 'Disconnected', icon: '🔴' };
            case 'reconnecting':
                return { color: '#f59e0b', label: 'Reconnecting...', icon: '🟡' };
            default:
                return {
                    color: '#94a3b8',
                    label: connectionStatus ? String(connectionStatus) : 'Unknown',
                    icon: '⚪',
                };
        }
    };

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
            padding: '20px',
            background: 'rgba(15, 23, 42, 0.8)',
            border: `2px solid ${getStateColor()}40`,
            borderRadius: '16px',
            backdropFilter: 'blur(10px)',
            ...style
        }}>
            {/* Connection status indicator intentionally hidden — the bottom
                agent state ("Speaking" / "Listening" / ...) is enough for the
                user, and showing both caused a confusing "Disconnected +
                Speaking" overlap during the avatar's tail audio after a
                Room.Disconnected event. */}

            {/* Audio Visualizer */}
            <div style={{
                width: '100%',
                height: '80px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
            }}>
                {/* ✅ PRODUCTION FIX: Audio element معطل - لا playback في AgentAudioVisualizer */}
                {/* ❌ المشكلة: audioTrack.attach() كان يشغّل الصوت → double playback */}
                {/* ✅ الحل: BarVisualizer يستخدم trackRef مباشرة للـ visualization فقط (لا playback) */}
                {/* ✅ الصوت يأتي فقط من audioRef.current في VideoInterviewCall.jsx */}
                <audio 
                    ref={audioElementRef} 
                    muted={true}  // ✅ PRODUCTION FIX: muted=true لمنع أي playback عرضي
                    style={{ display: 'none' }}
                />
                {audioTrack ? (
                    <BarVisualizer
                        state={displayState}
                        barCount={12}
                        trackRef={audioTrack}
                        style={{
                            width: '100%',
                            height: '100%'
                        }}
                    />
                ) : (
                    <div style={{
                        display: 'flex',
                        gap: '4px',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: '100%'
                    }}>
                        {[...Array(12)].map((_, i) => (
                            <div
                                key={i}
                                style={{
                                    width: '6px',
                                    height: displayState === 'thinking' ? '40px' : '20px',
                                    background: getStateColor(),
                                    borderRadius: '3px',
                                    animation: displayState === 'thinking' 
                                        ? `pulse 1.5s ease-in-out ${i * 0.1}s infinite`
                                        : 'none',
                                    opacity: displayState === 'initializing' ? 0.3 : 0.6
                                }}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Agent State Label */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '14px',
                fontWeight: 600,
                color: getStateColor()
            }}>
                <div style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: getStateColor(),
                    animation: displayState === 'thinking' ? 'pulse 1.5s ease-in-out infinite' : 'none'
                }} />
                <span>{getStateLabel()}</span>
            </div>

            <style>{`
                @keyframes pulse {
                    0%, 100% {
                        opacity: 0.6;
                        transform: scaleY(1);
                    }
                    50% {
                        opacity: 1;
                        transform: scaleY(1.2);
                    }
                }
            `}</style>
        </div>
    );
};

export default AgentAudioVisualizer;
