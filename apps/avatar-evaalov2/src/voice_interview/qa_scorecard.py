"""Automated QA scorecard evaluation for interview agent behavior (no LLM)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from voice_interview.assistant import InterviewAssistant, TtsRouteContext
from voice_interview.entity_policy import RoleGlossaryEntry, build_glossary_entries
from voice_interview.heuristics import analyze_user_answer


class _StubTts:
    def update_options(self, **kwargs: Any) -> None:  # noqa: ANN401
        pass


@dataclass
class QAScenarioExpect:
    meta_request: str | None = None
    track: str | None = None
    honor_skip_content: bool | None = None
    action: str | None = None
    recommended_is_none: bool | None = None
    recommended_contains_any: tuple[str, ...] = ()
    recommended_not_contains: tuple[str, ...] = ()
    allowed_link_empty: bool | None = None
    allowed_contains_any: tuple[str, ...] = ()
    identity_no_question_mark: bool | None = None
    is_substantive: bool | None = None


@dataclass
class QAScenario:
    id: str
    pack_key: str
    persona: str
    category: str
    candidate_text: str
    position: str
    bank_questions: list[str]
    experience_tracks: list[dict[str, Any]]
    interview_paths: list[dict[str, Any]]
    terminology: list[str]
    career_level: str = ""
    memory_setup: dict[str, Any] = field(default_factory=dict)
    expect: QAScenarioExpect = field(default_factory=QAScenarioExpect)


@dataclass
class QAScenarioResult:
    scenario_id: str
    pack_key: str
    persona: str
    category: str
    passed: bool
    errors: list[str] = field(default_factory=list)
    track: str = ""
    action: str = ""
    recommended: str | None = None


@dataclass
class QAScorecardReport:
    total: int
    passed: int
    failed: int
    by_pack: dict[str, dict[str, int]]
    by_category: dict[str, dict[str, int]]
    by_persona: dict[str, dict[str, int]]
    results: list[QAScenarioResult]

    @property
    def pass_rate(self) -> float:
        return (self.passed / self.total) if self.total else 0.0


def build_agent_from_scenario(scenario: QAScenario) -> InterviewAssistant:
    glossary: list[RoleGlossaryEntry] = build_glossary_entries(scenario.terminology)
    router = TtsRouteContext(
        _StubTts(),
        arabic_voice_id="ar",
        english_voice_id="en",
        supports_override=False,
        cooldown_ms=0,
        initial_voice_id="ar",
        initial_language="ar",
    )
    agent = InterviewAssistant(
        tts_router=router,
        bank_questions=list(scenario.bank_questions),
        bank_key=scenario.pack_key,
        position=scenario.position,
        has_domain_guidance=True,
        role_glossary=glossary,
        experience_tracks=list(scenario.experience_tracks),
        interview_paths=list(scenario.interview_paths),
        career_level=scenario.career_level or None,
    )
    mem = agent._memory
    setup = scenario.memory_setup or {}
    if setup.get("current_topic"):
        mem.current_topic = str(setup["current_topic"])
    if setup.get("last_sample"):
        mem.last_sample = str(setup["last_sample"])
    if setup.get("active_experience_track"):
        mem.active_experience_track = str(setup["active_experience_track"])
    if setup.get("path_cursor") is not None:
        mem.path_cursor = int(setup["path_cursor"])
    return agent


def evaluate_scenario(scenario: QAScenario) -> QAScenarioResult:
    errors: list[str] = []
    agent = build_agent_from_scenario(scenario)
    text = scenario.candidate_text
    diag = analyze_user_answer(text)
    diag = agent._apply_entity_policy(text, diag)
    link = diag.get("link_policy") or {}
    exp = scenario.expect

    if exp.track is not None:
        agent._update_experience_track(text)

    if exp.is_substantive is not None:
        got = bool(diag.get("is_substantive_answer"))
        if got != exp.is_substantive:
            errors.append(f"is_substantive_answer expected {exp.is_substantive}, got {got}")

    if exp.meta_request is not None:
        got = diag.get("meta_request")
        if got != exp.meta_request:
            errors.append(f"meta_request expected {exp.meta_request!r}, got {got!r}")

    if exp.honor_skip_content is not None:
        got = bool(diag.get("honor_skip_content"))
        if got != exp.honor_skip_content:
            errors.append(f"honor_skip_content expected {exp.honor_skip_content}, got {got}")

    if exp.track is not None:
        got = agent._memory.active_experience_track
        if got != exp.track:
            errors.append(f"active_experience_track expected {exp.track!r}, got {got!r}")

    if exp.allowed_link_empty is not None:
        allowed = link.get("allowed_link_entities") or []
        empty = len(allowed) == 0
        if empty != exp.allowed_link_empty:
            errors.append(
                f"allowed_link_empty expected {exp.allowed_link_empty}, got {allowed!r}"
            )

    if exp.allowed_contains_any:
        allowed = link.get("allowed_link_entities") or []
        if not any(any(tok.lower() in str(a).lower() for tok in exp.allowed_contains_any) for a in allowed):
            errors.append(
                f"allowed_link_entities missing any of {exp.allowed_contains_any!r} (got {allowed!r})"
            )

    action = agent._infer_action_from_frame(diag)
    if exp.action is not None and action != exp.action:
        errors.append(f"action expected {exp.action!r}, got {action!r}")

    recommended = agent._pick_recommended_question(diag, agent._memory, link)

    if exp.recommended_is_none is not None:
        is_none = recommended is None
        if is_none != exp.recommended_is_none:
            errors.append(
                f"recommended_is_none expected {exp.recommended_is_none}, got {recommended!r}"
            )

    if recommended and exp.recommended_contains_any:
        if not any(tok in recommended for tok in exp.recommended_contains_any):
            errors.append(
                f"recommended missing any of {exp.recommended_contains_any!r}: {recommended!r}"
            )

    if recommended and exp.recommended_not_contains:
        for bad in exp.recommended_not_contains:
            if bad in recommended:
                errors.append(f"recommended must not contain {bad!r}: {recommended!r}")

    if exp.identity_no_question_mark:
        reply = agent._canned_identity_reply(text)
        if "؟" in reply or "?" in reply:
            errors.append(f"identity reply must not contain question mark: {reply!r}")

    return QAScenarioResult(
        scenario_id=scenario.id,
        pack_key=scenario.pack_key,
        persona=scenario.persona,
        category=scenario.category,
        passed=not errors,
        errors=errors,
        track=agent._memory.active_experience_track or "",
        action=action,
        recommended=recommended,
    )


def run_scorecard(scenarios: list[QAScenario]) -> QAScorecardReport:
    results = [evaluate_scenario(s) for s in scenarios]
    passed = sum(1 for r in results if r.passed)
    failed = len(results) - passed

    by_pack: dict[str, dict[str, int]] = {}
    by_category: dict[str, dict[str, int]] = {}
    by_persona: dict[str, dict[str, int]] = {}

    def _bump(bucket: dict[str, dict[str, int]], key: str, ok: bool) -> None:
        row = bucket.setdefault(key, {"passed": 0, "failed": 0, "total": 0})
        row["total"] += 1
        if ok:
            row["passed"] += 1
        else:
            row["failed"] += 1

    for r in results:
        _bump(by_pack, r.pack_key, r.passed)
        _bump(by_category, r.category, r.passed)
        _bump(by_persona, r.persona, r.passed)

    return QAScorecardReport(
        total=len(results),
        passed=passed,
        failed=failed,
        by_pack=by_pack,
        by_category=by_category,
        by_persona=by_persona,
        results=results,
    )
