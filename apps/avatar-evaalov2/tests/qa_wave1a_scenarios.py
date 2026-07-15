"""Wave 1A QA scorecard scenarios — 13 per L3 pack (10 text + 3 STT-style)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from voice_interview.qa_scorecard import QAScenario, QAScenarioExpect

_FIXTURES_PATH = Path(__file__).resolve().parent / "fixtures" / "wave1a_pack_fixtures.json"


def _load_fixtures() -> dict[str, Any]:
    return json.loads(_FIXTURES_PATH.read_text(encoding="utf-8"))


def _pack(key: str) -> dict[str, Any]:
    packs = _load_fixtures()["packs"]
    if key not in packs:
        raise KeyError(f"missing pack fixture {key}")
    return packs[key]


def _base(pack_key: str) -> dict[str, Any]:
    p = _pack(pack_key)
    return {
        "pack_key": pack_key,
        "position": p["position"],
        "bank_questions": list(p["suggestedAnchorQuestions"]),
        "experience_tracks": list(p["supportedExperienceTracks"]),
        "interview_paths": list(p["interviewPaths"]),
        "terminology": list(p["terminology"]),
    }


def _recruiter_scenarios() -> list[QAScenario]:
    b = _base("hr_recruiter")
    return [
        QAScenario(
            id="rec_greeting_ready",
            persona="entry_level",
            category="greeting",
            candidate_text="اهلا انا جاهز فضلت",
            career_level="entry",
            expect=QAScenarioExpect(
                is_substantive=False,
                allowed_link_empty=True,
            ),
            **b,
        ),
        QAScenario(
            id="rec_skip_linkedin",
            persona="expert",
            category="skip",
            candidate_text="خلينا نغير السؤال. نستخدم LinkedIn و Telegram والإحالات",
            memory_setup={"current_topic": b["bank_questions"][0], "last_sample": b["bank_questions"][0]},
            expect=QAScenarioExpect(
                honor_skip_content=True,
                action="honor_skip_content",
                recommended_contains_any=("LinkedIn", "Telegram", "إحالات"),
            ),
            **b,
        ),
        QAScenario(
            id="rec_clarify",
            persona="general",
            category="clarify",
            candidate_text="بلكت توضحي لي السؤال اكثر",
            memory_setup={
                "current_topic": b["bank_questions"][1],
                "last_sample": b["bank_questions"][1],
            },
            expect=QAScenarioExpect(
                meta_request="clarify_term",
                action="rephrase",
                recommended_contains_any=("مثلاً", "مثال"),
            ),
            **b,
        ),
        QAScenario(
            id="rec_identity",
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
            id="rec_academic",
            persona="academic_only",
            category="track",
            candidate_text="كل شي تعلمته بالجامعة عن HR ومشروع تخرج عن ATS",
            expect=QAScenarioExpect(
                is_substantive=True,
                track="academic_only",
            ),
            **b,
        ),
        QAScenario(
            id="rec_expert",
            persona="expert",
            category="track",
            candidate_text="اشتغلت خمس سنوات بالاستقطاب ومليت أدوار تقنية صعبة عبر LinkedIn",
            expect=QAScenarioExpect(
                is_substantive=True,
                track="experienced",
                action="follow_up",
                recommended_contains_any=("LinkedIn",),
            ),
            **b,
        ),
        QAScenario(
            id="rec_career_switch",
            persona="career_switcher",
            category="track",
            candidate_text="انتقلت من مجال المبيعات للتوظيف قبل سنتين واشتغلت على أدوار تقنية",
            expect=QAScenarioExpect(
                is_substantive=True,
                track="career_switcher",
            ),
            **b,
        ),
        QAScenario(
            id="rec_entry",
            persona="entry_level",
            category="track",
            candidate_text="انا خريج حديث واول وظيفة توظيف لي وتعلمت استخدام ATS",
            expect=QAScenarioExpect(
                is_substantive=True,
                track="entry_level",
            ),
            **b,
        ),
        QAScenario(
            id="rec_rich_metrics",
            persona="expert",
            category="domain",
            candidate_text=(
                "بكل عملية توظيف نتابع time to fill و offer acceptance و source effectiveness "
                "وغيّرنا القناة لما نقصت الجودة"
            ),
            expect=QAScenarioExpect(
                is_substantive=True,
                track="experienced",
            ),
            **b,
        ),
        QAScenario(
            id="rec_path_on_skip",
            persona="expert",
            category="path",
            candidate_text="غير السؤال",
            memory_setup={
                "current_topic": b["bank_questions"][0],
                "active_experience_track": "experienced",
                "path_cursor": 0,
            },
            expect=QAScenarioExpect(
                action="acknowledged_skip",
                recommended_contains_any=("قنوات", "استقطاب", "نوع"),
            ),
            **b,
        ),
        QAScenario(
            id="rec_stt_skip_fragmented",
            persona="stt_noisy",
            category="stt",
            candidate_text="خلينا. غير. السؤال.",
            memory_setup={"current_topic": b["bank_questions"][0]},
            expect=QAScenarioExpect(
                honor_skip_content=False,
                action="acknowledged_skip",
            ),
            **b,
        ),
        QAScenario(
            id="rec_stt_greeting_fragmented",
            persona="stt_noisy",
            category="stt",
            candidate_text="اهلا. وسهلا. انا. جاهز.",
            expect=QAScenarioExpect(
                is_substantive=False,
                allowed_link_empty=True,
            ),
            **b,
        ),
        QAScenario(
            id="rec_stt_hook_noisy",
            persona="stt_noisy",
            category="stt",
            candidate_text="نغير. السؤال. LinkedIn. و. referrals.",
            memory_setup={"current_topic": b["bank_questions"][0]},
            expect=QAScenarioExpect(
                honor_skip_content=True,
                recommended_contains_any=("LinkedIn",),
            ),
            **b,
        ),
    ]


def _petroleum_scenarios() -> list[QAScenario]:
    b = _base("petroleum_engineer")
    return [
        QAScenario(
            id="pet_greeting_ready",
            persona="entry_level",
            category="greeting",
            candidate_text="اهلا انا جاهز",
            career_level="entry",
            expect=QAScenarioExpect(is_substantive=False, allowed_link_empty=True),
            **b,
        ),
        QAScenario(
            id="pet_academic_university",
            persona="academic_only",
            category="track",
            candidate_text="كل شي بالجامعة ومشروع تخرج محاكاة CMG وما عندي خبرة ميدانية",
            expect=QAScenarioExpect(
                is_substantive=True,
                track="academic_only",
            ),
            **b,
        ),
        QAScenario(
            id="pet_field_experienced",
            persona="expert",
            category="track",
            candidate_text=(
                "اشتغلت في حقل مجنون على بئر وراجعت water cut و GOR وسجل الإنتاج "
                "وقررت تعديل معدل الإنتاج بعد تحليل البيانات"
            ),
            memory_setup={"path_cursor": 99},
            expect=QAScenarioExpect(
                is_substantive=True,
                track="experienced",
            ),
            **b,
        ),
        QAScenario(
            id="pet_career_switch",
            persona="career_switcher",
            category="track",
            candidate_text="انتقلت من مجال IT لهندسة البترول واشتغلت سنة على مشاريع نفطية",
            expect=QAScenarioExpect(
                is_substantive=True,
                track="career_switcher",
            ),
            **b,
        ),
        QAScenario(
            id="pet_trainee",
            persona="trainee",
            category="track",
            candidate_text="كنت متدرب بشركة نفط بفترة التدريب",
            expect=QAScenarioExpect(
                is_substantive=True,
                track="trainee",
            ),
            **b,
        ),
        QAScenario(
            id="pet_entry",
            persona="entry_level",
            category="track",
            candidate_text="خريج حديث هندسة بترول واول وظيفة لي بدون خبرة ميدانية بعد",
            expect=QAScenarioExpect(
                is_substantive=True,
                track="entry_level",
            ),
            **b,
        ),
        QAScenario(
            id="pet_clarify",
            persona="general",
            category="clarify",
            candidate_text="وضحي لي السؤال أكثر لو سمحت",
            memory_setup={
                "current_topic": b["bank_questions"][0],
                "last_sample": b["bank_questions"][0],
            },
            expect=QAScenarioExpect(
                meta_request="clarify_term",
                recommended_contains_any=("مثلاً", "مثال"),
            ),
            **b,
        ),
        QAScenario(
            id="pet_identity",
            persona="general",
            category="identity",
            candidate_text="ممكن عرفيني عن نفسك",
            expect=QAScenarioExpect(
                meta_request="ask_interviewer",
                recommended_is_none=True,
                identity_no_question_mark=True,
            ),
            **b,
        ),
        QAScenario(
            id="pet_skip_after_academic",
            persona="academic_only",
            category="skip",
            candidate_text="غير السؤال",
            memory_setup={
                "current_topic": b["bank_questions"][0],
                "active_experience_track": "academic_only",
            },
            expect=QAScenarioExpect(
                action="acknowledged_skip",
                recommended_contains_any=("تخرج", "جامعة", "محاكاة"),
                recommended_not_contains=("بئر", "حقل"),
            ),
            **b,
        ),
        QAScenario(
            id="pet_path_field",
            persona="expert",
            category="path",
            candidate_text="غير السؤال",
            memory_setup={
                "current_topic": b["bank_questions"][0],
                "active_experience_track": "experienced",
                "path_cursor": 0,
            },
            expect=QAScenarioExpect(
                recommended_contains_any=("خبرتك", "أكاديمية", "ميدانية"),
            ),
            **b,
        ),
        QAScenario(
            id="pet_stt_academic_fragmented",
            persona="stt_noisy",
            category="stt",
            candidate_text="بالجامعة. مشروع. تخرج. محاكاة. CMG. ما. عندي. ميدان.",
            expect=QAScenarioExpect(track="academic_only"),
            **b,
        ),
        QAScenario(
            id="pet_stt_skip_fragmented",
            persona="stt_noisy",
            category="stt",
            candidate_text="غير. السؤال. لو. سمحت.",
            memory_setup={"current_topic": b["bank_questions"][0]},
            expect=QAScenarioExpect(action="acknowledged_skip"),
            **b,
        ),
        QAScenario(
            id="pet_stt_field_noisy",
            persona="stt_noisy",
            category="stt",
            candidate_text="اشتغلت. حقل. بئر. water cut.",
            expect=QAScenarioExpect(
                is_substantive=True,
                track="experienced",
            ),
            **b,
        ),
    ]


def _survey_scenarios() -> list[QAScenario]:
    b = _base("survey_engineer")
    return [
        QAScenario(
            id="sur_greeting_ready",
            persona="entry_level",
            category="greeting",
            candidate_text="اهلا جاهز",
            career_level="entry",
            expect=QAScenarioExpect(is_substantive=False, allowed_link_empty=True),
            **b,
        ),
        QAScenario(
            id="sur_gps_not_total_station",
            persona="expert",
            category="tool_correction",
            candidate_text="ممكن نغير السؤال. انا اشتغل على الجي بي اس مو على ستيشن.",
            memory_setup={"current_topic": b["bank_questions"][0]},
            expect=QAScenarioExpect(
                honor_skip_content=True,
                recommended_contains_any=("GPS", "جي بي اس", "GPS"),
                recommended_not_contains=("Total Station",),
            ),
            **b,
        ),
        QAScenario(
            id="sur_academic",
            persona="academic_only",
            category="track",
            candidate_text="مشروع تخرج مساحة بالجامعة بدون خبرة ميدانية",
            expect=QAScenarioExpect(
                is_substantive=True,
                track="academic_only",
            ),
            **b,
        ),
        QAScenario(
            id="sur_expert_gnss",
            persona="expert",
            category="track",
            candidate_text="اشتغلت مشروع RTK و GNSS و Total Station بميدان مسح طبوغرافي",
            expect=QAScenarioExpect(
                is_substantive=True,
                track="experienced",
            ),
            **b,
        ),
        QAScenario(
            id="sur_career_switch",
            persona="career_switcher",
            category="track",
            candidate_text="انتقلت من الهندسة المدنية لهندسة المساحة وهذا تغيير مجال بالنسبة لي",
            expect=QAScenarioExpect(
                is_substantive=True,
                track="career_switcher",
            ),
            **b,
        ),
        QAScenario(
            id="sur_entry",
            persona="entry_level",
            category="track",
            candidate_text="خريج حديث وأول مشروع مسح لي",
            expect=QAScenarioExpect(
                is_substantive=True,
                track="entry_level",
            ),
            **b,
        ),
        QAScenario(
            id="sur_clarify",
            persona="general",
            category="clarify",
            candidate_text="شنو تقصدين بالسؤال بالضبط",
            memory_setup={
                "current_topic": b["bank_questions"][1],
                "last_sample": b["bank_questions"][1],
            },
            expect=QAScenarioExpect(
                meta_request="clarify_term",
                recommended_contains_any=("مثلاً", "مثال"),
            ),
            **b,
        ),
        QAScenario(
            id="sur_identity",
            persona="general",
            category="identity",
            candidate_text="تعرفيني على نفسك",
            expect=QAScenarioExpect(
                meta_request="ask_interviewer",
                recommended_is_none=True,
                identity_no_question_mark=True,
            ),
            **b,
        ),
        QAScenario(
            id="sur_path_skip",
            persona="expert",
            category="path",
            candidate_text="غير السؤال",
            memory_setup={
                "current_topic": b["bank_questions"][0],
                "active_experience_track": "experienced",
                "path_cursor": 0,
            },
            expect=QAScenarioExpect(
                recommended_contains_any=("مسح", "مشروع", "نوع"),
            ),
            **b,
        ),
        QAScenario(
            id="sur_rich_gps_followup",
            persona="expert",
            category="domain",
            candidate_text=(
                "استخدمنا GPS و RTK بمشروع رفع طبوغرافي كبير وراجعنا دقة الإحداثيات "
                "قبل التسليم للعميل"
            ),
            memory_setup={"path_cursor": 99, "active_experience_track": "experienced"},
            expect=QAScenarioExpect(
                is_substantive=True,
                action="follow_up",
                recommended_contains_any=("GPS", "RTK"),
            ),
            **b,
        ),
        QAScenario(
            id="sur_stt_gps_correction",
            persona="stt_noisy",
            category="stt",
            candidate_text="نغير. السؤال. اشتغل. GPS. مو. ستيشن.",
            memory_setup={"current_topic": b["bank_questions"][1]},
            expect=QAScenarioExpect(
                is_substantive=True,
                honor_skip_content=True,
            ),
            **b,
        ),
        QAScenario(
            id="sur_stt_skip_fragmented",
            persona="stt_noisy",
            category="stt",
            candidate_text="خلينا. نغير. السؤال.",
            memory_setup={"current_topic": b["bank_questions"][0]},
            expect=QAScenarioExpect(action="acknowledged_skip"),
            **b,
        ),
        QAScenario(
            id="sur_stt_greeting_noisy",
            persona="stt_noisy",
            category="stt",
            candidate_text="اهلا. انا. جاهز. فضلت.",
            expect=QAScenarioExpect(is_substantive=False),
            **b,
        ),
    ]


def all_wave1a_scenarios() -> list[QAScenario]:
    return [
        *_recruiter_scenarios(),
        *_petroleum_scenarios(),
        *_survey_scenarios(),
    ]


WAVE1A_QA_SCENARIOS: list[QAScenario] = all_wave1a_scenarios()
