import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Deliberately narrow: this gate exists to catch BUGS, not to enforce style.
 *
 * The codebase is ~256 files written without a linter, so turning on the full
 * recommended set (or exhaustive-deps) would bury real findings under hundreds of
 * pre-existing style warnings and the gate would just get ignored. Only rules that
 * indicate an actual defect are errors here; style stays out of it entirely.
 */
export default [
    {
        ignores: ['dist/**', 'node_modules/**', 'public/**', '*.config.js'],
    },
    {
        // AudioWorklet code runs in the worklet scope, not the window scope.
        files: ['src/audio-processor.js'],
        languageOptions: {
            globals: { AudioWorkletProcessor: 'readonly', registerProcessor: 'readonly', sampleRate: 'readonly', currentTime: 'readonly' },
        },
    },
    {
        files: ['src/**/*.{js,jsx}'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.es2021,
                // Vite statically replaces process.env.NODE_ENV at build time
                // (verified: it does not appear in the bundle), so it is not a
                // runtime reference.
                process: 'readonly',
            },
            parserOptions: {
                ecmaFeatures: { jsx: true },
            },
        },
        plugins: { 'react-hooks': reactHooks },
        rules: {
            // Real defects only.
            'no-undef': 'error',                    // typo'd identifier / missing import
            'no-dupe-keys': 'error',                // a duplicated translation key silently wins
            'no-dupe-class-members': 'error',
            'no-unreachable': 'error',
            'no-cond-assign': 'error',
            'no-constant-condition': ['error', { checkLoops: false }],
            'no-self-compare': 'error',
            'no-unsafe-negation': 'error',
            'valid-typeof': 'error',
            'use-isnan': 'error',
            'no-func-assign': 'error',
            'no-import-assign': 'error',
            'no-obj-calls': 'error',
            'no-sparse-arrays': 'error',
            'require-atomic-updates': 'off',

            // Hook order bugs break rendering; dependency completeness does not, so
            // only the former is a gate.
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'off',

            // Signal, not a gate: often a leftover, sometimes a real typo.
            'no-unused-vars': ['warn', {
                args: 'none',
                varsIgnorePattern: '^_',
                ignoreRestSiblings: true,
            }],
        },
    },
];
