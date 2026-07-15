// ============================================
// ملف: services/agentService.ts
// الوظيفة: خدمة لتشغيل LiveKit Agent تلقائياً
// ============================================

import { spawn, ChildProcess } from 'child_process';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const activeAgents = new Map<string, ChildProcess>();
const GLOBAL_AGENT_KEY = '__global_agent__';
const GLOBAL_RECEPTION_AGENT_KEY = '__global_reception_agent__';

const AGENT_PATH = path.resolve(__dirname, '../../../avatar-evaalov2');
const RECEPTION_AGENT_PATH = path.resolve(__dirname, '../../../avatar-evaalo-reception');
const AGENT_SCRIPT = path.join(AGENT_PATH, 'src', 'agent.py');
const RECEPTION_AGENT_SCRIPT = path.join(RECEPTION_AGENT_PATH, 'src', 'agent.py');

function isExternalAgentMode(): boolean {
  return ['1', 'true', 'yes', 'on'].includes(
    String(process.env.AGENT_EXTERNAL_MODE || '').trim().toLowerCase()
  );
}

function resolveReceptionAgentPath(): string {
  const raw = String(process.env.RECEPTION_AGENT_PATH || '').trim();
  if (raw) return path.resolve(raw);
  return RECEPTION_AGENT_PATH;
}

type SpawnOptions = {
  key: string;
  label: string;
  successPatterns: string[];
  waitMs: number;
};

async function spawnAgentProcess(options: SpawnOptions): Promise<boolean> {
  const { key, label, successPatterns, waitMs } = options;
  const fs = await import('fs');
  if (!fs.existsSync(AGENT_SCRIPT)) {
    console.error(`❌ Agent script not found: ${AGENT_SCRIPT}`);
    return false;
  }

  const isWindows = process.platform === 'win32';
  const command = isWindows ? 'powershell' : 'uv';
  const args = isWindows
    ? [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `cd "${AGENT_PATH}"; if (Get-Command uv -ErrorAction SilentlyContinue) { uv run python src/agent.py dev } elseif (Get-Command python -ErrorAction SilentlyContinue) { python src/agent.py dev } elseif (Get-Command py -ErrorAction SilentlyContinue) { py -3 src/agent.py dev } else { Write-Host "python runtime not found"; exit 1 }`,
      ]
    : ['run', 'python', 'src/agent.py', 'dev'];

  let startupMatched = false;
  let startupFailed = false;

  const proc = spawn(command, args, {
    cwd: AGENT_PATH,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    env: { ...process.env, PYTHONUNBUFFERED: '1', LOG_LEVEL: 'INFO' },
  });

  activeAgents.set(key, proc);

  proc.stdout?.on('data', (data: Buffer) => {
    const output = data.toString();
    if (successPatterns.some((p) => output.includes(p))) {
      startupMatched = true;
      console.log(`✅ ${label} started (PID: ${proc.pid})`);
    }
    if (process.env.NODE_ENV === 'development') {
      console.log(`[${label}] ${output.trim()}`);
    }
  });

  proc.stderr?.on('data', (data: Buffer) => {
    const err = data.toString();
    if (
      err.includes('SyntaxError') ||
      err.includes('Traceback') ||
      err.includes('ModuleNotFoundError') ||
      err.includes('ImportError')
    ) {
      startupFailed = true;
    }
    if (
      (key === GLOBAL_AGENT_KEY || key === GLOBAL_RECEPTION_AGENT_KEY) &&
      (err.includes('WARNING') || err.includes('INFO'))
    )
      return;
    console.error(`[${label} Error] ${err.trim()}`);
  });

  proc.on('exit', (code, signal) => {
    console.log(`⚠️ ${label} exited`, { code, signal });
    activeAgents.delete(key);
  });

  proc.on('error', (err) => {
    console.error(`❌ Failed to start ${label}`, err);
    activeAgents.delete(key);
  });

  await new Promise((r) => setTimeout(r, waitMs));

  // Child may exit normally with code!=null without being "killed".
  if (proc.killed || proc.exitCode !== null || proc.signalCode !== null || startupFailed) {
    activeAgents.delete(key);
    if (proc.exitCode !== null || proc.signalCode !== null) {
      console.error(`❌ ${label} failed during startup`, {
        exitCode: proc.exitCode,
        signal: proc.signalCode,
      });
    }
    return false;
  }

  if (!startupMatched) {
    console.log(`ℹ️ ${label} is alive (PID: ${proc.pid}), waiting for first job logs...`);
  }
  return true;
}

async function spawnReceptionAgentProcess(options: SpawnOptions): Promise<boolean> {
  const receptionRoot = resolveReceptionAgentPath();
  const fs = await import('fs');
  const scriptPath = path.join(receptionRoot, 'src', 'agent.py');
  if (!fs.existsSync(scriptPath)) {
    console.error(`❌ Reception agent script not found: ${scriptPath}`);
    return false;
  }

  const isWindows = process.platform === 'win32';
  const command = isWindows ? 'powershell' : 'uv';
  const args = isWindows
    ? [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `cd "${receptionRoot}"; if (Get-Command uv -ErrorAction SilentlyContinue) { uv run python src/agent.py dev } elseif (Get-Command python -ErrorAction SilentlyContinue) { python src/agent.py dev } elseif (Get-Command py -ErrorAction SilentlyContinue) { py -3 src/agent.py dev } else { Write-Host "python runtime not found"; exit 1 }`,
      ]
    : ['run', 'python', 'src/agent.py', 'dev'];

  let startupMatched = false;
  let startupFailed = false;

  const proc = spawn(command, args, {
    cwd: receptionRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    env: { ...process.env, PYTHONUNBUFFERED: '1', LOG_LEVEL: 'INFO' },
  });

  activeAgents.set(options.key, proc);

  proc.stdout?.on('data', (data: Buffer) => {
    const output = data.toString();
    if (options.successPatterns.some((p) => output.includes(p))) {
      startupMatched = true;
      console.log(`✅ ${options.label} started (PID: ${proc.pid})`);
    }
    if (process.env.NODE_ENV === 'development') {
      console.log(`[${options.label}] ${output.trim()}`);
    }
  });

  proc.stderr?.on('data', (data: Buffer) => {
    const err = data.toString();
    if (
      err.includes('SyntaxError') ||
      err.includes('Traceback') ||
      err.includes('ModuleNotFoundError') ||
      err.includes('ImportError')
    ) {
      startupFailed = true;
    }
    if (
      (options.key === GLOBAL_AGENT_KEY || options.key === GLOBAL_RECEPTION_AGENT_KEY) &&
      (err.includes('WARNING') || err.includes('INFO'))
    )
      return;
    console.error(`[${options.label} Error] ${err.trim()}`);
  });

  proc.on('exit', (code, signal) => {
    console.log(`⚠️ ${options.label} exited`, { code, signal });
    activeAgents.delete(options.key);
  });

  proc.on('error', (err) => {
    console.error(`❌ Failed to start ${options.label}`, err);
    activeAgents.delete(options.key);
  });

  await new Promise((r) => setTimeout(r, options.waitMs));

  if (proc.killed || proc.exitCode !== null || proc.signalCode !== null || startupFailed) {
    activeAgents.delete(options.key);
    if (proc.exitCode !== null || proc.signalCode !== null) {
      console.error(`❌ ${options.label} failed during startup`, {
        exitCode: proc.exitCode,
        signal: proc.signalCode,
      });
    }
    return false;
  }

  if (!startupMatched) {
    console.log(`ℹ️ ${options.label} is alive (PID: ${proc.pid}), waiting for first job logs...`);
  }
  return true;
}

/**
 * تشغيل LiveKit Agent لـ Room محدد
 */
export async function startAgent(roomName: string): Promise<boolean> {
  if (isExternalAgentMode()) {
    console.log(`ℹ️ AGENT_EXTERNAL_MODE=true: skip spawning room agent for ${roomName}`);
    return true;
  }
  const existing = activeAgents.get(roomName);
  if (existing && !existing.killed) {
    console.log(`ℹ️ Agent already running for room: ${roomName}`);
    return true;
  }
  if (existing) activeAgents.delete(roomName);

  console.log(`🚀 Starting LiveKit Agent for room: ${roomName}`);
  const ok = await spawnAgentProcess({
    key: roomName,
    label: `Agent ${roomName}`,
    successPatterns: ['Starting Agent', 'Agent is running'],
    waitMs: 2000,
  });
  if (ok) console.log(`✅ Agent process started for room: ${roomName}`);
  return ok;
}

/**
 * إيقاف الـ Agent لـ Room محدد
 */
export function stopAgent(roomName: string): void {
  if (isExternalAgentMode()) {
    console.log(`ℹ️ AGENT_EXTERNAL_MODE=true: skip stopping external agent for ${roomName}`);
    return;
  }
  const proc = activeAgents.get(roomName);
  if (proc && !proc.killed) {
    console.log(`🛑 Stopping Agent for room: ${roomName}`);
    proc.kill('SIGTERM');
    activeAgents.delete(roomName);
  }
}

/**
 * إيقاف جميع الـ Agents النشطة
 */
export function stopAllAgents(): void {
  if (isExternalAgentMode()) {
    console.log(`ℹ️ AGENT_EXTERNAL_MODE=true: skip stopAllAgents (external process owner)`);
    return;
  }
  console.log(`🛑 Stopping all active agents (${activeAgents.size})`);
  for (const [, proc] of activeAgents.entries()) {
    if (!proc.killed) proc.kill('SIGTERM');
  }
  activeAgents.clear();
}

/**
 * التحقق من حالة الـ Agent لـ Room
 */
export function isAgentRunning(roomName: string): boolean {
  if (isExternalAgentMode()) return true;
  const proc = activeAgents.get(roomName);
  return proc !== undefined && !proc.killed;
}

/**
 * تشغيل Agent كـ service عام (مرة واحدة) لمعالجة كل الـ dispatches
 */
export async function ensureAgentRunning(): Promise<boolean> {
  if (isExternalAgentMode()) {
    console.log(`ℹ️ AGENT_EXTERNAL_MODE=true: backend expects agent to run externally`);
    return true;
  }
  const existing = activeAgents.get(GLOBAL_AGENT_KEY);
  if (existing && !existing.killed) {
    console.log(`ℹ️ Agent Service already running (PID: ${existing.pid})`);
    return true;
  }
  if (existing) activeAgents.delete(GLOBAL_AGENT_KEY);

  console.log(`🚀 Starting Agent Service...`);
  const ok = await spawnAgentProcess({
    key: GLOBAL_AGENT_KEY,
    label: 'Agent Service',
    successPatterns: ['registered worker', 'Agent is running'],
    waitMs: 3000,
  });
  if (ok) console.log(`   Agent will handle all room dispatches automatically`);
  return ok;
}

/** وكيل الاستقبال (evaalo-reception-agent) — مشروع Python منفصل */
export async function ensureReceptionAgentRunning(): Promise<boolean> {
  if (isExternalAgentMode()) {
    console.log(`ℹ️ AGENT_EXTERNAL_MODE=true: backend expects reception agent externally`);
    return true;
  }
  const existing = activeAgents.get(GLOBAL_RECEPTION_AGENT_KEY);
  if (existing && !existing.killed) {
    console.log(`ℹ️ Reception Agent Service already running (PID: ${existing.pid})`);
    return true;
  }
  if (existing) activeAgents.delete(GLOBAL_RECEPTION_AGENT_KEY);

  console.log(`🚀 Starting Reception Agent Service (evaalo-reception)...`);
  const ok = await spawnReceptionAgentProcess({
    key: GLOBAL_RECEPTION_AGENT_KEY,
    label: 'Reception Agent Service',
    successPatterns: ['registered worker', 'Agent is running'],
    waitMs: 3000,
  });
  if (ok) console.log(`   Reception worker will handle evaalo-reception-agent dispatches`);
  return ok;
}

export function isReceptionAgentServiceRunning(): boolean {
  if (isExternalAgentMode()) return true;
  const proc = activeAgents.get(GLOBAL_RECEPTION_AGENT_KEY);
  return proc !== undefined && !proc.killed;
}

/**
 * التحقق من حالة Agent Service (global)
 */
export function isAgentServiceRunning(): boolean {
  if (isExternalAgentMode()) return true;
  const proc = activeAgents.get(GLOBAL_AGENT_KEY);
  return proc !== undefined && !proc.killed;
}

export default {
  startAgent,
  stopAgent,
  stopAllAgents,
  isAgentRunning,
  ensureAgentRunning,
  ensureReceptionAgentRunning,
  isAgentServiceRunning,
  isReceptionAgentServiceRunning,
};
