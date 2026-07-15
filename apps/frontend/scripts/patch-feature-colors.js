const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '../src/index.css');
let css = fs.readFileSync(cssPath, 'utf8');

for (let n = 8; n >= 1; n -= 1) {
    const attr = `[data-feature-color="${n}"]`;
    const pattern = new RegExp(`#features \\.simple-icon-wrapper:nth-child\\(${n}\\)(?!\\d)`, 'g');
    css = css.replace(
        pattern,
        `#features .simple-icon-wrapper:nth-child(${n}),\n#features .simple-icon-wrapper${attr}`
    );
}

fs.writeFileSync(cssPath, css);
console.log('Patched feature color selectors in index.css');
