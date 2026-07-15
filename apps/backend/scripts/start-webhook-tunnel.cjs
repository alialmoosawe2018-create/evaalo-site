#!/usr/bin/env node
/**
 * scripts/start-webhook-tunnel.cjs
 *
 * يفتح Cloudflare Tunnel مؤقت على المنفذ المحلي للـ backend ليصبح Clerk webhook
 * قابلًا للاختبار من Clerk Dashboard أثناء التطوير.
 *
 * المتطلبات:
 *   - تثبيت cloudflared (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
 *   - الـ backend يعمل على PORT (افتراضي 5000)
 *
 * تشغيل:
 *   node scripts/start-webhook-tunnel.cjs
 *   أو: PORT=5000 node scripts/start-webhook-tunnel.cjs
 *
 * بعد بدء التشغيل، انسخ الـ URL الظاهر في الطرفية (مثل https://xxx.trycloudflare.com)
 * وأضف "/api/webhooks/clerk" إليه، ثم ضعه في Clerk Dashboard → Webhooks → Endpoint URL.
 */

const { spawn } = require('child_process');

const port = process.env.PORT || '5000';
const target = `http://localhost:${port}`;

console.log('============================================');
console.log('🚇 Cloudflare Tunnel — Clerk webhook (dev)');
console.log(`    target: ${target}`);
console.log('    أعد تشغيل هذا السكربت لو الـ tunnel فُصل.');
console.log('============================================\n');

const child = spawn('cloudflared', ['tunnel', '--url', target], {
    stdio: 'inherit',
    shell: true,
});

child.on('error', (err) => {
    if (err && err.code === 'ENOENT') {
        console.error('\n❌ لم يتم العثور على cloudflared في PATH.');
        console.error('   ثبّته من: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/');
        process.exit(1);
    }
    console.error('❌ خطأ في تشغيل cloudflared:', err);
    process.exit(1);
});

child.on('exit', (code) => process.exit(code ?? 0));
