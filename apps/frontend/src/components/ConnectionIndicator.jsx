import React, { useEffect, useState } from 'react';
import { RoomEvent, ParticipantKind } from 'livekit-client';

/**
 * Connection Indicator Component
 * يعرض حالة الاتصال بشكل موحد (Room, Agent, Tracks)
 */
const ConnectionIndicator = ({ room, onConnectionStatusChange }) => {
    const [status, setStatus] = useState({
        room: 'disconnected',
        agent: 'not_connected',
        audioTrack: false,
        videoTrack: false,
        overall: 'disconnected'
    });

    useEffect(() => {
        if (!room) {
            setStatus({
                room: 'disconnected',
                agent: 'not_connected',
                audioTrack: false,
                videoTrack: false,
                overall: 'disconnected'
            });
            return;
        }

        const updateStatus = () => {
            // ✅ FIX: استخدام room.state كـ fallback إذا كان connectionState غير متاح
            const roomState = room.connectionState || room.state || 'disconnected';
            
            const newStatus = {
                room: roomState,
                agent: 'not_connected',
                audioTrack: false,
                videoTrack: false,
                overall: 'disconnected'
            };

            // Check for agent participant
            const agentParticipant = Array.from(room.remoteParticipants.values())
                .find(p => 
                    p.kind === ParticipantKind.PARTICIPANT_KIND_AGENT || 
                    p.identity.startsWith('agent-') || 
                    p.identity === 'bey-avatar-agent'
                );

            if (agentParticipant) {
                newStatus.agent = 'connected';
                
                // Check for audio track
                agentParticipant.audioTrackPublications.forEach((pub) => {
                    if (pub.isSubscribed && pub.track) {
                        newStatus.audioTrack = true;
                    }
                });

                // Check for video track
                agentParticipant.videoTrackPublications.forEach((pub) => {
                    if (pub.isSubscribed && pub.track) {
                        newStatus.videoTrack = true;
                    }
                });
            }

            // Determine overall status
            if (newStatus.room === 'connected' && newStatus.agent === 'connected') {
                if (newStatus.audioTrack && newStatus.videoTrack) {
                    newStatus.overall = 'ready';
                } else if (newStatus.audioTrack) {
                    newStatus.overall = 'audio_only';
                } else {
                    newStatus.overall = 'connecting';
                }
            } else if (newStatus.room === 'connected') {
                newStatus.overall = 'waiting_agent';
            } else if (newStatus.room === 'connecting') {
                newStatus.overall = 'connecting';
            } else {
                newStatus.overall = 'disconnected';
            }

            setStatus(newStatus);
            
            // Notify parent component
            if (onConnectionStatusChange) {
                onConnectionStatusChange(newStatus);
            }
        };

        // Initial update
        updateStatus();

        // Listen for events
        room.on(RoomEvent.Connected, updateStatus);
        room.on(RoomEvent.Disconnected, updateStatus);
        room.on(RoomEvent.ConnectionStateChanged, updateStatus);
        room.on(RoomEvent.ParticipantConnected, updateStatus);
        room.on(RoomEvent.ParticipantDisconnected, updateStatus);
        room.on(RoomEvent.TrackSubscribed, updateStatus);
        room.on(RoomEvent.TrackUnsubscribed, updateStatus);

        return () => {
            room.off(RoomEvent.Connected, updateStatus);
            room.off(RoomEvent.Disconnected, updateStatus);
            room.off(RoomEvent.ConnectionStateChanged, updateStatus);
            room.off(RoomEvent.ParticipantConnected, updateStatus);
            room.off(RoomEvent.ParticipantDisconnected, updateStatus);
            room.off(RoomEvent.TrackSubscribed, updateStatus);
            room.off(RoomEvent.TrackUnsubscribed, updateStatus);
        };
    }, [room, onConnectionStatusChange]);

    const getStatusInfo = () => {
        switch (status.overall) {
            case 'ready':
                return {
                    color: '#10b981',
                    label: 'Ready',
                    icon: '✅',
                    message: 'All systems ready'
                };
            case 'audio_only':
                return {
                    color: '#f59e0b',
                    label: 'Audio Only',
                    icon: '🔊',
                    message: 'Waiting for video...'
                };
            case 'waiting_agent':
                return {
                    color: '#f59e0b',
                    label: 'Waiting for Agent',
                    icon: '⏳',
                    message: 'Agent is connecting...'
                };
            case 'connecting':
                return {
                    color: '#3b82f6',
                    label: 'Connecting',
                    icon: '🔄',
                    message: 'Establishing connection...'
                };
            case 'disconnected':
                return {
                    color: '#ef4444',
                    label: 'Disconnected',
                    icon: '❌',
                    message: 'Not connected'
                };
            default:
                return {
                    color: '#94a3b8',
                    label: 'Unknown',
                    icon: '⚪',
                    message: 'Unknown status'
                };
        }
    };

    const statusInfo = getStatusInfo();

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '16px',
            background: 'rgba(15, 23, 42, 0.8)',
            border: `2px solid ${statusInfo.color}40`,
            borderRadius: '12px',
            backdropFilter: 'blur(10px)'
        }}>
            {/* Overall Status */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                fontSize: '16px',
                fontWeight: 600,
                color: statusInfo.color
            }}>
                <span style={{ fontSize: '20px' }}>{statusInfo.icon}</span>
                <span>{statusInfo.label}</span>
            </div>

            {/* Status Message */}
            <div style={{
                fontSize: '12px',
                color: '#cbd5e1',
                marginTop: '4px'
            }}>
                {statusInfo.message}
            </div>

            {/* Detailed Status (for debugging) */}
            {process.env.NODE_ENV === 'development' && (
                <div style={{
                    marginTop: '12px',
                    paddingTop: '12px',
                    borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                    fontSize: '11px',
                    color: '#94a3b8',
                    fontFamily: 'monospace'
                }}>
                    <div>Room: {status.room}</div>
                    <div>Agent: {status.agent}</div>
                    <div>Audio: {status.audioTrack ? '✅' : '❌'}</div>
                    <div>Video: {status.videoTrack ? '✅' : '❌'}</div>
                </div>
            )}
        </div>
    );
};

export default ConnectionIndicator;
