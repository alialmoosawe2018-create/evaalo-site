"""The TTS format the video interview actually runs on.

The plugin's own default is ``mp3_22050_32`` — 32 kbps MP3, ~11 kHz ceiling, the
worst format ElevenLabs offers — and we were on it simply because ``encoding``
was never passed. These assert the new default reaches the built plugin, not
just our intent, and that the agent→avatar hop carries the higher rate.
"""

from __future__ import annotations

import pytest

from voice_interview.factories import (
    _ELEVENLABS_DEFAULT_OUTPUT_FORMAT,
    _elevenlabs_output_format,
    create_elevenlabs_tts,
)


@pytest.fixture(autouse=True)
def _keys(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-key")
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "test-voice")
    monkeypatch.delenv("ELEVENLABS_OUTPUT_FORMAT", raising=False)


def test_the_default_is_pcm_24000_not_the_plugin_default() -> None:
    assert _ELEVENLABS_DEFAULT_OUTPUT_FORMAT == "pcm_24000"
    assert _elevenlabs_output_format() == "pcm_24000"


def test_the_built_plugin_really_carries_it() -> None:
    """Read it back off the TTS object — this is what production runs."""
    tts, _voice, _lang, _override = create_elevenlabs_tts()
    assert tts._opts.encoding == "pcm_24000"
    # 24 kHz PCM, so the raw frames handed to the Beyond avatar are 24 kHz too.
    assert tts.sample_rate == 24000
    assert tts.num_channels == 1


def test_the_old_mp3_default_can_never_come_back_silently() -> None:
    tts, _v, _l, _o = create_elevenlabs_tts()
    assert tts._opts.encoding != "mp3_22050_32"
    assert tts.sample_rate > 22050


def test_env_can_override_to_any_supported_format(monkeypatch: pytest.MonkeyPatch) -> None:
    """pcm_44100 is one env var away — the owner's plan allows it."""
    monkeypatch.setenv("ELEVENLABS_OUTPUT_FORMAT", "pcm_44100")
    assert _elevenlabs_output_format() == "pcm_44100"
    tts, _v, _l, _o = create_elevenlabs_tts()
    assert tts.sample_rate == 44100


def test_a_typo_falls_back_instead_of_reaching_elevenlabs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An invalid value would go out as an ``output_format`` query param and 400."""
    monkeypatch.setenv("ELEVENLABS_OUTPUT_FORMAT", "pcm_2400")  # missing a zero
    assert _elevenlabs_output_format() == "pcm_24000"


def test_case_and_whitespace_are_tolerated(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ELEVENLABS_OUTPUT_FORMAT", "  PCM_16000 ")
    assert _elevenlabs_output_format() == "pcm_16000"
