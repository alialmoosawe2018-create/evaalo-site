export type VoiceState = "IDLE" | "LISTENING" | "THINKING" | "SPEAKING";

export type ClientMessage =
  | { type: "init"; candidateId?: string; clientSessionId?: string }
  | { type: "audio_chunk"; seq?: number; pcmBase64?: string; bytes?: number }
  | { type: "control"; action: "start" | "stop" | "reset" }
  | { type: "start_listening" }
  | { type: "stop_listening" }
  | { type: "playback_ended" }
  | { type: "interview_time_ended" }
  | { type: "ping" };

export type ServerMessage =
  | { type: "ready"; sessionId: string }
  | { type: "config"; hasOpenAI: boolean; hasElevenLabs: boolean; hasDeepgram?: boolean; hasSpeechmatics?: boolean }
  | { type: "state"; state: VoiceState }
  | { type: "transcript"; text: string; isFinal: boolean }
  | { type: "agent_reply"; text: string }
  | { type: "agent_reply_alignment"; words: Array<{ text: string; startSeconds: number }> }
  | { type: "audio_chunk"; chunkBase64: string; format?: "pcm" | "mp3" }
  | { type: "tts_complete" }
  | { type: "error"; message: string }
  | { type: "pong" };
