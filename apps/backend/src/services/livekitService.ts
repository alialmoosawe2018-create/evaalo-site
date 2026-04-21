// ============================================
// ملف: services/livekitService.ts
// الوظيفة: LiveKit Service لإدارة Rooms و Tokens
// ============================================

import { RoomServiceClient, AccessToken, AgentDispatchClient } from 'livekit-server-sdk';
import dotenv from 'dotenv';
import { ensureAgentRunning } from './agentService.js';
import { getLivekitTwirpClientOptions, withLiveKitNetworkRetries } from '../livekitHttpConfig.js';

dotenv.config();

const LIVEKIT_URL = process.env.LIVEKIT_URL || '';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';

const twirpOpts = getLivekitTwirpClientOptions();

// RoomServiceClient يحتاج URL بدون wss:// أو ws://
// تحويل wss://domain.com إلى https://domain.com
const getHttpUrl = (url: string): string => {
    if (!url) return '';
    return url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
};

const roomService = new RoomServiceClient(
    getHttpUrl(LIVEKIT_URL),
    LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET,
    twirpOpts
);
const agentDispatchClient = new AgentDispatchClient(
    getHttpUrl(LIVEKIT_URL),
    LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET,
    twirpOpts
);

/**
 * إنشاء Room جديد في LiveKit
 */
export async function createLiveKitRoom(sessionId: string): Promise<string> {
    const roomName = `room-${sessionId}`;
    
    // التحقق من وجود التوكنات
    if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
        throw new Error('Missing LiveKit credentials. Please check LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET in .env file');
    }
    
    try {
        await withLiveKitNetworkRetries('createLiveKitRoom', () =>
            roomService.createRoom({
                name: roomName,
                // Room stays open longer during slow agent joins / reconnects; agent + user + avatar workers
                emptyTimeout: 15 * 60,
                maxParticipants: 8,
            })
        );

        console.log(`✅ LiveKit Room created: ${roomName}`);
        return roomName;
    } catch (error: any) {
        // إذا كان Room موجوداً بالفعل، نعيد الاسم
        if (error.message?.includes('already exists')) {
            console.log(`ℹ️ LiveKit Room already exists: ${roomName}`);
            return roomName;
        }

        const httpBase = getHttpUrl(LIVEKIT_URL);
        const connectTimedOut =
            error?.code === 'UND_ERR_CONNECT_TIMEOUT' ||
            error?.cause?.code === 'UND_ERR_CONNECT_TIMEOUT';

        // معالجة أخطاء الاتصال
        if (connectTimedOut || error.message?.includes('fetch failed')) {
            console.error('❌ Cannot reach LiveKit Cloud (TCP/TLS or HTTP to Twirp). Check:');
            console.error(`   1. LIVEKIT_URL matches your project: ${LIVEKIT_URL}`);
            console.error(`   2. From this machine: curl -I "${httpBase}/"  (expect HTTP response, not hang)`);
            console.error('   3. VPN / corporate firewall / proxy — allow HTTPS to *.livekit.cloud');
            console.error(
                '   4. Optional: LIVEKIT_FETCH_CONNECT_TIMEOUT_MS=45000 LIVEKIT_HTTP_RETRIES=5 (already defaults to 30s connect when LIVEKIT_URL is set)'
            );
        }

        console.error('❌ Error creating LiveKit room:', error);
        throw error;
    }
}

/**
 * إنشاء Access Token للمستخدم
 * ✅ EXPLICIT DISPATCH: Agent يتم إرساله عبر API (dispatchAgentToRoom)
 * لا حاجة لإضافة RoomAgentDispatch في Token - نستخدم API dispatch بدلاً من ذلك
 * ملاحظة: toJwt() يرجع Promise في بعض الإصدارات
 * @param roomName اسم الـ Room
 * @param userId معرف المستخدم
 * @param metadata بيانات إضافية للـ Agent (اختياري) - يتم إرسالها عبر API dispatch
 */
export async function createUserToken(
    roomName: string, 
    userId: string, 
    metadata?: Record<string, any>
): Promise<string> {
    try {
        const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
            identity: userId,
        });
        
        token.addGrant({
            room: roomName,
            roomJoin: true,
            canPublish: true,
            canSubscribe: true,
        });
        
        // ✅ EXPLICIT DISPATCH: Agent يتم إرساله عبر API (dispatchAgentToRoom)
        // لا حاجة لإضافة RoomAgentDispatch في Token - نستخدم API dispatch بدلاً من ذلك
        // هذا يعطي تحكم أفضل ويمكن إرسال metadata بشكل مباشر
        console.log('✅ Token created (Agent will be dispatched via API)');
        
        // toJwt() قد يرجع Promise - نستخدم await دائماً
        let jwtResult = token.toJwt();
        
        // التعامل مع Promise من toJwt() بشكل صحيح
        let jwtString: string;

        // التحقق إذا كان Promise
        if (jwtResult && typeof (jwtResult as any).then === "function") {
            // jwtResult هو Promise - نستخدم await
            jwtString = await jwtResult;
        } else {
            // jwtResult هو string مباشرة
            jwtString = jwtResult as string;
        }

        // التحقق من أن JWT تم إنشاؤه بشكل صحيح
        if (!jwtString || typeof jwtString !== 'string' || jwtString.length < 50) {
            console.error('❌ Invalid JWT token created:', {
                originalType: typeof jwtResult,
                resolvedType: typeof jwtString,
                length: jwtString?.length || 0,
                value: jwtString?.substring(0, 100) || 'null/undefined'
            });
            throw new Error('Failed to create valid JWT token');
        }
        
        console.log('✅ JWT token created successfully:', {
            length: jwtString.length,
            preview: jwtString.substring(0, 50) + '...',
            note: 'Agent will be dispatched via API (explicit dispatch)'
        });
        
        return jwtString;
    } catch (error: any) {
        console.error('❌ Error creating user token:', error);
        throw error;
    }
}

/**
 * حذف Room
 */
export async function deleteLiveKitRoom(roomName: string): Promise<void> {
    try {
        await roomService.deleteRoom(roomName);
        console.log(`✅ LiveKit Room deleted: ${roomName}`);
    } catch (error) {
        console.error('❌ Error deleting LiveKit room:', error);
        throw error;
    }
}

/**
 * إرسال Agent إلى Room باستخدام Explicit Dispatch
 * ✅ EXPLICIT DISPATCH: Agent uses explicit dispatch (requires agent_name)
 * Agent must be registered with agent_name="video-interview-agent" in agent.py
 * @param roomName اسم الـ Room
 * @param metadata بيانات إضافية (JSON object) - يتم تحويلها إلى JSON string
 * @param agentName اسم الـ Agent (افتراضي: "video-interview-agent")
 */
export async function dispatchAgentToRoom(
    roomName: string,
    metadata?: Record<string, any>,
    agentName: string = 'video-interview-agent'
): Promise<void> {
    try {
        // التحقق من وجود التوكنات
        if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
            throw new Error('Missing LiveKit credentials. Please check LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET in .env file');
        }

        // Ensure worker is alive before creating dispatch to avoid "dispatched but no worker" confusion.
        const agentRunning = await ensureAgentRunning();
        if (!agentRunning) {
            throw new Error('Agent Service failed to start. Check agent logs for Python/runtime errors.');
        }
        console.log(`✅ Agent Service is running - ready for explicit dispatch`);
        console.log(`🚀 Creating explicit dispatch for agent "${agentName}" to room: ${roomName}`);
        
        // تحويل metadata إلى JSON string (LiveKit يتوقع JSON string)
        const metadataString = metadata ? JSON.stringify(metadata) : undefined;
        
        // إنشاء explicit dispatch باستخدام AgentDispatchClient
        const dispatch = await withLiveKitNetworkRetries('dispatchAgentToRoom', () =>
            agentDispatchClient.createDispatch(roomName, agentName, {
                metadata: metadataString,
            })
        );
        
        console.log(`✅ Agent dispatched successfully with explicit dispatch:`, {
            dispatchId: dispatch.id,
            roomName: roomName,
            agentName: agentName,
            hasMetadata: !!metadataString
        });
        
        console.log(`✅ Agent dispatched via API (Explicit Dispatch) successfully`);
    } catch (error: any) {
        console.error('❌ Error creating explicit dispatch:', error);
        throw error;
    }
}

export default {
    createLiveKitRoom,
    createUserToken,
    deleteLiveKitRoom,
    dispatchAgentToRoom,
};
