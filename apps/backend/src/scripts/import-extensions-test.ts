/**
 * import-extensions-test
 *
 * WHY THIS EXISTS. On 2026-09-28 a new service was added with
 * `import X from '../models/HeadHunterCandidate'` — no `.js`. It was the only
 * extensionless relative import in the backend, and it is invisible to every gate
 * we had:
 *
 *   tsconfig has "moduleResolution": "node"  ->  `tsc --noEmit` passes
 *   "dev": "tsx watch src/server.ts"         ->  local dev passes
 *   "build": tsc                             ->  the build passes
 *   package.json has "type": "module"        ->  Node's ESM loader REFUSES it
 *
 * So `npm run build` is green and `node dist/server.js` dies with
 * ERR_MODULE_NOT_FOUND. Because the offending module is imported transitively by
 * server.ts, the failure is not a broken route — it is a backend that will not
 * boot at all, discovered only in production.
 *
 * This suite is the cheap gate that closes that hole for every future file.
 *
 * Run: npm run test:import-extensions
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Relative specifiers only — bare package names are resolved by Node, not by path. */
const RELATIVE_IMPORT = /(?:^|[\s;])(?:import|export)\b[^'"\n]*?from\s*['"](\.[^'"]*)['"]/g;
const BARE_SIDE_EFFECT = /(?:^|[\s;])import\s*['"](\.[^'"]*)['"]/g;
/** A specifier is fine if it names a file Node can resolve without guessing. */
const ALLOWED_SUFFIX = /\.(js|json|mjs|cjs|node|css)$/;

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist') continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(name)) out.push(full);
    }
    return out;
}

function main(): void {
    const files = walk(SRC);
    const offenders: string[] = [];

    for (const file of files) {
        // Read as utf8 but skip anything that is not really text: one template file
        // in this tree is stored with a binary-looking encoding and would otherwise
        // produce phantom matches.
        const raw = readFileSync(file);
        if (raw.includes(0)) continue;
        const text = raw.toString('utf8');
        for (const re of [RELATIVE_IMPORT, BARE_SIDE_EFFECT]) {
            re.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = re.exec(text)) !== null) {
                const spec = m[1];
                if (ALLOWED_SUFFIX.test(spec)) continue;
                const line = text.slice(0, m.index).split('\n').length;
                offenders.push(`${relative(SRC, file).replace(/\\/g, '/')}:${line}  ->  '${spec}'`);
            }
        }
    }

    console.log('='.repeat(80));
    console.log(`relative imports checked across ${files.length} TypeScript files`);
    console.log('='.repeat(80));

    if (offenders.length === 0) {
        console.log('\nPASS — every relative import carries an explicit extension.');
        console.log('(This project is ESM: "type": "module" + Node\'s loader require it,');
        console.log(' while tsc\'s "moduleResolution": "node" does not. Only this gate catches it.)');
        return;
    }

    console.log(`\nFAIL — ${offenders.length} relative import(s) would fail at runtime under Node ESM:\n`);
    for (const o of offenders) console.log(`  ${o}`);
    console.log('\nAdd the ".js" extension (yes, ".js" even in a .ts file — it names the EMITTED file).');
    process.exit(1);
}

main();
