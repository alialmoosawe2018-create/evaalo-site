/**
 * The audio format the LIVE voice interview actually requests from ElevenLabs.
 *
 * Why this file exists: `textToSpeechWithTimestamps` had `mp3_22050_32` hardcoded
 * into its URL — 32 kbps MP3 with a ~11 kHz ceiling, the worst format ElevenLabs
 * offers — and it is the path the voice interview really runs on
 * (`voiceSessionCore` picks it whenever `voiceTiming.useTtsTimestamps`, which is
 * on unless VOICE_TTS_USE_TIMESTAMPS is explicitly "false"/"0").
 *
 * Unlike the video agent, nothing re-encodes this: the MP3 goes straight to the
 * browser, so the candidate hears the 32 kbps artefacts as they are. The owner
 * reported the agent sounding weak, and a band-limited signal reads as quieter at
 * the same dBFS.
 *
 * The container stays MP3 on purpose — the browser plays the chunks through
 * MediaSource as 'audio/mpeg' (useVoiceInterview.js), so mp3_44100_128 is a
 * drop-in and PCM would not be.
 *
 * axios is stubbed, so this makes no network call and needs no database.
 *
 * Run: npm run test:voice-tts-output-format
 */
import assert from 'node:assert/strict';
import axios from 'axios';

process.env.ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || 'test-key';

const { textToSpeechWithTimestamps } = await import('../services/ttsService.js');

let failures = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
    return Promise.resolve()
        .then(fn)
        .then(() => console.log(`ok   ${name}`))
        .catch((err) => {
            failures += 1;
            console.error(`FAIL ${name}\n     ${(err as Error).message}`);
        });
}

/** Captures the URL axios.post is called with, then aborts the request. */
async function capturePostUrl(): Promise<string> {
    const original = axios.post;
    let seen = '';
    (axios as unknown as { post: unknown }).post = async (url: string) => {
        seen = url;
        throw new Error('stubbed — url captured');
    };
    try {
        await textToSpeechWithTimestamps('مرحبا، نبدأ المقابلة.', 'ar', () => {});
    } catch {
        /* expected: the stub throws once the URL is recorded */
    } finally {
        (axios as unknown as { post: unknown }).post = original;
    }
    return seen;
}

await check('the live path no longer requests 32 kbps / 22.05 kHz', async () => {
    const url = await capturePostUrl();
    assert.ok(url, 'axios.post was never called — the stub did not run');
    assert.ok(!url.includes('mp3_22050_32'), `still on the worst format: ${url}`);
});

await check('it requests mp3_44100_128 by default', async () => {
    const url = await capturePostUrl();
    assert.ok(
        url.includes('output_format=mp3_44100_128'),
        `expected output_format=mp3_44100_128 in: ${url}`
    );
});

await check('the container stays MP3 — the browser decodes audio/mpeg', async () => {
    const url = await capturePostUrl();
    const format = /output_format=([^&]+)/.exec(url)?.[1] ?? '';
    assert.ok(format.startsWith('mp3'), `PCM/opus would break MediaSource playback: ${format}`);
});

await check('an env override reaches the request', async () => {
    process.env.VOICE_TTS_OUTPUT_FORMAT = 'mp3_44100_192';
    try {
        const url = await capturePostUrl();
        assert.ok(url.includes('output_format=mp3_44100_192'), url);
    } finally {
        delete process.env.VOICE_TTS_OUTPUT_FORMAT;
    }
});

if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
}
console.log('\nAll voice TTS output-format checks passed.');
