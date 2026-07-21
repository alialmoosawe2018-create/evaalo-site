/**
 * GitHub Pages serves 404.html for unknown paths. Copy the built SPA shell so
 * deep links (e.g. /account/spending) load the app directly — no redirect hop.
 */
const { copyFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const distDir = path.resolve(__dirname, '..', 'dist');
const indexPath = path.join(distDir, 'index.html');
const notFoundPath = path.join(distDir, '404.html');

if (!existsSync(indexPath)) {
    console.error('[copy-spa-404] dist/index.html not found — run vite build first.');
    process.exit(1);
}

copyFileSync(indexPath, notFoundPath);
console.log('[copy-spa-404] dist/index.html → dist/404.html');
