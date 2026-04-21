// ============================================
// ملف: services/avatarService.ts
// الوظيفة: Avatar Service للتعامل مع Beyond Presence Avatar
// ============================================

import { RoomServiceClient } from 'livekit-server-sdk';
import dotenv from 'dotenv';
import { getLivekitTwirpClientOptions } from '../livekitHttpConfig.js';

dotenv.config();

const LIVEKIT_URL = process.env.LIVEKIT_URL || '';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';
const BEYOND_PRESENCE_AVATAR_ID = process.env.BEYOND_PRESENCE_AVATAR_ID || '';

// RoomServiceClient يحتاج URL بدون wss:// أو ws://
const getHttpUrl = (url: string): string => {
    if (!url) return '';
    return url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
};

const roomService = new RoomServiceClient(
    getHttpUrl(LIVEKIT_URL),
    LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET,
    getLivekitTwirpClientOptions()
);

/**
 * إرسال الصوت إلى Avatar عبر LiveKit Room
 * 
 * ملاحظة: AvatarSession من livekit.plugins.bey متوفر في Python فقط
 * لذلك سنستخدم Python Agent فقط للـ Avatar
 * 
 * @param roomName - اسم LiveKit Room
 * @param audioBuffer - Audio buffer (MP3)
 */
export async function sendAudioToAvatar(
    roomName: string,
    audioBuffer: Buffer
): Promise<void> {
    // TODO: إرسال الصوت إلى AvatarSession
    // AvatarSession يحتاج Python Agent
    // سنستخدم Python Agent فقط للـ Avatar
    
    console.log(`🎭 Sending audio to Avatar in room: ${roomName} (${audioBuffer.length} bytes)`);
    console.log(`⚠️ AvatarSession requires Python Agent - will be handled by Python Agent`);
}

/**
 * إنشاء LiveKit Room للـ Avatar
 */
export async function createAvatarRoom(sessionId: string): Promise<string> {
    const roomName = `room-avatar-${sessionId}`;
    
    if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
        throw new Error('Missing LiveKit credentials');
    }
    
    try {
        await roomService.createRoom({
            name: roomName,
            emptyTimeout: 10 * 60,
            maxParticipants: 2,
        });
        
        console.log(`✅ Avatar Room created: ${roomName}`);
        return roomName;
    } catch (error: any) {
        if (error.message?.includes('already exists')) {
            console.log(`ℹ️ Avatar Room already exists: ${roomName}`);
            return roomName;
        }
        throw error;
    }
}
