#!/usr/bin/env node
/**
 * ينهي أي عملية تستخدم المنفذ 5000 قبل تشغيل الـ backend
 * يعمل على Windows
 */
const { execSync } = require('child_process');

const PORT = 5000;

try {
  const out = execSync(`netstat -ano | findstr :${PORT}`, { encoding: 'utf8' });
  const lines = out.split('\n').filter((l) => l.includes('LISTENING'));
  for (const line of lines) {
    const pid = line.trim().split(/\s+/).pop();
    if (pid && /^\d+$/.test(pid)) {
      execSync(`taskkill /PID ${pid} /F`, { stdio: 'inherit' });
      console.log(`[kill-port] تم إنهاء العملية ${pid} على المنفذ ${PORT}`);
      break;
    }
  }
} catch (e) {
  if (e.status === 1) {
    // لا توجد عملية على المنفذ
  } else {
    console.warn('[kill-port]', e.message);
  }
}
