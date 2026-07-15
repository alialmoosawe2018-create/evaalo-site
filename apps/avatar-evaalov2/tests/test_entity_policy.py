"""Tests for entity linking policy (Phase A)."""

from __future__ import annotations

import pytest

from voice_interview.assistant import InterviewAssistant, TtsRouteContext
from voice_interview.entity_policy import (
    RoleGlossaryEntry,
    build_glossary_entries,
    compute_link_policy,
    detect_tool_correction,
    extract_candidate_entities,
    extract_speech_hooks,
    pick_hook_followup,
    simplify_clarify_for_pack,
    simplify_clarify_question,
)
from voice_interview.heuristics import analyze_user_answer, normalize_text
from voice_interview.entity_policy import build_role_glossary, collapse_to_single_question


class _StubTts:
    def update_options(self, **kwargs):  # noqa: ANN003
        pass


def _survey_glossary() -> list[RoleGlossaryEntry]:
    return build_glossary_entries(
        [
            "GPS",
            "GNSS",
            "Total Station",
            "RTK",
            "control points",
            "leveling",
        ]
    )


def _make_assistant(
    bank: list[str] | None = None,
    glossary: list[RoleGlossaryEntry] | None = None,
    competencies: list[dict] | None = None,
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
            "اذكرلي أهم مشروع مسح اشتغلت عليه، وشنو كان دورك بيه؟",
            "شنو نوع أعمال المسح اللي عندك خبرة بيها أكثر شي؟",
        ],
        bank_key="survey",
        position="Survey Engineer",
        has_domain_guidance=True,
        role_glossary=glossary or _survey_glossary(),
        blueprint_competencies=competencies
        or [
            {
                "title": "accuracy and coordinate control",
                "followUps": [
                    "شلون كنت تتأكد من دقة الإحداثيات قبل تعتمدها بالتسليم؟"
                ],
            }
        ],
    )


def test_greeting_only_empty_allowed_entities() -> None:
    glossary = _survey_glossary()
    diag = analyze_user_answer("أهلاً، أنا جاهز")
    policy = compute_link_policy(
        entities_in_message=extract_candidate_entities("أهلاً، أنا جاهز", glossary),
        glossary=glossary,
        rejected_entities=set(),
        is_greeting_or_ready=diag["is_greeting_or_ready"],
        is_substantive=diag["is_substantive_answer"],
    )
    assert policy["allowed_link_entities"] == []
    assert policy["candidate_entities_in_last_message"] == []


def test_gps_not_total_station_correction() -> None:
    glossary = _survey_glossary()
    text = "ممكن نغير السؤال. انا اشتغل على الجي بي اس مو على ستيشن."
    norm = normalize_text(text)
    correction = detect_tool_correction(norm, text, glossary)
    assert correction is not None
    assert correction.corrected_fact == "GPS"
    assert correction.incorrect_assumption == "Total Station"

    entities = extract_candidate_entities(text, glossary)
    policy = compute_link_policy(
        entities_in_message=entities,
        glossary=glossary,
        rejected_entities=set(),
        is_greeting_or_ready=False,
        is_substantive=True,
        correction=correction,
    )
    assert "GPS" in policy["allowed_link_entities"]
    assert "Total Station" not in policy["allowed_link_entities"]
    assert "Total Station" in policy["rejected_entities"]


def test_blueprint_term_not_in_allowed_without_candidate_mention() -> None:
    glossary = _survey_glossary()
    # Candidate says nothing about Total Station
    text = "اشتغلت بمشروع مسح كبير في البصرة"
    entities = extract_candidate_entities(text, glossary)
    assert "Total Station" not in entities
    policy = compute_link_policy(
        entities_in_message=entities,
        glossary=glossary,
        rejected_entities=set(),
        is_greeting_or_ready=False,
        is_substantive=True,
    )
    assert "Total Station" in policy["forbidden_attribution_entities"]


def test_recommended_question_on_greeting_is_anchor() -> None:
    agent = _make_assistant()
    diag = analyze_user_answer("أنا جاهز")
    diag = agent._apply_entity_policy("أنا جاهز", diag)
    rec = agent._pick_recommended_question(
        diag, agent._memory, diag["link_policy"]
    )
    assert rec is not None
    assert "مشروع مسح" in rec or "مسح" in rec


def test_apply_entity_policy_tracks_session_entities() -> None:
    agent = _make_assistant()
    text = "اشتغلت على GPS RTK بمشروع مسح"
    diag = analyze_user_answer(text)
    diag = agent._apply_entity_policy(text, diag)
    assert "GPS" in agent._memory.session_entities
    assert diag["link_policy"]["allowed_link_entities"]


def test_build_role_glossary_from_metadata() -> None:
    class _Bank:
        category = "engineering_civil_mep"
        industry_family = "engineering"

    meta = {
        "domain_guidance": "terminology: GPS, GNSS, Total Station, leveling",
        "blueprint": '{"anchorQuestions":["GPS survey project"],"competencies":[{"title":"field survey"}]}',
    }
    glossary = build_role_glossary(meta, _Bank(), {"anchorQuestions": ["GPS survey"], "competencies": []})
    labels = {e.canonical for e in glossary}
    assert "GPS" in labels
    assert "Total Station" in labels


def test_build_role_glossary_from_role_glossary_json() -> None:
    class _Bank:
        category = "general"
        industry_family = "general"

    meta = {
        "role_glossary": '["ESP", "GOR", "Water Cut"]',
        "profile_terminology": "GPS, GNSS",
    }
    glossary = build_role_glossary(meta, _Bank(), None)
    labels = {e.canonical for e in glossary}
    assert "ESP" in labels
    assert "GPS" in labels
    assert "Water Cut" in labels


def test_build_role_glossary_from_blueprint_terminology() -> None:
    class _Bank:
        category = "general"
        industry_family = "general"

    blueprint = {
        "terminology": ["RTK", "Total Station"],
        "anchorQuestions": [],
        "competencies": [],
    }
    glossary = build_role_glossary({}, _Bank(), blueprint)
    labels = {e.canonical for e in glossary}
    assert "RTK" in labels
    assert "Total Station" in labels


def test_collapse_compound_recruiter_anchor() -> None:
    bad = (
        "شنو هي وظيفة صعبة كان عليك توظيفها؟ شلون أخذت متطلبات الدور من المدير، "
        "وكيف بنيت خطة البحث، وما الذي سويته لما ما حصلت على مرشحين مناسبين بالبداية؟"
    )
    single = collapse_to_single_question(bad)
    assert single.count("؟") == 1
    assert "شلون أخذت" not in single


def test_collapse_splits_on_comma_ways() -> None:
    text = "شنو المؤشرات اللي تتابعها؟ واذكرلي قرار اتخذته بناءً على أحدها؟"
    single = collapse_to_single_question(text)
    assert single == "شنو المؤشرات اللي تتابعها؟"


def test_hr_recruiter_pack_anchors_are_single() -> None:
    anchors = [
        "اذكرلي دور واجهت صعوبة بتوظيفه، شنو كان أصعب تحدي بيه؟",
        "شلون تاخذ متطلبات الدور من المدير قبل ما تبدي البحث؟",
        "شنو قنوات الاستقطاب اللي تعتمد عليها أكثر شي؟",
    ]
    for a in anchors:
        assert collapse_to_single_question(a).count("؟") == 1
        assert "شنو هي وظيفة صعبة" not in a


def test_decision_frame_includes_turn_state() -> None:
    agent = _make_assistant()
    diag = analyze_user_answer("أنا جاهز")
    diag = agent._apply_entity_policy("أنا جاهز", diag)
    frame = agent._build_decision_frame(diag)
    assert frame is not None
    assert "TURN STATE:" in frame
    assert '"allowed_link_entities":[]' in frame.replace(" ", "")
    assert "SINGLE-QUESTION RULE" in frame


def test_extract_speech_hooks_linkedin_telegram_referrals() -> None:
    text = "نستخدم LinkedIn و Telegram والإحالات بشكل يومي"
    hooks = extract_speech_hooks(text)
    assert "LinkedIn" in hooks
    assert "Telegram" in hooks
    assert "Referrals" in hooks


def test_pick_hook_followup_linkedin() -> None:
    q = pick_hook_followup("LinkedIn")
    assert "LinkedIn" in q
    assert q.endswith("؟")


def test_simplify_clarify_metrics_question_hr() -> None:
    simplified = simplify_clarify_question("شنو المؤشرات اللي تتابعها بشكل دوري؟")
    assert "مثلاً" in simplified
    assert "Time to Fill" in simplified
    assert simplified != "شنو المؤشرات اللي تتابعها بشكل دوري؟"


def test_simplify_clarify_metrics_question_petroleum() -> None:
    simplified, source = simplify_clarify_for_pack(
        "شنو المؤشرات اللي تبدي بيها قبل القرار؟",
        domain_pack_key="petroleum_engineer",
    )
    assert source == "petroleum_engineer"
    assert "Time to Fill" not in simplified
    assert "Offer Acceptance" not in simplified
    assert "معدل الإنتاج" in simplified or "الضغط" in simplified
