const fs = require('node:fs');
const path = require('node:path');
const tokens = require('./kuEnglishTokens.cjs');

const kuPath = path.join(__dirname, '../../frontend/src/constants/positionLabels.ku.json');
const ku = JSON.parse(fs.readFileSync(kuPath, 'utf8'));

const re = /[A-Za-z][A-Za-z0-9&/\-]*/g;
const keys = Object.keys(tokens).sort((a, b) => b.length - a.length);

function polish(text) {
    if (!text || typeof text !== 'string') return text;
    let result = text;
    for (let pass = 0; pass < 4; pass++) {
        let before = result;
        for (const key of keys) {
            if (result.includes(key)) result = result.split(key).join(tokens[key]);
        }
        result = result.replace(re, (word) => tokens[word] ?? word);
        if (result === before) break;
    }
    return result.replace(/\s+/g, ' ').trim();
}

let updated = 0;
for (const [key, value] of Object.entries(ku)) {
    if (typeof value !== 'string') continue;
    const next = polish(value);
    if (next !== value) {
        ku[key] = next;
        updated++;
    }
}

const sorted = Object.fromEntries(Object.entries(ku).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(kuPath, `${JSON.stringify(sorted, null, 4)}\n`, 'utf8');

let latin = 0;
for (const v of Object.values(ku)) {
    if (typeof v === 'string' && re.test(v)) latin++;
}
re.lastIndex = 0;
console.log(`Polished ${updated} KU labels. Remaining with Latin: ${latin}`);
