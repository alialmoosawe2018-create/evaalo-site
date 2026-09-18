"""The greeting reaches the candidate as written.

Nobody had ever heard it. It was not lost — it was CONVERTED INTO A QUESTION,
in two steps, before it ever reached TTS. `session.say()` text flows through
tts_node like any reply, and at greeting time there is no turn plan, which every
guard reads as MODE_ASK:

    1. enforce_single_question_response sees an ASK turn with ZERO «؟» and
       applies its repair — strip the final «.», append «؟»:
           «حياك الله علي محمود، نبدأ من خبرتك العملية.»
         → «حياك الله علي محمود، نبدأ من خبرتك العملية؟»
    2. needs_framing() is now True for that line, so the framing guard sends it
       to the model and speaks the rewrite instead.

Proven on two live interviews on 2026-09-18, to the character:

    greeting 45 chars → LLM 24 tok → "reframed (reason=bare)" → TTS 78 chars
                                     → first transcript line = 78 chars
    greeting 43 chars → LLM 26 tok → "reframed (reason=bare)" → TTS 71 chars
                                     → first transcript line = 71 chars

No TTS ever carried the greeting's own 45/43 characters.

⚠️ A first reading blamed the framing guard alone. `needs_framing(greeting)` is
False — the greeting only becomes "bare" AFTER the question-mark repair invents a
question out of it. The tests below pin both steps, in order.
"""

from __future__ import annotations

import asyncio

from voice_interview.active_question import enforce_single_question_response
from voice_interview.assistant import InterviewAssistant, TtsRouteContext
from voice_interview.framing_guard import needs_framing
from voice_interview.worker import (
    _canned_initial_greeting,
    _greeting_question_matches_language,
)

GREETING = "حياك الله علي محمود، نبدأ من خبرتك العملية."
FIRST_Q = "شنو خبرتك بموضوع التوظيف، وشنو الطرق اللي استخدمتها لجذب المرشحين؟"


class _StubTts:
    def update_options(self, **kwargs):
        pass


def _assistant() -> InterviewAssistant:
    router = TtsRouteContext(
        _StubTts(),
        arabic_voice_id="ar",
        english_voice_id="en",
        supports_override=False,
        cooldown_ms=0,
        initial_voice_id="ar",
        initial_language="ar",
    )
    return InterviewAssistant(
        tts_router=router,
        bank_questions=[FIRST_Q],
        bank_key="test",
        position="Talent Acquisition Specialist",
        has_domain_guidance=True,
        domain_pack_key="generic",
    )


def _meta(**over) -> dict:
    m = {"candidate_name": "علي محمود", "position": "Talent Acquisition Specialist"}
    m.update(over)
    return m


# ── the guards no longer touch it ────────────────────────────────────────────


def test_the_two_step_chain_that_ate_the_greeting() -> None:
    """The premise, in order. Step 1 manufactures a question; step 2 rewrites it."""
    # the greeting on its own is NOT what the framing guard fires on…
    assert needs_framing(GREETING) is False
    # …but with no turn plan the repair reads the turn as ASK and adds a «؟»
    repaired = enforce_single_question_response(GREETING, None)
    assert repaired != GREETING
    assert repaired.endswith("؟")
    # …and THAT is bare, so the model is asked to rewrite it
    assert needs_framing(repaired) is True


def test_a_marked_line_survives_the_reply_guard() -> None:
    agent = _assistant()
    agent.mark_verbatim(GREETING)
    assert agent._apply_guard_to_agent_text(GREETING) == GREETING


def test_a_marked_line_is_never_reframed() -> None:
    """Defence in depth, exercised on a line the reframer WOULD rewrite.

    Asserting this with the greeting itself proved nothing: `needs_framing` is
    already False for it, so the reframer returns it untouched with or without the
    guard — the check was dead and a mutation of it stayed green. A short canned
    line that IS bare-question-shaped (a shape a future canned line may well have)
    is what actually exercises it.
    """
    bare_canned = "حياك الله، جاهز نبدأ؟"
    assert needs_framing(bare_canned) is True

    agent = _assistant()

    async def _fake(_text: str) -> str:
        return "REWRITTEN BY THE MODEL؟"

    agent._regenerate_framed_question = _fake

    # unmarked: the reframer rewrites it
    assert asyncio.run(agent.reframe_bare_question(bare_canned)) != bare_canned

    # marked: it survives
    fresh = _assistant()
    fresh._regenerate_framed_question = _fake
    fresh.mark_verbatim(bare_canned)
    assert asyncio.run(fresh.reframe_bare_question(bare_canned)) == bare_canned


def test_an_unmarked_greeting_is_still_destroyed() -> None:
    """Control: without the mark, the live chain still turns it into a question."""
    agent = _assistant()
    out = agent._apply_guard_to_agent_text(GREETING)
    assert out != GREETING
    assert out.endswith("؟")


def test_marking_a_different_line_does_not_protect_this_one() -> None:
    agent = _assistant()
    agent.mark_verbatim("شيء آخر تماماً.")
    assert agent._apply_guard_to_agent_text(GREETING) != GREETING


# ── …but only when it is in the session's language ───────────────────────────
#
# ⚠️ One interview after the greeting fix shipped, an Arabic session opened with:
#     «حياك الله Ali Mahmood، نبدأ من خبرتك العملية.
#      Describe how you balance employee experience, company policy, and
#      compliance in HR decisions.»
# and the candidate's first words were «بالعربي ممكن نحكي بالعربي». The bank is
# English for many roles; the old framing-guard rewrite used to mask that by
# regenerating everything in Arabic, and protecting the greeting removed the mask.

# Verbatim, from that interview (n8n execution 1907).
ENGLISH_BANK_Q = (
    "Describe how you balance employee experience, company policy, "
    "and compliance in HR decisions."
)
# Verbatim Arabic bank question carrying English terms — must still be kept.
MIXED_AR_Q = "شنو خبرتك بوضع خطة استقطاب لدور تقني صعب مثل Senior Software Engineer؟"


def _greeting_for(question: str, monkeypatch, **meta_over) -> str:
    monkeypatch.delenv("INTERVIEW_GREETING_WITH_QUESTION_V3", raising=False)
    monkeypatch.setattr(
        "voice_interview.worker.resolve_livekit_questions",
        lambda meta: type("B", (), {"questions": [question]})(),
    )
    return _canned_initial_greeting(_meta(**meta_over))


def test_an_english_bank_question_is_not_spoken_into_an_arabic_greeting(monkeypatch) -> None:
    text = _greeting_for(ENGLISH_BANK_Q, monkeypatch)
    assert "Describe how you balance" not in text
    assert "حياك الله" in text  # the welcome still goes out


def test_an_arabic_question_with_english_terms_is_still_kept(monkeypatch) -> None:
    """Code-switching is normal here — dropping these would gut the feature."""
    text = _greeting_for(MIXED_AR_Q, monkeypatch)
    assert MIXED_AR_Q in text


def test_the_language_check_is_what_decides() -> None:
    assert _greeting_question_matches_language(ENGLISH_BANK_Q, "ar") is False
    assert _greeting_question_matches_language(MIXED_AR_Q, "ar") is True
    assert _greeting_question_matches_language(ENGLISH_BANK_Q, "en") is True
    assert _greeting_question_matches_language(MIXED_AR_Q, "en") is False
    # ambiguous / too short is treated as a mismatch: a greeting alone is safer
    assert _greeting_question_matches_language("Hi?", "ar") is False
    assert _greeting_question_matches_language("", "ar") is False


def test_an_english_session_keeps_its_english_question(monkeypatch) -> None:
    text = _greeting_for(ENGLISH_BANK_Q, monkeypatch, language="en")
    assert ENGLISH_BANK_Q in text


# ── the greeting now carries the first question ──────────────────────────────


def test_the_greeting_keeps_its_welcome_and_adds_the_question(monkeypatch) -> None:
    """Both halves. The old code returned early and dropped «حياك الله» entirely."""
    monkeypatch.delenv("INTERVIEW_GREETING_WITH_QUESTION_V3", raising=False)
    monkeypatch.setattr(
        "voice_interview.worker.resolve_livekit_questions",
        lambda meta: type("B", (), {"questions": [FIRST_Q]})(),
    )
    text = _canned_initial_greeting(_meta())
    assert "حياك الله" in text
    assert "نبدأ من خبرتك العملية" in text
    assert FIRST_Q in text


def test_carrying_the_question_leaves_no_dead_air() -> None:
    """A greeting alone ends on a statement, and nothing else asks until the
    candidate speaks — so the opening must still contain a question."""
    assert needs_framing(f"{GREETING} {FIRST_Q}") is False
    assert f"{GREETING} {FIRST_Q}".count("؟") == 1


def test_the_legacy_stale_secret_is_not_consulted(monkeypatch) -> None:
    """INITIAL_GREETING_INCLUDE_FIRST_QUESTION is one of the 71 July secrets whose
    values cannot be read back — a default behind it is a default nobody controls."""
    monkeypatch.delenv("INTERVIEW_GREETING_WITH_QUESTION_V3", raising=False)
    monkeypatch.setenv("INITIAL_GREETING_INCLUDE_FIRST_QUESTION", "false")
    monkeypatch.setattr(
        "voice_interview.worker.resolve_livekit_questions",
        lambda meta: type("B", (), {"questions": [FIRST_Q]})(),
    )
    assert FIRST_Q in _canned_initial_greeting(_meta())


def test_the_new_key_can_still_turn_it_off(monkeypatch) -> None:
    monkeypatch.setenv("INTERVIEW_GREETING_WITH_QUESTION_V3", "false")
    monkeypatch.setattr(
        "voice_interview.worker.resolve_livekit_questions",
        lambda meta: type("B", (), {"questions": [FIRST_Q]})(),
    )
    text = _canned_initial_greeting(_meta())
    assert FIRST_Q not in text
    assert "حياك الله" in text
