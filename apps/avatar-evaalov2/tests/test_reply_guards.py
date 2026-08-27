"""Regression tests for the video-agent reply guards.

Two defects seen in a real ``video_interview`` transcript:
  * near-duplicate consecutive questions (the exact-match loop guard missed a
    reworded repeat — e.g. the same line with a trailing "؟", or a shorter
    question fully contained in an earlier longer one);
  * a malformed hybrid Latin+Arabic token ("motivatesك") the model produced
    while phrasing an Arabic question.

These cover the pure detectors that the guard in ``assistant`` relies on.
"""

from __future__ import annotations

import asyncio

import pytest
from livekit.agents.llm import ChatContext, ChatMessage
from livekit.agents.llm.tool_context import StopResponse

from voice_interview.active_question import (
    MODE_ASK,
    MODE_FOLLOW_UP,
    MODE_RESUME,
    TurnPlan,
    enforce_single_question_response,
)
from voice_interview.assistant import InterviewAssistant, TtsRouteContext
from voice_interview.heuristics import (
    classify_interview_topic,
    is_semantic_duplicate_question,
    is_topic_repeat,
)
from voice_interview.lang import contains_hybrid_latin_arabic_token


class _StubTts:
    def update_options(self, **kwargs):  # noqa: ANN003
        pass


def _assistant(bank: list[str]) -> InterviewAssistant:
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
        bank_questions=bank,
        bank_key="test",
        position="HR Recruiter",
        candidate_gender="female",
        has_domain_guidance=True,
        domain_pack_key="hr_recruiter",
    )


# --- hybrid Latin+Arabic token ------------------------------------------------
def test_hybrid_detects_glued_token():
    assert contains_hybrid_latin_arabic_token("شنو الشي اللي motivatesك بهذا الدور؟") is True


def test_hybrid_ignores_spaced_loanwords():
    assert contains_hybrid_latin_arabic_token("عندك خبرة في HR و Excel؟") is False
    assert contains_hybrid_latin_arabic_token("اشتغلت كـ human resources officer") is False


def test_hybrid_ignores_pure_arabic_or_english():
    assert contains_hybrid_latin_arabic_token("شنو خبرتك بالعمل؟") is False
    assert contains_hybrid_latin_arabic_token("What motivates you in this role?") is False
    assert contains_hybrid_latin_arabic_token("") is False


# --- semantic duplicate question ---------------------------------------------
def test_dup_verbatim_only_punctuation_differs():
    # AGENT13 vs AGENT14 in the real transcript (only a trailing "؟" differs).
    prev = ["شلون تقرر شنو الأولويات لما تكون الأهداف متعارضة"]
    assert (
        is_semantic_duplicate_question(
            "شلون تقرر شنو الأولويات لما تكون الأهداف متعارضة؟", prev
        )
        is True
    )


def test_dup_short_question_contained_in_longer_earlier_one():
    # AGENT6 is AGENT5 minus its opener.
    prev = [
        "جيد، هسه احچيلي عن نتيجة حققتها في عملك السابق كانت مهمة للمعنيين، "
        "وشنو الطريقة اللي قست بيها نجاحها؟"
    ]
    assert (
        is_semantic_duplicate_question(
            "شنو نتيجة حققتها في عملك السابق كانت مهمة للمعنيين، "
            "وشنو الطريقة اللي قست بيها نجاحها؟",
            prev,
        )
        is True
    )


def test_not_duplicate_for_distinct_topics():
    prev = ["شنو الشي اللي يحمّسك لهذا الدور بالذات؟"]
    assert (
        is_semantic_duplicate_question(
            "احچيلي عن موقف واجهت بيه ضغط شديد وشلون تعاملت وياه؟", prev
        )
        is False
    )


def test_not_duplicate_with_empty_history():
    assert is_semantic_duplicate_question("شنو خبرتك في الموارد البشرية؟", []) is False


def test_framing_only_question_is_never_duplicate():
    # A bare framing shell with no topical tokens must not match anything.
    prev = ["شنو رأيك بالموضوع؟"]
    assert is_semantic_duplicate_question("شلون؟", prev) is False


# --- give the question room: keep the framing sentence, drop extra questions ---
def test_ask_preserves_leading_context_sentence():
    plan = TurnPlan(question="شنو الأدوات اللي استخدمتها؟", response_mode="ask")
    raw = "بخصوص تنظيم ملفات الموظفين. شنو الأدوات اللي استخدمتها؟ وشلون رتبتها؟"
    out = enforce_single_question_response(raw, plan)
    assert out.count("؟") == 1  # single question kept
    assert "بخصوص تنظيم ملفات الموظفين" in out  # framing context preserved
    assert "رتبتها" not in out  # trailing extra question dropped


def test_ask_double_question_without_context_still_single():
    plan = TurnPlan(question="شنو المؤشر الأهم عندكم؟", response_mode="ask")
    raw = "شلون تقيّم القناة؟ وشلون تتابع بعد المقابلة؟"
    out = enforce_single_question_response(raw, plan)
    assert out.count("؟") == 1
    assert "بعد المقابلة" not in out


# --- the widened repetition guard (resume/topic-change is deduped) -------------
def test_guard_replaces_resume_duplicate_with_fresh_anchor():
    fresh = "شنو قنوات الاستقطاب اللي تعتمد عليها بالتوظيف؟"
    agent = _assistant([fresh])
    dup = "شنو المؤشر الأهم اللي تتابعه بعملية التوظيف؟"
    agent._memory.asked_questions.append(dup)
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_RESUME)
    out = agent._guard_repetition_and_language(dup)
    assert out != dup  # duplicate on a topic-change turn was replaced
    assert "قنوات الاستقطاب" in out  # replaced with the fresh bank anchor


def test_guard_keeps_followup_even_if_similar_to_recent():
    agent = _assistant(["شنو قنوات الاستقطاب اللي تعتمد عليها؟"])
    active = "شنو المؤشر الأهم اللي تتابعه بعملية التوظيف؟"
    agent._memory.asked_questions.append(active)
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_FOLLOW_UP)
    # A follow-up intentionally echoes the active question — must NOT be replaced.
    out = agent._guard_repetition_and_language(active)
    assert out == active


# --- topic-level dedup: catches paraphrased repeats (different words, same topic)
def test_topic_classifier_prioritization_paraphrases():
    # AGENT6 vs AGENT16 in the real transcript — different wording, same topic.
    assert (
        classify_interview_topic("شلون تقرر شنو الأولويات لما تكون الأهداف متعارضة؟")
        == "prioritization"
    )
    assert (
        classify_interview_topic("شلون تتعامل مع حالات عدم اليقين أو أولويات متنافسة؟")
        == "prioritization"
    )


def test_topic_classifier_none_for_unrelated_or_generic():
    assert classify_interview_topic("احچيلي عن نفسك بشكل مختصر؟") is None
    assert classify_interview_topic("شلون كان يومك؟") is None


def test_topic_repeat_catches_paraphrase_but_not_new_topic():
    prev = ["شلون تقرر شنو الأولويات لما تكون الأهداف متعارضة؟"]
    assert is_topic_repeat("شلون تتعامل مع عدم اليقين أو أولويات متنافسة؟", prev) is True
    assert is_topic_repeat("شنو قنوات الاستقطاب اللي تعتمد عليها؟", prev) is False


def test_guard_replaces_paraphrased_topic_repeat_with_fresh_anchor():
    fresh = "شنو قنوات الاستقطاب اللي تعتمد عليها بالتوظيف؟"  # sourcing topic
    agent = _assistant([fresh])
    agent._memory.asked_questions.append(
        "شلون تقرر شنو الأولويات لما تكون الأهداف متعارضة؟"  # prioritization
    )
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_RESUME)
    paraphrase = "شلون تتعامل مع عدم اليقين أو أولويات متنافسة بالعمل؟"  # same topic, new words
    out = agent._guard_repetition_and_language(paraphrase)
    assert out != paraphrase  # paraphrased same-topic repeat was replaced
    assert "قنوات الاستقطاب" in out  # with the fresh, different-topic anchor


# --- bank exhausted: wrap up instead of repeating -----------------------------
def test_guard_offers_wrapup_when_no_fresh_anchor_left():
    agent = _assistant([])  # empty bank → no fresh anchor available
    dup = "شنو قنوات الاستقطاب اللي تعتمد عليها بالتوظيف؟"
    agent._memory.asked_questions.extend([f"سؤال سابق رقم {i}؟" for i in range(9)] + [dup])
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_RESUME)
    out = agent._guard_repetition_and_language(dup)
    assert "نختم" in out  # a graceful wrap-up, not the repeat
    assert agent._memory.wrap_up_offered is True


def test_guard_wrapup_not_offered_twice_delivers_final_closing():
    agent = _assistant([])
    dup = "شنو قنوات الاستقطاب اللي تعتمد عليها بالتوظيف؟"
    agent._memory.asked_questions.extend([f"سؤال سابق رقم {i}؟" for i in range(9)] + [dup])
    agent._memory.wrap_up_offered = True  # wrap-up already offered a turn earlier
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_RESUME)
    out = agent._guard_repetition_and_language(dup)
    # No SECOND "anything to add?"; instead the interview winds down with a final
    # closing rather than recycling the covered question.
    assert "أكو شي تحب تضيفه" not in out
    assert "يراجع إجاباتك" in out
    assert agent._memory.final_closing_sent is True


def test_guard_no_wrapup_too_early():
    agent = _assistant([])
    dup = "شنو قنوات الاستقطاب اللي تعتمد عليها بالتوظيف؟"
    agent._memory.asked_questions.append(dup)  # only one question so far
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_RESUME)
    out = agent._guard_repetition_and_language(dup)
    assert out == dup  # too early to wrap up
    assert agent._memory.wrap_up_offered is False


# --- after wrap-up: conclude instead of resuming with a new question ----------
def test_guard_final_closing_after_wrapup_blocks_new_question():
    agent = _assistant(["شنو خبرتك بالتوظيف؟"])
    agent._memory.wrap_up_offered = True  # wrap-up already offered a turn earlier
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_ASK)
    out = agent._guard_repetition_and_language("شنو أدواتك المفضلة بالعمل؟")
    assert "يراجع إجاباتك" in out  # a final closing, not a new question
    assert "أكو شي تحب تضيفه" not in out  # not the wrap-up prompt again
    assert agent._memory.final_closing_sent is True


def test_guard_final_closing_delivered_only_once():
    agent = _assistant(["q"])
    agent._memory.wrap_up_offered = True
    agent._memory.final_closing_sent = True  # already delivered
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_ASK)
    out = agent._guard_repetition_and_language("سؤال مختلف تماماً عن الرواتب؟")
    assert "يراجع إجاباتك" not in out  # closing not repeated


def test_guard_followup_after_wrapup_still_passes():
    # A follow-up lets the candidate finish their last thought after the wrap-up.
    agent = _assistant(["q"])
    agent._memory.wrap_up_offered = True
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_FOLLOW_UP)
    out = agent._guard_repetition_and_language("شنو صار بالضبط؟")
    assert out == "شنو صار بالضبط؟"
    assert agent._memory.final_closing_sent is False


# --- (أ.1) competency coverage is recorded on ASK so it is not re-served -------
def test_asked_competency_recorded_on_any_asked_question():
    agent = _assistant(["q"])
    agent._turn_plan = TurnPlan(
        question="س", competency_key="comp_hiring", source="bank", response_mode=MODE_ASK
    )
    agent.record_agent_reply("شنو خبرتك بإدارة عملية التوظيف بالضبط؟")
    # Previously only source == competency_floor recorded it, so bank/track/path
    # questions were re-servable -> repeats.
    assert "comp_hiring" in agent._memory.asked_competency_keys


def test_followup_does_not_mark_a_new_competency_covered():
    agent = _assistant(["q"])
    agent._turn_plan = TurnPlan(
        question="س", competency_key="comp_x", source="bank", response_mode=MODE_FOLLOW_UP
    )
    agent.record_agent_reply("شنو صار بالضبط؟")
    # Follow-up deepens the active competency; it must not mark a competency as
    # freshly covered here.
    assert "comp_x" not in agent._memory.asked_competency_keys


# --- the final closing must actually CONCLUDE the session, not just be spoken ---
# Real transcript defect: the guard said the closing but never tore the room
# down, so the agent kept replying until the candidate left ("لم يختم").
def test_final_closing_flags_conclude_after_reply():
    agent = _assistant(["شنو خبرتك بالتوظيف؟"])
    agent._memory.wrap_up_offered = True
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_ASK)
    out = agent._guard_repetition_and_language("شنو أدواتك المفضلة بالعمل؟")
    assert "يراجع إجاباتك" in out  # final closing emitted
    # ...and the one-shot teardown flag is armed so the room is actually closed.
    assert agent._conclude_after_reply is True


def test_winddown_advances_once_per_turn_no_collapse():
    # The guard runs twice per turn (transcription_node + tts_node). A wrap-up
    # offer must NOT collapse into the final closing within the same turn — both
    # passes return the SAME wind-down line, and closing waits for a later turn.
    agent = _assistant([])  # empty bank → no fresh anchor
    dup = "شنو قنوات الاستقطاب اللي تعتمد عليها بالتوظيف؟"
    agent._memory.asked_questions.extend([f"سؤال سابق رقم {i}؟" for i in range(9)] + [dup])
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_RESUME)
    first = agent._guard_repetition_and_language(dup)  # transcription pass
    second = agent._guard_repetition_and_language(dup)  # tts pass, SAME turn_index
    assert "أكو شي تحب تضيفه" in first  # wrap-up offered
    assert second == first  # identical line on the second pass (chat == audio)
    assert agent._memory.final_closing_sent is False  # did NOT collapse to closing
    assert agent._conclude_after_reply is False  # nothing to tear down yet


def test_winddown_closing_delivered_on_following_turn():
    agent = _assistant([])
    dup = "شنو قنوات الاستقطاب اللي تعتمد عليها بالتوظيف؟"
    agent._memory.asked_questions.extend([f"سؤال سابق رقم {i}؟" for i in range(9)] + [dup])
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_RESUME)
    agent._guard_repetition_and_language(dup)  # turn 0: offers wrap-up
    assert agent._memory.wrap_up_offered is True
    # candidate answered → a new turn advances turn_index
    agent._memory.turn_index = 1
    out = agent._guard_repetition_and_language("خلص، ما عندي شي أضيفه")
    assert "يراجع إجاباتك" in out  # NOW the final closing
    assert agent._memory.final_closing_sent is True
    assert agent._conclude_after_reply is True


class _FakeJobCtx:
    def __init__(self) -> None:
        self.deleted = False
        self.shutdown_reason: str | None = None

    async def delete_room(self) -> None:
        self.deleted = True

    def shutdown(self, reason: str | None = None) -> None:
        self.shutdown_reason = reason


def test_conclude_interview_deletes_room(monkeypatch):
    agent = _assistant(["q"])
    fake = _FakeJobCtx()
    monkeypatch.setattr("voice_interview.assistant.get_job_context", lambda: fake)
    monkeypatch.setattr("voice_interview.assistant.interview_end_playout_grace_ms", lambda: 0)
    # ctx=None → derives (missing) session speech defensively, then tears down.
    asyncio.run(agent._conclude_interview(None))
    assert fake.deleted is True


def test_conclude_waits_playout_grace_before_delete(monkeypatch):
    # With the avatar, wait_for_playout returns before the avatar finishes playing
    # the closing, so we add a grace before deleting the room — otherwise the
    # goodbye is cut off and the avatar vanishes mid-sentence.
    import voice_interview.assistant as _asst

    agent = _assistant(["q"])
    fake = _FakeJobCtx()
    monkeypatch.setattr("voice_interview.assistant.get_job_context", lambda: fake)
    monkeypatch.setattr("voice_interview.assistant.interview_end_playout_grace_ms", lambda: 40)
    slept: list[float] = []

    async def _spy_sleep(d):
        slept.append(d)

    monkeypatch.setattr(_asst.asyncio, "sleep", _spy_sleep)
    asyncio.run(agent._conclude_interview(None))
    assert any(abs(d - 0.04) < 1e-6 for d in slept)  # 40ms grace was awaited
    assert fake.deleted is True  # deletion still happens, after the grace


def test_schedule_conclude_tears_down_room(monkeypatch):
    agent = _assistant(["q"])
    agent._auto_end_enabled = True
    agent._conclude_after_reply = True
    fake = _FakeJobCtx()
    monkeypatch.setattr("voice_interview.assistant.get_job_context", lambda: fake)
    monkeypatch.setattr("voice_interview.assistant.interview_end_playout_grace_ms", lambda: 0)

    async def _run() -> None:
        agent._schedule_conclude_after_reply()
        pending = [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
        if pending:
            await asyncio.gather(*pending)

    asyncio.run(_run())
    assert fake.deleted is True  # room torn down
    assert agent._conclude_after_reply is False  # one-shot consumed


# --- continuation nudges REMOVED: stay silent on an unfinished turn, don't interrupt ---
def test_wait_nudge_disabled_by_default():
    from voice_interview.config import interview_wait_nudge_enabled

    # Default is silent — the spoken "take your time…" nudge is off.
    assert interview_wait_nudge_enabled() is False


def test_incomplete_turn_infers_wait_for_completion():
    agent = _assistant(["q"])
    # The three signals that used to trigger a continuation nudge.
    assert agent._infer_action_from_frame({"is_incomplete_turn": True}) == "wait_for_completion"
    assert agent._infer_action_from_frame({"is_answer_in_progress": True}) == "wait_for_completion"
    assert agent._infer_action_from_frame({"resume_active": True}) == "wait_for_completion"


def test_incomplete_turn_stays_silent_no_nudge(monkeypatch):
    # A mid-answer turn must produce NO agent reply (StopResponse), instead of a
    # spoken continuation nudge that talks over the candidate.
    agent = _assistant(["q"])
    monkeypatch.setattr(
        "voice_interview.assistant.analyze_user_answer",
        lambda *a, **k: {"is_incomplete_turn": True},
    )
    monkeypatch.setattr(agent, "_apply_entity_policy", lambda text, diag: diag)
    monkeypatch.setattr("voice_interview.assistant.interview_wait_nudge_enabled", lambda: False)

    tc = ChatContext.empty()
    msg = ChatMessage(role="user", content=["أنا كنت أشتغل و"])
    before = len(tc.items)
    with pytest.raises(StopResponse):
        asyncio.run(agent.on_user_turn_completed(tc, msg))
    # No decision-frame system message was injected — the agent said nothing.
    assert len(tc.items) == before


def test_incomplete_turn_nudges_when_flag_enabled(monkeypatch):
    # With the legacy flag on, a mid-answer turn does NOT stay silent (it proceeds
    # to inject the decision frame so the LLM can nudge).
    agent = _assistant(["q"])
    monkeypatch.setattr(
        "voice_interview.assistant.analyze_user_answer",
        lambda *a, **k: {"is_incomplete_turn": True},
    )
    monkeypatch.setattr(agent, "_apply_entity_policy", lambda text, diag: diag)
    monkeypatch.setattr("voice_interview.assistant.interview_wait_nudge_enabled", lambda: True)

    tc = ChatContext.empty()
    msg = ChatMessage(role="user", content=["أنا كنت أشتغل و"])
    # Should NOT raise StopResponse — the nudge path is taken.
    asyncio.run(agent.on_user_turn_completed(tc, msg))


def test_schedule_conclude_noop_when_auto_end_disabled(monkeypatch):
    agent = _assistant(["q"])
    agent._auto_end_enabled = False
    agent._conclude_after_reply = True
    fake = _FakeJobCtx()
    monkeypatch.setattr("voice_interview.assistant.get_job_context", lambda: fake)

    async def _run() -> None:
        agent._schedule_conclude_after_reply()
        pending = [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
        if pending:
            await asyncio.gather(*pending)

    asyncio.run(_run())
    assert fake.deleted is False  # legacy behavior: keep the room open
    assert agent._conclude_after_reply is False  # flag still cleared (one-shot)
