const fs = require('node:fs');
const path = require('node:path');

const srcDir = path.join(__dirname, '..', 'src', 'evaalo-only-voice-reception', 'data');
const destDir = path.join(__dirname, '..', 'dist', 'evaalo-only-voice-reception', 'data');

if (!fs.existsSync(srcDir)) {
    console.warn('[copy-reception-data] Source directory not found:', srcDir);
    process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
fs.cpSync(srcDir, destDir, { recursive: true });
console.info('[copy-reception-data] Copied reception knowledge data to', destDir);
