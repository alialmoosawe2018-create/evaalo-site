"""The silent wait is bounded.

When a turn is judged unfinished the agent stays silent (correct — a spoken nudge
interrupts). It used to stay silent with no end: a candidate who had actually
finished waited for a reply that never came. Now a timer replies after
INTERVIEW_WAIT_TIMEOUT_MS unless the candidate resumes (new turn cancels it) or is
audibly still speaking (re-arm, never talk over them).
"""

from __future__ import annotations

import asyncio

import pytest
from livekit.agents.llm import ChatContext, ChatMessage
from livekit.agents.llm.tool_context import StopResponse

from voice_interview.assistant import InterviewAssistant, TtsRouteContext


class _StubTts:
    def update_options(self, **kwargs):
        pass


class _StubSession:
    def __init__(self, user_state: str = "listening") -> None:
        self.user_state = user_state
        self.calls: list[dict] = []

    def generate_reply(self, **kw):
        self.calls.append(kw)
        return None


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
        bank_questions=["q"],
        bank_key="test",
        position="HR Generalist",
        candidate_gender="male",
        has_domain_guidance=True,
        domain_pack_key="generic",
    )


def _make_turn_wait(agent: InterviewAssistant, monkeypatch) -> None:
    monkeypatch.setattr(
        "voice_interview.assistant.analyze_user_answer",
        lambda *a, **k: {"is_incomplete_turn": True},
    )
    monkeypatch.setattr(agent, "_apply_entity_policy", lambda text, diag: diag)


async def _user_turn(agent: InterviewAssistant, text: str) -> None:
    with pytest.raises(StopResponse):
        await agent.on_user_turn_completed(
            ChatContext.empty(), ChatMessage(role="user", content=[text])
        )


def test_silent_wait_is_bounded(monkeypatch):
    agent = _assistant()
    _make_turn_wait(agent, monkeypatch)
    monkeypatch.setattr("voice_interview.assistant.interview_wait_timeout_ms", lambda: 20)
    sess = _StubSession()
    agent._session_for_wait = lambda: sess

    async def run() -> None:
        await _user_turn(agent, "اشتغلت في")
        assert agent._wait_timeout_task is not None
        await asyncio.sleep(0.2)

    asyncio.run(run())
    assert len(sess.calls) == 1
    instr = sess.calls[0]["instructions"]
    assert "Do not wait" in instr
    assert "ONE" in instr


def test_new_turn_cancels_pending_wait(monkeypatch):
    agent = _assistant()
    _make_turn_wait(agent, monkeypatch)
    monkeypatch.setattr("voice_interview.assistant.interview_wait_timeout_ms", lambda: 5000)
    sess = _StubSession()
    agent._session_for_wait = lambda: sess

    async def run() -> None:
        await _user_turn(agent, "اشتغلت في")
        first = agent._wait_timeout_task
        assert first is not None
        await _user_turn(agent, "و بعدين في")
        await asyncio.sleep(0.02)
        assert first.cancelled() or first.done()
        agent._cancel_wait_timeout()

    asyncio.run(run())
    assert sess.calls == []


def test_no_reply_while_candidate_is_speaking():
    agent = _assistant()
    sess = _StubSession(user_state="speaking")
    agent._session_for_wait = lambda: sess

    asyncio.run(agent._fire_wait_timeout(agent._memory.turn_index, 1))
    assert sess.calls == []


def test_stale_turn_index_does_not_reply():
    agent = _assistant()
    sess = _StubSession()
    agent._session_for_wait = lambda: sess

    asyncio.run(agent._fire_wait_timeout(agent._memory.turn_index + 1, 1))
    assert sess.calls == []


def test_timeout_disabled_arms_nothing(monkeypatch):
    agent = _assistant()
    _make_turn_wait(agent, monkeypatch)
    monkeypatch.setattr("voice_interview.assistant.interview_wait_timeout_ms", lambda: 0)

    async def run() -> None:
        await _user_turn(agent, "اشتغلت في")
        assert getattr(agent, "_wait_timeout_task", None) is None

    asyncio.run(run())


def test_recommended_question_is_offered_to_the_timeout_reply():
    agent = _assistant()
    agent._turn_recommended = "اذكرلي مثال عن حالة onboarding سويتها؟"
    instr = agent._wait_timeout_instructions()
    assert "onboarding" in instr
    assert "ONE question only" in instr
