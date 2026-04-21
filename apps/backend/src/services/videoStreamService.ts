// ============================================
// ملف: services/videoStreamService.ts
// الوظيفة: إدارة WebSocket connections لإرسال video stream إلى Frontend
// ============================================

import { WebSocket } from 'ws';

// Map لتخزين WebSocket connections لكل session
const sessionConnections = new Map<string, WebSocket>();

/**
 * إضافة WebSocket connection لـ session معين
 * 
 * @param sessionId - Session ID
 * @param ws - WebSocket connection
 */
export function addVideoStreamConnection(sessionId: string, ws: WebSocket): void {
    // إزالة connection قديم إذا كان موجوداً
    const existingConnection = sessionConnections.get(sessionId);
    if (existingConnection && existingConnection.readyState === WebSocket.OPEN) {
        existingConnection.close();
    }

    // إضافة connection جديد
    sessionConnections.set(sessionId, ws);

    // تنظيف عند إغلاق connection
    ws.on('close', () => {
        sessionConnections.delete(sessionId);
        console.log(`🔌 Video stream connection closed for session: ${sessionId.substring(0, 8)}...`);
    });

    ws.on('error', (error) => {
        console.error(`❌ WebSocket error for session ${sessionId.substring(0, 8)}...:`, error);
        sessionConnections.delete(sessionId);
    });

    console.log(`✅ Video stream connection added for session: ${sessionId.substring(0, 8)}...`);
}

/**
 * إرسال video chunk إلى Frontend عبر WebSocket
 * 
 * @param sessionId - Session ID
 * @param videoChunk - Video chunk (Buffer)
 */
export function sendVideoChunkToFrontend(sessionId: string, videoChunk: Buffer): void {
    const ws = sessionConnections.get(sessionId);

    if (!ws) {
        // لا نطبع warning لكل chunk لتجنب spam
        return;
    }

    if (ws.readyState === WebSocket.OPEN) {
        try {
            // إرسال video chunk كـ binary data
            ws.send(videoChunk, { binary: true });
            // Log كل 10 chunks لتجنب spam
            if (Math.random() < 0.1) {
                console.log(`📤 Sent video chunk to frontend (${videoChunk.length} bytes) for session: ${sessionId.substring(0, 8)}...`);
            }
        } catch (error) {
            console.error(`❌ Error sending video chunk to frontend:`, error);
            sessionConnections.delete(sessionId);
        }
    } else {
        // إذا كان connection مغلق، نزيله من Map
        console.warn(`⚠️ Video WebSocket not open for session: ${sessionId.substring(0, 8)}..., readyState: ${ws.readyState}`);
        sessionConnections.delete(sessionId);
    }
}

/**
 * إرسال video chunk كـ base64 string (للتوافق مع JSON)
 * 
 * @param sessionId - Session ID
 * @param videoChunk - Video chunk (Buffer)
 */
export function sendVideoChunkAsBase64(sessionId: string, videoChunk: Buffer): void {
    const ws = sessionConnections.get(sessionId);

    if (!ws) {
        return;
    }

    if (ws.readyState === WebSocket.OPEN) {
        try {
            const base64Video = videoChunk.toString('base64');
            ws.send(JSON.stringify({
                type: 'video',
                data: base64Video,
                timestamp: Date.now()
            }));
        } catch (error) {
            console.error(`❌ Error sending video chunk (base64) to frontend:`, error);
            sessionConnections.delete(sessionId);
        }
    } else {
        sessionConnections.delete(sessionId);
    }
}

/**
 * إزالة connection لـ session معين
 * 
 * @param sessionId - Session ID
 */
export function removeVideoStreamConnection(sessionId: string): void {
    const ws = sessionConnections.get(sessionId);
    if (ws) {
        ws.close();
        sessionConnections.delete(sessionId);
        console.log(`🧹 Video stream connection removed for session: ${sessionId.substring(0, 8)}...`);
    }
}

/**
 * الحصول على عدد الـ connections النشطة
 */
export function getActiveConnectionsCount(): number {
    return sessionConnections.size;
}

/**
 * الحصول على جميع session IDs النشطة
 */
export function getActiveSessions(): string[] {
    return Array.from(sessionConnections.keys());
}

export default {
    addVideoStreamConnection,
    sendVideoChunkToFrontend,
    sendVideoChunkAsBase64,
    removeVideoStreamConnection,
    getActiveConnectionsCount,
    getActiveSessions,
};

