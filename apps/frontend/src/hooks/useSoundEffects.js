/**
 * Sound Effects Hook
 * يوفر sound effects للتفاعلات المختلفة
 */
import { useRef, useCallback } from 'react';

const useSoundEffects = () => {
    const audioContextRef = useRef(null);
    const soundsRef = useRef({});

    // Initialize AudioContext
    const initAudioContext = useCallback(() => {
        if (!audioContextRef.current) {
            try {
                audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
            } catch (e) {
                console.warn('AudioContext not supported:', e);
                return null;
            }
        }
        return audioContextRef.current;
    }, []);

    // Play a tone
    const playTone = useCallback((frequency, duration, type = 'sine') => {
        const ctx = initAudioContext();
        if (!ctx) return;

        try {
            const oscillator = ctx.createOscillator();
            const gainNode = ctx.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(ctx.destination);

            oscillator.frequency.value = frequency;
            oscillator.type = type;

            gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

            oscillator.start(ctx.currentTime);
            oscillator.stop(ctx.currentTime + duration);
        } catch (e) {
            console.warn('Error playing tone:', e);
        }
    }, [initAudioContext]);

    // Sound effects
    const playSound = useCallback((soundName) => {
        const ctx = initAudioContext();
        if (!ctx) return;

        const sounds = {
            // Connection sounds
            connect: () => playTone(440, 0.1, 'sine'),
            disconnect: () => playTone(220, 0.2, 'sine'),
            
            // Agent state sounds
            agentListening: () => playTone(523.25, 0.05, 'sine'), // C5
            agentThinking: () => playTone(659.25, 0.1, 'triangle'), // E5
            agentSpeaking: () => playTone(783.99, 0.05, 'sine'), // G5
            
            // Interaction sounds
            messageReceived: () => playTone(880, 0.08, 'sine'),
            error: () => {
                // Error sound: descending tone
                playTone(440, 0.1, 'sine');
                setTimeout(() => playTone(330, 0.15, 'sine'), 100);
            },
            
            // Success sound
            success: () => {
                // Success sound: ascending tones
                playTone(523.25, 0.1, 'sine'); // C5
                setTimeout(() => playTone(659.25, 0.1, 'sine'), 100); // E5
                setTimeout(() => playTone(783.99, 0.1, 'sine'), 200); // G5
            }
        };

        if (sounds[soundName]) {
            sounds[soundName]();
        }
    }, [initAudioContext, playTone]);

    // Haptic feedback (for mobile devices)
    const triggerHaptic = useCallback((type = 'light') => {
        if ('vibrate' in navigator) {
            const patterns = {
                light: 10,
                medium: 20,
                heavy: 30,
                double: [10, 50, 10]
            };
            
            const pattern = patterns[type] || patterns.light;
            navigator.vibrate(pattern);
        }
    }, []);

    return {
        playSound,
        triggerHaptic,
        playTone
    };
};

export default useSoundEffects;
