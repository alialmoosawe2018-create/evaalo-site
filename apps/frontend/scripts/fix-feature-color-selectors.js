const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '../src/index.css');
let css = fs.readFileSync(cssPath, 'utf8');

// Undo accidental double suffixes from a bad repair pass.
css = css.replace(/\.icon-wrapper-inner \.icon-wrapper-inner/g, '.icon-wrapper-inner');
css = css.replace(/\.icon-wrapper-inner::before::before/g, '.icon-wrapper-inner::before');
css = css.replace(/nth-child\((\d+)\)\s{2,}/g, 'nth-child($1) ');

function addAttrMirror(selectorPrefix, suffix) {
    for (let n = 1; n <= 8; n += 1) {
        const nth = `${selectorPrefix}:nth-child(${n})${suffix}`;
        const attr = `${selectorPrefix}[data-feature-color="${n}"]${suffix}`;
        if (css.includes(nth) && !css.includes(attr)) {
            css = css.replace(nth, `${nth},\n${attr}`);
        }
    }
}

// Fix broken pairs where nth-child lost its suffix.
for (let n = 1; n <= 8; n += 1) {
    const pairs = [
        [' .icon-wrapper-inner::before', ' .icon-wrapper-inner::before'],
        [':hover .icon-wrapper-inner', ':hover .icon-wrapper-inner'],
        [' .icon-wrapper-inner', ' .icon-wrapper-inner'],
        [':hover', ':hover'],
    ];

    for (const [nthSuffix, attrSuffix] of pairs) {
        const brokenNth = `#features .simple-icon-wrapper:nth-child(${n}),`;
        const attrSelector = `#features .simple-icon-wrapper[data-feature-color="${n}"]${attrSuffix}`;

        if (!css.includes(`#features .simple-icon-wrapper:nth-child(${n})${nthSuffix}`)) {
            const re = new RegExp(
                `#features \\.simple-icon-wrapper:nth-child\\(${n}\\),\\s*\\n\\s*${attrSelector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
                'g'
            );
            css = css.replace(
                re,
                `#features .simple-icon-wrapper:nth-child(${n})${nthSuffix},\n${attrSelector}`
            );
        }
    }
}

// Wrapper-level rules (no suffix beyond optional :hover).
for (let n = 1; n <= 8; n += 1) {
    const re = new RegExp(
        `#features \\.simple-icon-wrapper:nth-child\\(${n}\\),\\s*\\n#features \\.simple-icon-wrapper\\[data-feature-color="${n}"\\](?!:)`,
        'g'
    );
    css = css.replace(
        re,
        `#features .simple-icon-wrapper:nth-child(${n}),\n#features .simple-icon-wrapper[data-feature-color="${n}"]`
    );
}

fs.writeFileSync(cssPath, css);
console.log('CSS selector repair complete');
