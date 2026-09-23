"""The agent speaks the language the backend sends — never its env default.

A data-flow test, not a line-order test, and that is the whole point. On the
voice side a test asserting "resolution happens before the greeting" stayed green
while the greeting read the raw variable and came out in English before an Arabic
interview (fixed in 4475f69 before a candidate hit it). Ordering proves nothing;
only feeding the real inputs and reading the real outputs does.

The contract being pinned (owner, 2026-09-23): the CAMPAIGN decides the interview
language. The backend resolves it and now sends ``metadata.language``
UNCONDITIONALLY at /prepare and /start. That matters because
``session_language()`` falls back to the ``INITIAL_GREETING_LANGUAGE`` secret only
when the key is ABSENT — and on production that secret is not Arabic, which is
exactly how an Arabic interview opened with "Hello … let's begin."

So every test here sets that env var to the WRONG language on purpose. If the
metadata ever stops winning, the greeting follows the env and the test goes red.
"""

from __future__ import annotations

import pytest

from voice_interview.worker import _greeting_mode, session_language


@pytest.fixture
def hostile_env(monkeypatch):
    """The production shape: an env default that disagrees with the campaign."""
    monkeypatch.setenv("INITIAL_GREETING_LANGUAGE", "en")
    return monkeypatch


@pytest.mark.parametrize("sent", ["ar", "en"])
def test_the_language_the_backend_sends_is_the_language_the_agent_locks(
    hostile_env, sent
):
    meta = {"language": sent, "candidate_name": "علي"}
    assert session_language(meta) == sent


@pytest.mark.parametrize("sent", ["ar", "en"])
def test_the_greeting_follows_the_metadata_not_the_env(hostile_env, sent):
    """The exact failure: greeting mode read from the env instead of the campaign."""
    meta = {"language": sent}
    assert _greeting_mode(meta) == sent


def test_an_arabic_campaign_is_greeted_in_arabic_even_with_an_english_env(hostile_env):
    """The 2026-09-18 incident, reproduced as a test: env says English, campaign
    says Arabic. The candidate must be greeted in Arabic."""
    assert _greeting_mode({"language": "ar"}) == "ar"


def test_kurdish_is_served_by_the_arabic_voice(hostile_env):
    """There is no Kurdish voice or STT; the bilingual Arabic voice serves it."""
    assert session_language({"language": "ku"}) == "ar"
    assert _greeting_mode({"language": "ku"}) == "ar"


def test_an_absent_key_is_the_only_road_to_the_env_default(hostile_env):
    """Documents WHY the backend must send the key unconditionally.

    With no ``language`` in the metadata the agent falls to the env default. The
    backend now always sends a concrete value, so this road is unreachable from
    /prepare and /start — but it still exists here, and this test keeps it
    visible rather than letting anyone assume the agent defaults to Arabic.
    """
    assert session_language({}) is None
    assert _greeting_mode({}) == "en", (
        "with the key absent the agent follows the env — this is the hole the "
        "backend closes by always sending the language"
    )


def test_an_unrecognised_value_does_not_silently_become_arabic(hostile_env):
    """Garbage is 'not said', which is different from Arabic — it falls to env.
    The backend only ever sends 'ar' or 'en', so this is a guard, not a path."""
    assert session_language({"language": "fr"}) is None
