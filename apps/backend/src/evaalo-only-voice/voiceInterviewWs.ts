import type { IncomingMessage } from "http";
import type { WebSocket } from "ws";
import { attachVoiceSession } from "./voiceSessionCore.js";

/** WebSocket مقابلة صوتية كاملة — المسار: /ws/voice-interview */
export function handleVoiceInterviewWsConnection(ws: WebSocket, req: IncomingMessage) {
  attachVoiceSession(ws, req, "interview");
}
