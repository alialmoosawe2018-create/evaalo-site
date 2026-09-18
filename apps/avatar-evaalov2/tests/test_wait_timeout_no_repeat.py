"""The wait-timeout reply is a real turn, and it never re-asks.

Rebuilds execution 1903 (2026-09-17, the owner's own interview) turn for turn:

    23:30:54  the policy question goes out          mode=ask
    23:30:55  candidate starts answering → unfinished → silent wait
    23:31:07  "candidate still speaking after re-arms; not interrupting"
    23:31:13  silent again
    23:31:16  "wait_for_completion timed out → replying to what was said"
              ↳ the SAME question again, minus its «؟»

The cause is the turn plan: at timeout it still says MODE_WAIT, because it belongs
to the SILENT turn the timer was armed on. That makes
``_guard_repetition_and_language`` return on its first line (no duplicate check, no
bridge) and ``enforce_single_question_response`` strip the «؟». The repeat itself
comes from the model — its own previous question is in the chat context — and
nothing was left to stop it.

⚠️ A first reading blamed ``_turn_recommended`` for handing the spoken question
back. Replaying the turn sequence disproved that: on a wait turn that slot holds
the wait's own continuation nudge («أكيد، خذ راحتك وكمل فكرتك.»), which is not a
question at all — so the instructions were telling the model to "ask" a non-question.
Both hazards are guarded below, but the plan is what let the repeat out.

The owner asked for the MECHANISM, not the instance: these assert that any question
coming out of a timeout meets the duplicate bridge and lands on the subject ledger,
not merely that this one string did not come back.
"""

from __future__ import annotations

import asyncio

import pytest
from livekit.agents.llm import ChatContext, ChatMessage
from livekit.agents.llm.tool_context import StopResponse

from voice_interview.active_question import count_question_marks
from voice_interview.assistant import InterviewAssistant, TtsRouteContext
from voice_interview.subject_coverage import ASKED

# Verbatim agent turn 3 from that interview — the one that came back as turn 4.
REAL_QUESTION = (
    "أريد أفهم شلون تتعامل وية السياسات المكتوبة بشغلك. أقصد مثلاً لو طلب مدير "
    "إجازة لموظف بشكل يتجاوز سياسة الحضور، شنو كانت الحالة وشنو سويت بيها؟"
)
# A fresh bank anchor exists, so the duplicate guard has somewhere to bridge to.
OTHER_Q = "شلون تتعامل وية سرية معلومات المرشحين الحساسة؟"


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
        bank_questions=[REAL_QUESTION, OTHER_Q],
        bank_key="test",
        position="Senior HR Generalist",
        has_domain_guidance=True,
        domain_pack_key="generic",
    )


def _ask(agent: InterviewAssistant, question: str) -> None:
    """Send a question the way a real ASK turn does."""
    agent._set_turn_recommendation(question, source="bank")
    agent.record_agent_reply(question)


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


def _replay_1903(monkeypatch) -> tuple[InterviewAssistant, _StubSession]:
    """ASK → candidate starts answering → silent wait → timeout fires."""
    agent = _assistant()
    _ask(agent, REAL_QUESTION)
    _make_turn_wait(agent, monkeypatch)
    monkeypatch.setattr("voice_interview.assistant.interview_wait_timeout_ms", lambda: 20)
    sess = _StubSession()
    agent._session_for_wait = lambda: sess

    async def run() -> None:
        await _user_turn(agent, "يعني مثلا مرة من المرات صارت شغلة انه طلب مدير المشروع انه ينهي")
        await asyncio.sleep(0.2)

    asyncio.run(run())
    assert len(sess.calls) == 1, "the timeout must have fired exactly once"
    return agent, sess


# ── the instruction never offers something that is not a fresh question ──────


def test_the_wait_nudge_is_not_offered_as_a_question(monkeypatch) -> None:
    """What actually sits in ``_turn_recommended`` at timeout: «خذ راحتك وكمل فكرتك»."""
    agent, sess = _replay_1903(monkeypatch)
    assert agent._turn_recommended and count_question_marks(agent._turn_recommended) == 0
    instr = sess.calls[0]["instructions"]
    assert "ask the recommended question" not in instr
    assert "خذ راحتك" not in instr
    assert "Do NOT repeat any question you have already asked" in instr


def test_a_question_that_was_already_spoken_is_not_offered_back() -> None:
    agent = _assistant()
    _ask(agent, REAL_QUESTION)
    agent._turn_recommended = REAL_QUESTION
    assert agent._wait_timeout_recommendation() == ""


def test_a_paraphrase_of_the_spoken_question_is_caught_too() -> None:
    """Not a string match — the same notion of "same question" used everywhere."""
    agent = _assistant()
    _ask(agent, REAL_QUESTION)
    agent._turn_recommended = (
        "شلون تتعامل وية السياسات المكتوبة بشغلك لو طلب مدير إجازة تتجاوز سياسة الحضور؟"
    )
    assert agent._wait_timeout_recommendation() == ""


# ── the reply runs as a real turn, not under the stale WAIT plan ─────────────


def test_the_stale_wait_plan_is_cleared_before_the_reply(monkeypatch) -> None:
    agent, _sess = _replay_1903(monkeypatch)
    assert agent._turn_plan is None


def test_the_question_mark_survives(monkeypatch) -> None:
    """MODE_WAIT strips «؟». The transcript's tell-tale was a question without one."""
    agent, _sess = _replay_1903(monkeypatch)
    out = agent._apply_guard_to_agent_text("زين. وشنو كانت أول خطوة سويتها بالتحديد؟")
    assert count_question_marks(out) == 1


def test_a_repeat_that_slips_through_anyway_is_bridged(monkeypatch) -> None:
    """The MECHANISM: even if the model returns the old question, the guard bridges."""
    agent, _sess = _replay_1903(monkeypatch)
    out = agent._apply_guard_to_agent_text(REAL_QUESTION)
    assert out.strip() != REAL_QUESTION.strip()
    assert "السياسات المكتوبة" not in out


def test_the_timeout_question_lands_on_the_subject_ledger(monkeypatch) -> None:
    """A question asked from the timeout counts for coverage like any other."""
    agent, _sess = _replay_1903(monkeypatch)
    fresh = "شلون تتعامل وية سرية معلومات المرشحين الحساسة؟"
    agent.record_agent_reply(fresh)

    cov = agent._memory.subject_coverage
    subject = cov.resolve(fresh)
    assert subject, "the timeout reply must be registered as a subject"
    assert cov.states[subject] == ASKED
    assert cov.ask_counts[subject] == 1


# ── negative control: a recommendation never spoken is still offered ─────────


def test_an_unspoken_recommendation_is_still_offered() -> None:
    agent = _assistant()
    agent._turn_recommended = "اذكرلي مثال عن حالة onboarding سويتها؟"
    instr = agent._wait_timeout_instructions()
    assert "onboarding" in instr
    assert "ONE question only" in instr
