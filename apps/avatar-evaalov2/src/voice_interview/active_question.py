"""Active question state — one open question at a time (P0.5 / P0.6)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from voice_interview.assistant import InterviewMemory

# Lifecycle statuses for the single open question.
STATUS_IDLE = "idle"
STATUS_AWAITING_ANSWER = "awaiting_answer"
STATUS_CLARIFYING = "clarifying"
STATUS_ANSWERING = "answering"
STATUS_ANSWERED = "answered"
STATUS_REJECTED = "rejected"
STATUS_DEFERRED = "deferred"

OPEN_STATUSES = frozenset(
    {STATUS_AWAITING_ANSWER, STATUS_CLARIFYING, STATUS_ANSWERING, STATUS_DEFERRED}
)

# How the agent should shape its outgoing turn.
MODE_ASK = "ask"
MODE_CLARIFY = "clarify"
MODE_WAIT = "wait_for_completion"
MODE_ACKNOWLEDGE = "acknowledge"
MODE_RESUME = "resume"
MODE_FOLLOW_UP = "follow_up_on_active"
MODE_GUIDANCE = "offer_guidance"

_QUESTION_MARK_RE = re.compile(r"[?؟]")
_MULTI_Q_CONNECTOR_RE = re.compile(
    r"\s+(?:و|وشلون|وكيف|وهل|ثم|also|and how|and what)\s+",
    re.IGNORECASE,
)


@dataclass
class TurnPlan:
    """Internal plan for one agent turn — committed only after final TTS text."""

    question: str | None = None
    question_id: str | None = None
    parent_question_id: str | None = None
    step_key: str | None = None
    path_key: str | None = None
    competency_key: str | None = None
    cluster_key: str | None = None
    source: str = ""
    response_mode: str = MODE_ASK
    clarify_fallback: str | None = None
    clarify_source: str = ""
    advance_path_on_send: bool = False
    followup_type: str | None = None


def is_open_status(status: str) -> bool:
    return (status or "").strip() in OPEN_STATUSES


def make_path_question_id(pack_key: str, path_key: str, step_key: str) -> str:
    return f"{pack_key}:path:{path_key}:step:{step_key}"


def make_bank_question_id(pack_key: str, anchor_id: str) -> str:
    return f"{pack_key}:bank:anchor:{anchor_id}"


def make_followup_question_id(
    pack_key: str, parent_question_id: str, followup_type: str
) -> str:
    return f"{pack_key}:followup:{parent_question_id}:{followup_type}"


def count_question_marks(text: str) -> int:
    if not text:
        return 0
    return len(_QUESTION_MARK_RE.findall(text))


def extract_primary_question(text: str) -> str:
    """Best-effort single question from agent text."""
    raw = (text or "").strip()
    if not raw:
        return ""
    for sep in ("؟", "?"):
        if sep in raw:
            idx = raw.index(sep)
            return raw[: idx + 1].strip()
    return raw


def _planned_single_question(plan: TurnPlan | None) -> str:
    if not plan:
        return ""
    return (plan.clarify_fallback or plan.question or "").strip()


def _brief_ack_before_question(raw: str, question: str) -> str:
    """Keep a short acknowledgement before the single planned question."""
    if not question:
        return raw
    q_pos = -1
    for sep in ("؟", "?"):
        idx = raw.find(sep)
        if idx >= 0 and (q_pos < 0 or idx < q_pos):
            q_pos = idx
    if q_pos <= 0:
        return question
    prefix = raw[:q_pos].strip()
    if not prefix or count_question_marks(prefix) > 0:
        return question
    if len(prefix) > 160:
        return question
    return f"{prefix} {question}".strip()


def enforce_single_question_response(text: str, plan: TurnPlan | None) -> str:
    """Final TTS guard — keep exactly one question mark in agent output."""
    raw = (text or "").strip()
    if not raw:
        return raw

    mode = (plan.response_mode if plan else None) or MODE_ASK
    if mode in (MODE_WAIT, MODE_ACKNOWLEDGE, MODE_RESUME):
        return _QUESTION_MARK_RE.sub("", raw).strip() or raw

    if mode == MODE_GUIDANCE:
        n = count_question_marks(raw)
        if n <= 1:
            return raw
        planned = _planned_single_question(plan)
        if planned and count_question_marks(planned) <= 1:
            return planned
        return extract_primary_question(raw) or raw

    planned = _planned_single_question(plan)
    n = count_question_marks(raw)

    if n <= 1 and not _MULTI_Q_CONNECTOR_RE.search(raw):
        return raw

    if planned and count_question_marks(planned) <= 1:
        if mode == MODE_CLARIFY:
            return _brief_ack_before_question(raw, planned)
        return planned

    first = extract_primary_question(raw)
    if first and count_question_marks(first) == 1:
        return first

    if planned:
        return planned

    return first or raw


def close_question_on_memory(
    mem: InterviewMemory,
    question_id: str,
    closure: str,
    *,
    step_key: str = "",
    cluster_key: str = "",
    increment_evidence: bool = False,
) -> None:
    """Record answered / rejected / skipped closure on InterviewMemory."""
    qid = (question_id or "").strip()
    if not qid:
        return
    mem.closed_question_ids.add(qid)
    if closure == "answered":
        mem.answered_question_ids.add(qid)
        sk = (step_key or "").strip()
        if sk:
            mem.completed_step_keys.add(sk)
        ck = (cluster_key or "").strip()
        if increment_evidence and ck:
            mem.cluster_evidence_counts[ck] = mem.cluster_evidence_counts.get(ck, 0) + 1
            if mem.cluster_evidence_counts[ck] >= 2:
                mem.covered_cluster_keys.add(ck)
    elif closure == "rejected":
        mem.rejected_question_ids.add(qid)
    elif closure == "skipped":
        mem.skipped_question_ids.add(qid)
