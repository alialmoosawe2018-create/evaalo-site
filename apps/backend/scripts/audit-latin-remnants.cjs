const fs = require('node:fs');
const path = require('node:path');

const ar = JSON.parse(fs.readFileSync(path.join(__dirname, '../../frontend/src/constants/positionLabels.ar.json'), 'utf8'));
const ku = JSON.parse(fs.readFileSync(path.join(__dirname, '../../frontend/src/constants/positionLabels.ku.json'), 'utf8'));

const re = /[A-Za-z][A-Za-z0-9&/\-]*/g;
const words = new Map();

function scan(obj, lang) {
    for (const [k, v] of Object.entries(obj)) {
        if (!k.includes('.') && k !== v) continue;
        if (!k.includes('.')) continue;
        if (typeof v !== 'string') continue;
        for (const m of v.matchAll(re)) {
            const w = m[0];
            words.set(w, (words.get(w) || 0) + 1);
        }
    }
}

scan(ar, 'ar');
scan(ku, 'ku');

console.log('Top remaining Latin words:');
console.log([...words.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50).map(([w, c]) => `${w}:${c}`).join('\n'));

const arHits = Object.entries(ar).filter(([k, v]) => k.includes('.') && typeof v === 'string' && re.test(v));
console.log('\nSample AR with Latin (' + arHits.length + '):');
for (const [k, v] of arHits.slice(0, 20)) console.log(k, '=>', v);
