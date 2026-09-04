// ============================================
// ملف: services/livekitService.ts
// الوظيفة: LiveKit Service لإدارة Rooms و Tokens
// يدعم scope interview (افتراضي) و reception (مفاتيح LIVEKIT_RECEPTION_* مع fallback)
// ============================================

import { RoomServiceClient, AccessToken, AgentDispatchClient } from 'livekit-server-sdk';
import dotenv from 'dotenv';
import { ensureAgentRunning, ensureReceptionAgentRunning } from './agentService.js';
import { getLivekitTwirpClientOptions, withLiveKitNetworkRetries } from '../livekitHttpConfig.js';

dotenv.config();

export type LiveKitScope = 'interview' | 'reception';

const twirpOpts = getLivekitTwirpClientOptions();

// RoomServiceClient يحتاج URL بدون wss:// أو ws://
const getHttpUrl = (url: string): string => {
    if (!url) return '';
    return url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
};

/** Credentials للغرفة والتوكن والـ dispatch — reception يمكن أن يستخدم مشروع LiveKit منفصل */
export function getLiveKitCredentials(scope: LiveKitScope = 'interview'): {
    url: string;
    apiKey: string;
    apiSecret: string;
} {
    if (scope === 'reception') {
        return {
            url: process.env.LIVEKIT_RECEPTION_URL || process.env.LIVEKIT_URL || '',
            apiKey: process.env.LIVEKIT_RECEPTION_API_KEY || process.env.LIVEKIT_API_KEY || '',
            apiSecret:
                process.env.LIVEKIT_RECEPTION_API_SECRET || process.env.LIVEKIT_API_SECRET || '',
        };
    }
    return {
        url: process.env.LIVEKIT_URL || '',
        apiKey: process.env.LIVEKIT_API_KEY || '',
        apiSecret: process.env.LIVEKIT_API_SECRET || '',
    };
}

const clientsByScope = new Map<
    LiveKitScope,
    { roomService: RoomServiceClient; agentDispatchClient: AgentDispatchClient }
>();

function getClients(scope: LiveKitScope = 'interview') {
    let pair = clientsByScope.get(scope);
    if (!pair) {
        const { url, apiKey, apiSecret } = getLiveKitCredentials(scope);
        const httpUrl = getHttpUrl(url);
        pair = {
            roomService: new RoomServiceClient(httpUrl, apiKey, apiSecret, twirpOpts),
            agentDispatchClient: new AgentDispatchClient(httpUrl, apiKey, apiSecret, twirpOpts),
        };
        clientsByScope.set(scope, pair);
    }
    return pair;
}

/**
 * إنشاء Room جديد في LiveKit
 * @param sessionId للـ interview: يصبح room-{sessionId}. للـ reception: يُستخدم كجزء من evaalo-reception-{sanitized}
 */
export async function createLiveKitRoom(
    sessionId: string,
    scope: LiveKitScope = 'interview'
): Promise<string> {
    const { url, apiKey, apiSecret } = getLiveKitCredentials(scope);
    if (!url || !apiKey || !apiSecret) {
        throw new Error(
            `Missing LiveKit credentials (${scope}). Check LIVEKIT_* or LIVEKIT_RECEPTION_* in .env`
        );
    }

    const roomName =
        scope === 'reception'
            ? `evaalo-reception-${sanitizeRoomSegment(sessionId)}`
            : `room-${sessionId}`;

    const { roomService } = getClients(scope);

    try {
        await withLiveKitNetworkRetries('createLiveKitRoom', () =>
            roomService.createRoom({
                name: roomName,
                emptyTimeout: 15 * 60,
                maxParticipants: 8,
            })
        );

        console.log(`✅ LiveKit Room created (${scope}): ${roomName}`);
        return roomName;
    } catch (error: any) {
        if (error.message?.includes('already exists')) {
            console.log(`ℹ️ LiveKit Room already exists (${scope}): ${roomName}`);
            return roomName;
        }

        const httpBase = getHttpUrl(url);
        const connectTimedOut =
            error?.code === 'UND_ERR_CONNECT_TIMEOUT' ||
            error?.cause?.code === 'UND_ERR_CONNECT_TIMEOUT';

        if (connectTimedOut || error.message?.includes('fetch failed')) {
            console.error('❌ Cannot reach LiveKit Cloud (TCP/TLS or HTTP to Twirp). Check:');
            console.error(`   1. LIVEKIT_URL matches your project (${scope}): ${url}`);
            console.error(`   2. From this machine: curl -I "${httpBase}/"`);
        }

        console.error('❌ Error creating LiveKit room:', error);
        throw error;
    }
}

function sanitizeRoomSegment(raw: string): string {
    const s = String(raw || '')
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(0, 96);
    return s || 'guest';
}

export async function createUserToken(
    roomName: string,
    userId: string,
    metadata?: Record<string, any>,
    scope: LiveKitScope = 'interview'
): Promise<string> {
    try {
        const { apiKey, apiSecret } = getLiveKitCredentials(scope);
        const token = new AccessToken(apiKey, apiSecret, {
            identity: userId,
        });

        token.addGrant({
            room: roomName,
            roomJoin: true,
            canPublish: true,
            canSubscribe: true,
        });

        let jwtResult = token.toJwt();
        let jwtString: string;

        if (jwtResult && typeof (jwtResult as any).then === 'function') {
            jwtString = await jwtResult;
        } else {
            jwtString = await Promise.resolve(jwtResult as string | Promise<string>);
        }

        if (!jwtString || typeof jwtString !== 'string' || jwtString.length < 50) {
            console.error('❌ Invalid JWT token created:', {
                scope,
                originalType: typeof jwtResult,
                resolvedType: typeof jwtString,
                length: jwtString?.length || 0,
            });
            throw new Error('Failed to create valid JWT token');
        }

        console.log(`✅ JWT token created (${scope}):`, {
            length: jwtString.length,
            preview: jwtString.substring(0, 50) + '...',
        });

        return jwtString;
    } catch (error: any) {
        console.error('❌ Error creating user token:', error);
        throw error;
    }
}

/**
 * حذف Room — idempotent عند 404
 */
export async function deleteLiveKitRoom(
    roomName: string,
    scope: LiveKitScope = 'interview'
): Promise<void> {
    try {
        const { roomService } = getClients(scope);
        await roomService.deleteRoom(roomName);
        console.log(`✅ LiveKit Room deleted (${scope}): ${roomName}`);
    } catch (error: any) {
        const msg = String(error?.message || error || '');
        if (/not\s*found|404|does not exist/i.test(msg)) {
            console.log(`ℹ️ LiveKit Room already gone (${scope}): ${roomName}`);
            return;
        }
        console.error('❌ Error deleting LiveKit room:', error);
        throw error;
    }
}

/**
 * Delete every other live room belonging to this candidate, keeping `keepRoomName`.
 *
 * The interview worker takes ONE job at a time and rejects the rest
 * (`_on_job_request`: "rejecting job (worker busy)"). /prepare dispatches the agent
 * into a prewarm room where it waits 60s for a candidate; if /start then fails to
 * reuse that room — the reuse map is per-process memory, so a restart or a second
 * instance loses it — a second room is created, the worker is still holding the
 * prewarm job, and the real dispatch is refused. The candidate then sits in a room
 * no agent will ever join, which is exactly what happened across three attempts.
 *
 * Scanning by name rather than by the remembered room means this still works when
 * that memory is gone, which is precisely the case that breaks.
 *
 * Returns the rooms it removed. Never throws: freeing the worker is best-effort and
 * must not block starting the interview.
 */
export async function deleteOtherCandidateRooms(
    candidateId: string,
    keepRoomName: string,
    scope: LiveKitScope = 'interview'
): Promise<string[]> {
    const id = String(candidateId || '').trim();
    if (!id) return [];
    const removed: string[] = [];
    try {
        const { roomService } = getClients(scope);
        const rooms = await roomService.listRooms();
        const prefix = `room-video-interview-${id}-`;
        for (const room of rooms) {
            const name = room?.name || '';
            if (!name.startsWith(prefix) || name === keepRoomName) continue;
            try {
                await roomService.deleteRoom(name);
                removed.push(name);
                console.log(`🧹 Freed stale interview room for candidate ${id}: ${name}`);
            } catch (err: any) {
                console.warn(`⚠️ Could not delete stale room ${name}:`, err?.message || err);
            }
        }
    } catch (error: any) {
        console.warn(`⚠️ deleteOtherCandidateRooms failed for ${id}:`, error?.message || error);
    }
    return removed;
}

/**
 * Explicit Dispatch — agentName يجب أن يطابق تسجيل الـ worker في LiveKit
 */
export async function dispatchAgentToRoom(
    roomName: string,
    metadata?: Record<string, any>,
    agentName: string = 'video-interview-agent',
    scope: LiveKitScope = 'interview'
): Promise<void> {
    try {
        const { url, apiKey, apiSecret } = getLiveKitCredentials(scope);
        if (!url || !apiKey || !apiSecret) {
            throw new Error(`Missing LiveKit credentials (${scope})`);
        }

        if (agentName === 'evaalo-reception-agent') {
            const ok = await ensureReceptionAgentRunning();
            if (!ok) {
                throw new Error(
                    'Reception Agent Service failed to start. Run avatar-evaalo-reception worker or set AGENT_EXTERNAL_MODE=true.'
                );
            }
        } else {
            const agentRunning = await ensureAgentRunning();
            if (!agentRunning) {
                throw new Error('Agent Service failed to start. Check agent logs for Python/runtime errors.');
            }
        }

        console.log(`🚀 Creating explicit dispatch (${scope}) for agent "${agentName}" → ${roomName}`);

        const metadataString = metadata ? JSON.stringify(metadata) : undefined;
        const { agentDispatchClient } = getClients(scope);

        const dispatch = await withLiveKitNetworkRetries('dispatchAgentToRoom', () =>
            agentDispatchClient.createDispatch(roomName, agentName, {
                metadata: metadataString,
            })
        );

        console.log(`✅ Agent dispatched (${scope}):`, {
            dispatchId: dispatch.id,
            roomName,
            agentName,
            hasMetadata: !!metadataString,
        });
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
    getLiveKitCredentials,
};
