"""Tests for experience track detection and path-aware question selection."""

from __future__ import annotations

import pytest

from voice_interview.assistant import InterviewAssistant, TtsRouteContext
from voice_interview.experience_tracks import (
    detect_experience_track,
    peek_path_step_question,
    pick_next_competency_question,
    pick_track_opening_anchor,
)
from voice_interview.heuristics import analyze_user_answer, normalize_text


class _StubTts:
    def update_options(self, **kwargs):  # noqa: ANN003
        pass


def _make_assistant(
  *,
  bank: list[str] | None = None,
  tracks: list[dict] | None = None,
  paths: list[dict] | None = None,
  career_level: str = "",
) -> InterviewAssistant:
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
        bank_questions=bank
        or [
            "شلون قست أداء بئر وشنو البيانات اللي راجعتها؟",
            "اذكرلي قرار ميداني صعب وشنو النتيجة؟",
        ],
        bank_key="test",
        position="Petroleum Engineer",
        has_domain_guidance=True,
        experience_tracks=tracks,
        interview_paths=paths,
        career_level=career_level,
        domain_pack_key="petroleum_engineer",
    )


PETROLEUM_TRACKS = [
    {
        "trackKey": "academic_only",
        "detectSignals": ["جامعة", "مشروع تخرج", "محاكاة"],
        "questionDifficulty": 1,
        "openingAnchors": [
            "اذكرلي مشروع تخرج نفطي سويته — شنو كان الموضوع؟",
            "شنو أهم محاكاة درستها بالجامعة؟",
        ],
    },
    {
        "trackKey": "experienced",
        "detectSignals": ["حقل", "بئر", "ميدان"],
        "questionDifficulty": 3,
        "openingAnchors": [
            "اذكرلي بئر اشتغلت عليه — شنو كان التحدي؟",
        ],
    },
]

SURVEY_PATH = [
    {
        "pathKey": "survey_default",
        "steps": [
            {
                "stepKey": "project_type",
                "topicLabel": "Project type",
                "sampleQuestion": "شنو نوع مشروع المسح اللي اشتغلت عليه؟",
            },
            {
                "stepKey": "tool_used",
                "topicLabel": "Tool",
                "sampleQuestion": "شنو الجهاز أو البرنامج اللي استخدمته؟",
            },
        ],
    }
]


def test_detect_academic_only_from_university_speech() -> None:
    text = "كل شي تعلمته بالجامعة ومشروع التخرج كان محاكاة مكمن"
    track = detect_experience_track(text, PETROLEUM_TRACKS)
    assert track == "academic_only"


def test_detect_experienced_from_field_speech() -> None:
    text = "اشتغلت في حقل مجنون على بئر وكنت أراقب الإنتاج بالموقع"
    track = detect_experience_track(text, PETROLEUM_TRACKS)
    assert track == "experienced"


def test_track_sticky_until_stronger_signal() -> None:
    first = detect_experience_track(
        "اشتغلت بحقل نفطي",
        PETROLEUM_TRACKS,
        current_track="experienced",
    )
    assert first == "experienced"
    second = detect_experience_track(
        "بالجامعة سويت محاكاة ومشروع تخرج",
        PETROLEUM_TRACKS,
        current_track=first,
    )
    assert second == "academic_only"


def test_pick_academic_opening_anchor_not_field_bank() -> None:
    agent = _make_assistant(tracks=PETROLEUM_TRACKS)
    agent._memory.active_experience_track = "academic_only"
    q = agent._pick_track_aware_anchor(agent._memory)
    assert q
    assert "تخرج" in q or "جامعة" in q or "محاكاة" in q
    assert normalize_text(q) not in {
        normalize_text(agent._bank_questions[0]),
        normalize_text(agent._bank_questions[1]),
    }


def test_substantive_answer_updates_track() -> None:
    agent = _make_assistant(tracks=PETROLEUM_TRACKS)
    text = "كل شي بالجامعة ومشروع تخرج عن محاكاة CMG"
    diag = analyze_user_answer(text)
    diag = agent._apply_entity_policy(text, diag)
    assert agent._memory.active_experience_track == "academic_only"


def test_greeting_uses_track_anchor_for_entry_level() -> None:
    agent = _make_assistant(tracks=PETROLEUM_TRACKS, career_level="entry")
    diag = analyze_user_answer("اهلا انا جاهز")
    rec = agent._pick_recommended_question(diag, agent._memory, {})
    assert rec
    # entry_level universal anchor mentions first job / after graduation
    assert "تخرج" in rec or "أول" in rec or "مبتدئ" in rec or "سنة" in rec


def test_path_step_offered_on_normal_advance() -> None:
    agent = _make_assistant(tracks=PETROLEUM_TRACKS, paths=SURVEY_PATH)
    agent._memory.active_experience_track = "experienced"
    diag = analyze_user_answer(
        "اشتغلت على مشروع مسح كبير بالموقع واستخدمت GPS و total station لعدة أسابيع"
    )
    rec = agent._pick_recommended_question(diag, agent._memory, {})
    assert rec == "شنو نوع مشروع المسح اللي اشتغلت عليه؟"
    assert agent._turn_recommended_source == "path_step"
    assert agent._turn_plan is not None
    assert agent._turn_plan.advance_path_on_send is False


def test_competency_jump_on_skip_petroleum() -> None:
    agent = _make_assistant(tracks=PETROLEUM_TRACKS, paths=SURVEY_PATH)
    agent._memory.active_experience_track = "experienced"
    agent._memory.current_competency_key = "field_data_analysis"
    agent._memory.pending_step_key = "field_data_analysis"
    agent._memory.current_topic = "اذكرلي مثال محدد — شنو المشكلة؟"
    agent._memory.active_question_text = agent._memory.current_topic
    agent._memory.active_question_status = "awaiting_answer"
    diag = analyze_user_answer("غير السؤال")
    agent._reject_active_question(agent._memory)
    rec = agent._pick_recommended_question(diag, agent._memory, {})
    assert rec is not None
    assert "star_project_chain" in agent._memory.rejected_competency_keys
    assert agent._turn_recommended_source in ("competency_jump", "path_step")


def test_path_cursor_advances_on_normal_path_step() -> None:
    agent = _make_assistant(tracks=PETROLEUM_TRACKS, paths=SURVEY_PATH)
    agent._memory.active_experience_track = "experienced"
    agent._memory.current_topic = "old topic"
    agent._memory.active_question_text = "old topic"
    agent._memory.active_question_status = "answering"
    diag = analyze_user_answer(
        "اشتغلت على مشروع مسح كبير بالموقع واستخدمت GPS و total station لعدة أسابيع"
    )
    action = agent._infer_action_from_frame(diag)
    agent._update_memory_post_decision(diag, action)
    assert agent._memory.active_question_status == "answered"
    agent._pick_recommended_question(diag, agent._memory, {})
    assert agent._turn_plan is not None
    assert agent._turn_plan.advance_path_on_send is True
    agent.record_agent_reply("شنو نوع مشروع المسح اللي اشتغلت عليه؟")
    assert agent._memory.path_cursor == 1


def test_peek_path_skips_used_questions() -> None:
    used = {normalize_text("شنو نوع مشروع المسح اللي اشتغلت عليه؟")}
    q = peek_path_step_question(SURVEY_PATH, "experienced", 0, used)
    assert q == "شنو الجهاز أو البرنامج اللي استخدمته؟"


@pytest.mark.parametrize(
    "text,expected",
    [
        ("ما عندي خبرة ميدانية كل شي بالجامعة", "academic_only"),
        ("كنت متدرب بشركة نفط", "trainee"),
        ("غيرت مجال من IT للهندسة", "career_switcher"),
    ],
)
def test_universal_track_detection_without_pack(text: str, expected: str) -> None:
    track = detect_experience_track(text, None)
    assert track == expected


def test_pick_track_opening_anchor_respects_cursor() -> None:
    asked = set()
    q1, c1 = pick_track_opening_anchor("academic_only", PETROLEUM_TRACKS, cursor=0, asked_keys=asked)
    assert q1
    asked.add(normalize_text(q1))
    q2, _ = pick_track_opening_anchor(
        "academic_only", PETROLEUM_TRACKS, cursor=c1, asked_keys=asked
    )
    assert q2
    assert normalize_text(q1) != normalize_text(q2)
