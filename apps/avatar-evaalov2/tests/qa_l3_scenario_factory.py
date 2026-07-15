"""Factory for standard L3 QA scenarios (13 per pack) — Wave 1B/2."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from voice_interview.qa_scorecard import QAScenario, QAScenarioExpect


@dataclass
class PackScenarioConfig:
    prefix: str
    academic_text: str
    expert_text: str
    career_switch_text: str
    entry_text: str
    trainee_text: str
    domain_rich_text: str
    domain_followup_any: tuple[str, ...] = ()
    skip_hook_text: str | None = None
    skip_hook_any: tuple[str, ...] = ()
    academic_skip_any: tuple[str, ...] = ("جامعة", "تخرج", "أكاديمي", "محاكاة", "مشروع")
    academic_skip_not: tuple[str, ...] = ()
    path_skip_any: tuple[str, ...] = ("خبرتك", "مثال", "اذكر")
    stt_academic_text: str | None = None
    stt_expert_text: str | None = None
    tool_correction: tuple[str, str, tuple[str, ...], tuple[str, ...]] | None = None
    """(candidate_text, memory_topic_index, recommended_any, recommended_not)"""


def build_standard_l3_scenarios(
    base: dict[str, Any],
    cfg: PackScenarioConfig,
) -> list[QAScenario]:
  b = base
  p = cfg.prefix
  bq = b["bank_questions"]
  stt_academic = cfg.stt_academic_text or "بالجامعة. مشروع. تخرج. ما. عندي. ميدان."
  stt_expert = cfg.stt_expert_text or cfg.expert_text.replace(" ", ". ")[:80]

  scenarios: list[QAScenario] = [
      QAScenario(
          id=f"{p}_greeting_ready",
          persona="entry_level",
          category="greeting",
          candidate_text="اهلا انا جاهز فضلت",
          career_level="entry",
          expect=QAScenarioExpect(is_substantive=False, allowed_link_empty=True),
          **b,
      ),
      QAScenario(
          id=f"{p}_clarify",
          persona="general",
          category="clarify",
          candidate_text="بلكت توضحي لي السؤال اكثر",
          memory_setup={"current_topic": bq[0], "last_sample": bq[0]},
          expect=QAScenarioExpect(
              meta_request="clarify_term",
              action="rephrase",
              recommended_contains_any=("مثلاً", "مثال"),
          ),
          **b,
      ),
      QAScenario(
          id=f"{p}_identity",
          persona="general",
          category="identity",
          candidate_text="ممكن عرفيني عن نفسك",
          expect=QAScenarioExpect(
              meta_request="ask_interviewer",
              action="identity_reply",
              recommended_is_none=True,
              identity_no_question_mark=True,
          ),
          **b,
      ),
      QAScenario(
          id=f"{p}_academic",
          persona="academic_only",
          category="track",
          candidate_text=cfg.academic_text,
          expect=QAScenarioExpect(track="academic_only"),
          **b,
      ),
      QAScenario(
          id=f"{p}_expert",
          persona="expert",
          category="track",
          candidate_text=cfg.expert_text,
          memory_setup={"path_cursor": 99},
          expect=QAScenarioExpect(track="experienced"),
          **b,
      ),
      QAScenario(
          id=f"{p}_career_switch",
          persona="career_switcher",
          category="track",
          candidate_text=cfg.career_switch_text,
          expect=QAScenarioExpect(track="career_switcher"),
          **b,
      ),
      QAScenario(
          id=f"{p}_entry",
          persona="entry_level",
          category="track",
          candidate_text=cfg.entry_text,
          career_level="entry",
          expect=QAScenarioExpect(track="entry_level"),
          **b,
      ),
      QAScenario(
          id=f"{p}_trainee",
          persona="trainee",
          category="track",
          candidate_text=cfg.trainee_text,
          expect=QAScenarioExpect(track="trainee"),
          **b,
      ),
      QAScenario(
          id=f"{p}_domain_rich",
          persona="expert",
          category="domain",
          candidate_text=cfg.domain_rich_text,
          memory_setup={"path_cursor": 99, "active_experience_track": "experienced"},
          expect=QAScenarioExpect(is_substantive=True),
          **b,
      ),
      QAScenario(
          id=f"{p}_skip_academic",
          persona="academic_only",
          category="skip",
          candidate_text="غير السؤال",
          memory_setup={"current_topic": bq[0], "active_experience_track": "academic_only"},
          expect=QAScenarioExpect(action="acknowledged_skip"),
          **b,
      ),
      QAScenario(
          id=f"{p}_path_skip",
          persona="expert",
          category="path",
          candidate_text="غير السؤال",
          memory_setup={
              "current_topic": bq[0],
              "active_experience_track": "experienced",
              "path_cursor": 0,
          },
          expect=QAScenarioExpect(action="acknowledged_skip"),
          **b,
      ),
      QAScenario(
          id=f"{p}_stt_greeting",
          persona="stt_noisy",
          category="stt",
          candidate_text="اهلا. وسهلا. انا. جاهز.",
          expect=QAScenarioExpect(is_substantive=False, allowed_link_empty=True),
          **b,
      ),
      QAScenario(
          id=f"{p}_stt_skip",
          persona="stt_noisy",
          category="stt",
          candidate_text="خلينا. غير. السؤال.",
          memory_setup={"current_topic": bq[0]},
          expect=QAScenarioExpect(action="acknowledged_skip"),
          **b,
      ),
  ]

  if cfg.skip_hook_text:
      scenarios.insert(
          1,
          QAScenario(
              id=f"{p}_skip_hook",
              persona="expert",
              category="skip",
              candidate_text=cfg.skip_hook_text,
              memory_setup={"current_topic": bq[0], "last_sample": bq[0]},
              expect=QAScenarioExpect(
                  honor_skip_content=True,
                  action="honor_skip_content",
                  recommended_contains_any=cfg.skip_hook_any,
              ),
              **b,
          ),
      )
      scenarios.append(
          QAScenario(
              id=f"{p}_stt_academic",
              persona="stt_noisy",
              category="stt",
              candidate_text=stt_academic,
              expect=QAScenarioExpect(track="academic_only"),
              **b,
          ),
      )
  else:
      scenarios.append(
          QAScenario(
              id=f"{p}_stt_academic",
              persona="stt_noisy",
              category="stt",
              candidate_text=stt_academic,
              expect=QAScenarioExpect(track="academic_only"),
              **b,
          ),
      )

  if cfg.tool_correction:
      text, idx, rec_any, rec_not = cfg.tool_correction
      scenarios.insert(
          2,
          QAScenario(
              id=f"{p}_tool_correction",
              persona="expert",
              category="tool_correction",
              candidate_text=text,
              memory_setup={"current_topic": bq[idx]},
              expect=QAScenarioExpect(
                  honor_skip_content=True,
                  recommended_contains_any=rec_any,
                  recommended_not_contains=rec_not,
              ),
              **b,
          ),
      )

  scenarios.append(
      QAScenario(
          id=f"{p}_stt_expert",
          persona="stt_noisy",
          category="stt",
          candidate_text=stt_expert,
          expect=QAScenarioExpect(track="experienced"),
          **b,
      ),
  )
  return scenarios


def load_pack_base(fixtures: dict[str, Any], pack_key: str) -> dict[str, Any]:
    p = fixtures["packs"][pack_key]
    return {
        "pack_key": pack_key,
        "position": p["position"],
        "bank_questions": list(p["suggestedAnchorQuestions"]),
        "experience_tracks": list(p["supportedExperienceTracks"]),
        "interview_paths": list(p["interviewPaths"]),
        "terminology": list(p["terminology"]),
    }


def scenarios_for_packs(
    fixtures_path: str,
    pack_configs: dict[str, PackScenarioConfig],
) -> list[QAScenario]:
    import json
    from pathlib import Path

    fixtures = json.loads(Path(fixtures_path).read_text(encoding="utf-8"))
    out: list[QAScenario] = []
    for pack_key, cfg in pack_configs.items():
        base = load_pack_base(fixtures, pack_key)
        out.extend(build_standard_l3_scenarios(base, cfg))
    return out
