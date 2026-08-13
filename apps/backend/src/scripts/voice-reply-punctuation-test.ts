/**
 * Regression: a lone "؟" left mid-sentence by the model must never reach TTS.
 *
 * Fixtures are verbatim agent turns from production — session 83fb17e7 opened
 * with "طيب، ؟ تگدر تحچيلي…" (2026-08-13) and session 86a64336 had the same
 * shape a day earlier. Spoken aloud the stray mark becomes an odd pause in the
 * middle of the question, so it must be stripped while the real question mark
 * at the end survives.
 *
 * Run: npx tsx src/scripts/voice-reply-punctuation-test.ts
 */
import { polishVoiceArabicReply } from '../services/llmService.js';

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

/** A question mark with more words after it is an orphan, not a sentence end. */
const ORPHAN = /[؟?]\s+\S/;

const mustStrip = [
    'طيب، ؟ تگدر تحچيلي عن خبراتك السابقة بالعمل؟',
    'حلو، ؟ تگدر تحچيلي عن مستواك ببرامج مايكروسوفت أوفيس، وأي برنامج تعتقد هو الأكثر فائدة؟',
    'Alright, ? can you tell me about your previous role?',
];

const mustKeep = [
    'ممتاز، شنو هواياتك أو اهتماماتك خارج العمل؟',
    'هسة راح أختبر لغتك الإنكليزية. جاهز؟',
    'What tools or technologies do you find essential for your productivity?',
];

let failures = 0;

for (const input of mustStrip) {
    const out = polishVoiceArabicReply(input);
    try {
        assert(!ORPHAN.test(out), `orphan mark survived: "${out}"`);
        assert(/[؟?]\s*$/.test(out), `question mark lost from the end: "${out}"`);
        const tail = input.replace(/^\S+[،,]\s*[؟?]\s*/, '').trim();
        assert(out.includes(tail.slice(0, 20)), `question text was altered: "${out}"`);
        console.log(`ok   strip → ${out}`);
    } catch (err: any) {
        failures += 1;
        console.error(`FAIL strip → ${err.message}`);
    }
}

for (const input of mustKeep) {
    const out = polishVoiceArabicReply(input);
    if (out === input) {
        console.log(`ok   keep  → ${out}`);
    } else {
        failures += 1;
        console.error(`FAIL keep  → expected unchanged\n  in:  ${input}\n  out: ${out}`);
    }
}

if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
}
console.log('\nall punctuation cases passed');
