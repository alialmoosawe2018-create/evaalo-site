import type { VoiceState } from "./protocol.js";

export type VoiceSession = {
  id: string;
  candidateId?: string;
  state: VoiceState;
  createdAt: number;
  lastSeen: number;
};

const sessions = new Map<string, VoiceSession>();

export function createSession(id: string, candidateId?: string): VoiceSession {
  const now = Date.now();
  const session: VoiceSession = {
    id,
    candidateId,
    state: "IDLE",
    createdAt: now,
    lastSeen: now,
  };
  sessions.set(id, session);
  return session;
}

export function getSession(id: string) {
  return sessions.get(id);
}

export function updateState(id: string, state: VoiceState) {
  const session = sessions.get(id);
  if (!session) return;
  session.state = state;
  session.lastSeen = Date.now();
}

export function touchSession(id: string) {
  const session = sessions.get(id);
  if (!session) return;
  session.lastSeen = Date.now();
}

export function removeSession(id: string) {
  sessions.delete(id);
}

/**
 * Sessions plausibly still on a live call. `lastSeen` gates the count so a
 * leaked entry cannot report a phantom interview forever — this number decides
 * whether a deploy is allowed to replace the container, and a stuck count would
 * block every deploy.
 */
export function countLiveSessions(maxIdleMs = 120_000): number {
  const cutoff = Date.now() - maxIdleMs;
  let live = 0;
  for (const session of sessions.values()) {
    if (session.lastSeen >= cutoff) live += 1;
  }
  return live;
}
