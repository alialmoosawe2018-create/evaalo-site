#!/usr/bin/env node
/**
 * scripts/start-stripe-listen.cjs
 *
 * Forwards Stripe webhooks to the local backend and writes the CLI signing
 * secret into apps/backend/.env (STRIPE_WEBHOOK_SECRET).
 *
 * Uses STRIPE_SECRET_KEY from .env so the CLI account matches the backend.
 *
 * Usage (from apps/backend):
 *   npm run stripe:listen
 *
 * Restart the backend after the whsec line is written (tsx watch may not reload .env).
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const backendDir = path.resolve(__dirname, '..');
const envPath = path.join(backendDir, '.env');
const port = process.env.PORT || '5000';
const forwardTarget = `localhost:${port}/webhook/stripe`;

function readEnvValue(key) {
    if (!fs.existsSync(envPath)) return null;
    const content = fs.readFileSync(envPath, 'utf8');
    const re = new RegExp(`^${key}=(.*)$`, 'm');
    const match = content.match(re);
    if (!match) return null;
    return match[1].trim().replace(/^["']|["']$/g, '');
}

function writeWebhookSecret(whsec) {
    if (!fs.existsSync(envPath)) {
        console.error(`\n❌ Missing ${envPath} — create it before running stripe:listen.\n`);
        return;
    }
    let content = fs.readFileSync(envPath, 'utf8');
    const line = `STRIPE_WEBHOOK_SECRET=${whsec}`;
    if (/^STRIPE_WEBHOOK_SECRET=/m.test(content)) {
        content = content.replace(/^STRIPE_WEBHOOK_SECRET=.*$/m, line);
    } else {
        content = `${content.replace(/\s*$/, '')}\n${line}\n`;
    }
    fs.writeFileSync(envPath, content, 'utf8');
    console.log(`\n✅ Wrote STRIPE_WEBHOOK_SECRET to .env`);
    console.log('   Restart the backend if it was already running (env is read at boot).\n');
}

const apiKey = readEnvValue('STRIPE_SECRET_KEY');
if (!apiKey) {
    console.error('❌ STRIPE_SECRET_KEY not found in apps/backend/.env');
    process.exit(1);
}

console.log('============================================');
console.log('🔔 Stripe CLI — local webhook forwarding');
console.log(`    forward-to: ${forwardTarget}`);
console.log('    api-key:    STRIPE_SECRET_KEY from .env');
console.log('============================================\n');

const args = ['listen', '--forward-to', forwardTarget, '--api-key', apiKey];
const child = spawn('stripe', args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true,
});

let secretWritten = false;

function handleOutput(chunk) {
    const text = chunk.toString();
    process.stdout.write(text);
    if (secretWritten) return;
    const match = text.match(/whsec_[a-zA-Z0-9]+/);
    if (match) {
        secretWritten = true;
        try {
            writeWebhookSecret(match[0]);
        } catch (err) {
            console.error('❌ Failed to update .env:', err?.message || err);
        }
    }
}

child.stdout.on('data', handleOutput);
child.stderr.on('data', handleOutput);

child.on('error', (err) => {
    if (err && err.code === 'ENOENT') {
        console.error('\n❌ stripe CLI not found in PATH.');
        console.error('   Install: https://docs.stripe.com/stripe-cli\n');
        process.exit(1);
    }
    console.error('❌ Failed to start stripe listen:', err);
    process.exit(1);
});

child.on('exit', (code) => process.exit(code ?? 0));

process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
