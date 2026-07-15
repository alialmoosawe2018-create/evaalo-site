import type { IncomingMessage } from 'http';
import type { WebSocket } from 'ws';
import { handleVoiceReceptionWsConnection } from './voiceReceptionSession.js';

/** WebSocket إيجنت الريسبشن — المسار: /ws/voice-reception */
export function attachVoiceReceptionWs(ws: WebSocket, req: IncomingMessage) {
    handleVoiceReceptionWsConnection(ws, req);
}

export { handleVoiceReceptionWsConnection };
