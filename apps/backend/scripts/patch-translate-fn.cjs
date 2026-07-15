const fs = require('node:fs');
const p = 'src/scripts/jobCatalogI18nEngine.ts';
let s = fs.readFileSync(p, 'utf8');
const start = s.indexOf('export function translateDisplayTitle');
const end = s.indexOf('export function seedMemoryFromLabels');
const repl = `function finalizeTranslation(title: string, lang: Lang, memory: Map<string, string>, raw: string): string {
    const polished = polishTranslation(raw, lang, phraseDict(lang));
    memory.set(\`\${lang}:\${title}\`, polished);
    return polished;
}

export function translateDisplayTitle(
    title: string,
    lang: Lang,
    memory: Map<string, string>
): string {
    const cached = memory.get(\`\${lang}:\${title}\`);
    if (cached) return cached;

    for (const rule of RULES) {
        const m = title.match(rule.re);
        if (m) {
            const tr = (s: string) => translateDisplayTitle(s, lang, memory);
            const result = rule.build(m, tr, lang);
            return finalizeTranslation(title, lang, memory, result);
        }
    }

    const viaPhrase = translatePhraseChunk(title, lang);
    return finalizeTranslation(title, lang, memory, viaPhrase);
}

`;
s = s.slice(0, start) + repl + s.slice(end);
fs.writeFileSync(p, s);
console.log('Updated translateDisplayTitle');
