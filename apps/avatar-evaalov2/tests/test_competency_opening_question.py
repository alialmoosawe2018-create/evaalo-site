"""A competency is OPENED with its objective, never with a cold follow-up.

Found 2026-09-17 by replaying the founder's own interview (n8n exec 1893) with
that campaign's real blueprint: every one of the ten competency questions came
out as ``followUpRules[0]`` — «أي بند من السياسة اعتمدت عليه بالتحديد؟» asked
before the candidate had told any story. The agent's own prompt calls those
"Follow-up if needed" (worker.py), and the designed opener — ``questionObjective``
— never reached the spoken question at all.
"""

from __future__ import annotations

from voice_interview.assistant import InterviewAssistant, TtsRouteContext


class _StubTts:
    def update_options(self, **kwargs: object) -> None:
        pass


def _agent(competencies: list[dict[str, object]]) -> InterviewAssistant:
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
        bank_questions=[],
        bank_key="hr_generalist",
        position="أخصائي موارد بشرية",
        has_domain_guidance=True,
        blueprint_competencies=competencies,
    )


# Exactly the shape buildBlueprintMetadata() sends the agent (key/title/objective/
# evidence/redFlags/followUps), taken verbatim from the founder's campaign.
REAL = {
    "key": "hr_policy_application",
    "title": "تطبيق سياسات HR المكتوبة",
    "objective": (
        "اذكرلي مثال عن موقف تطلب تفسير وتطبيق سياسة مكتوبة (مثلاً سياسة إجازات أو حضور)، "
        "شنو كانت الحالة، شنو سويت تحديداً، وشنو صار بالنتيجة؟"
    ),
    "evidence": ["ذكر اسم السياسة وبند محدد أستُند عليه"],
    "followUps": ["أي بند من السياسة اعتمدت عليه بالتحديد؟", "وين سجدت توثيق القرار؟"],
}

# Domain packs phrase the objective as a measurement statement, not a question.
PACK = {
    "key": "field_safety",
    "title": "السلامة والإجراءات التشغيلية",
    "objective": "قياس وعي المرشح بالسلامة والإجراءات التشغيلية في الحقل.",
    "evidence": ["ذكر إجراء سلامة محدد طبّقه"],
    "followUps": ["شنو رقم تصريح العمل اللي استخدمته؟"],
}


def test_objective_opens_the_competency_not_the_followup():
    agent = _agent([REAL])
    text = agent._competency_question_text(REAL)
    assert text == REAL["objective"]
    assert text not in REAL["followUps"]
    assert "أي بند من السياسة اعتمدت عليه" not in text


def test_a_statement_objective_falls_through_to_the_behavioural_probe():
    agent = _agent([PACK])
    text = agent._competency_question_text(PACK)
    assert text.startswith("احچيلي عن موقف حقيقي يبيّن")
    assert PACK["title"] in text
    assert text not in PACK["followUps"]
    assert text.count("؟") == 1


def test_legacy_blueprint_with_only_followups_still_gets_a_question():
    legacy = {"key": "c1", "followUpRules": ["شنو خبرتك بـ c1؟"]}
    agent = _agent([legacy])
    assert agent._competency_question_text(legacy) == "شنو خبرتك بـ c1؟"


def test_sent_question_is_a_single_question_and_not_a_cold_probe():
    agent = _agent([REAL])
    sent = agent._pick_next_competency_question(agent._memory)
    assert sent is not None
    assert sent.count("؟") == 1
    # collapse trims the trailing «وشنو صار بالنتيجة؟» but keeps the situation ask
    assert sent.startswith("اذكرلي مثال عن موقف")
    assert "أي بند من السياسة" not in sent


def test_followups_remain_available_for_the_followup_path():
    """The cold probes are not deleted — they keep their own (correct) home."""
    agent = _agent([REAL])
    assert agent._find_competency_followup("تطبيق سياسات HR المكتوبة") == (
        "أي بند من السياسة اعتمدت عليه بالتحديد؟"
    )
