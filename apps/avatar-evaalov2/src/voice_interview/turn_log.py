"""Per-turn interview telemetry that survives the session.

WHY THIS EXISTS
---------------
The 2026-09-23 HSE interview could not be diagnosed after the fact, and the
reason was not a missing metric — it was a missing *destination*. Everything the
agent knows is written to the ``agent`` logger, which lands in LiveKit Cloud,
where ``lk agent logs`` is tail-only with no time range. Hours later the run is
simply gone. Two specific questions were unanswerable as a result:

* Which competency was the agent *intending* to ask on each turn? The picker
  marks a competency "asked" the moment it hands text to the LLM, but the LLM
  then rephrases it — so a competency can be recorded as covered while the
  candidate heard something else entirely. Intent and speech diverge invisibly.
* Why did ``_pick_result_followup`` never fire across ten questions? It is a
  deterministic rule with five distinct early-exits, and the transcript alone
  cannot tell them apart.

So this module does NOT add new measurement. It takes what the assistant already
computes and ships it somewhere durable: the agent publishes each record on the
LiveKit data channel, the browser forwards it on its existing heartbeat, and the
backend stores it on the session document next to the transcript.

STRICTLY OBSERVATIONAL
----------------------
Nothing here may change a question, a phrasing, or a picker decision. Every
failure path is swallowed: telemetry must never be able to break an interview.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
from typing import Any

logger = logging.getLogger("agent")

#: Data-channel topic the browser listens on. Deliberately NOT one of the
#: substrings the frontend's DataReceived handler already ignores
#: ("transcript" / "user" / "agent"), so it cannot be mistaken for a transcript.
TURN_LOG_TOPIC = "evaalo.turnlog"

#: A single record is small (<1 KB), but a pathological question could be long.
#: LiveKit data packets are capped ~15 KiB; stay well under and truncate loudly.
_MAX_TEXT = 600


def turn_log_enabled() -> bool:
    """On by default. Set ``INTERVIEW_TURN_LOG=false`` to silence it entirely."""
    raw = (os.getenv("INTERVIEW_TURN_LOG") or "true").strip().lower()
    return raw in ("1", "true", "yes", "on")


def _clip(value: Any, limit: int = _MAX_TEXT) -> str:
    text = str(value or "").strip()
    return text if len(text) <= limit else f"{text[:limit]}…"


def build_record(
    *,
    turn_index: int,
    plan: Any,
    spoken_text: str,
    question_text: str,
    opener_assigned: str,
    opener_used: str,
    diag: dict[str, Any] | None,
    followup_skip_reason: str,
    competency_budget: dict[str, int] | None,
    asked_competency_keys: Any,
    guard_swap: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Flatten one agent turn into a JSON-safe record.

    ``plan.competency_key`` is the whole point: it is the competency the picker
    INTENDED, before the LLM rephrased anything. Comparing it against what the
    transcript actually contains is what separates "this competency was never
    asked" from "it was asked but the wording lost the subject".

    ``guardSwap`` is set when the reply guard threw the model's question away
    («to»: bank_anchor / competency / bridge, and why). A competency swap
    installs a new plan, so ``competencyKey`` then names the REPLACEMENT and
    ``guardSwap.fromCompetency`` keeps the picker's original intent.
    """
    d = diag or {}
    g = guard_swap or {}
    source = getattr(plan, "source", "") or ""
    competency_key = getattr(plan, "competency_key", "") or ""
    return {
        "turnIndex": int(turn_index),
        "competencyKey": competency_key,
        "planSource": source,
        "responseMode": getattr(plan, "response_mode", "") or "",
        "followupType": getattr(plan, "followup_type", "") or "",
        # What the picker handed the model, vs what was actually spoken. A gap
        # between these two IS the finding, not noise around it.
        "plannedQuestion": _clip(getattr(plan, "question", "")),
        "spokenQuestion": _clip(question_text),
        "spokenText": _clip(spoken_text),
        "openerAssigned": _clip(opener_assigned, 40),
        "openerUsed": _clip(opener_used, 40),
        # Exactly the three flags `_pick_result_followup` branches on, plus the
        # reason it bailed. Together these decide hypothesis F2 in the plan.
        "diag": {
            "isSubstantiveAnswer": bool(d.get("is_substantive_answer")),
            "mentionsResult": bool(d.get("mentions_result")),
            "isShallow": bool(d.get("is_shallow")),
            "isRichAnswer": bool(d.get("is_rich_answer")),
            "suggestFollowup": bool(d.get("suggest_followup")),
            "isTopicChangeRequest": bool(d.get("is_topic_change_request")),
        },
        "followupFired": source
        in (
            "result_followup",
            "hook_followup",
            "competency_followup",
            "entity_followup",
        ),
        "followupSkipReason": _clip(followup_skip_reason, 60),
        "competencyBudgetSpent": dict(competency_budget or {}),
        "askedCompetencyCount": len(asked_competency_keys or ()),
        "guardSwap": (
            {
                "to": _clip(g.get("to"), 40),
                "reason": _clip(g.get("reason"), 40),
                "fromCompetency": _clip(g.get("fromCompetency"), 80),
                "fromQuestion": _clip(g.get("fromQuestion")),
                "toCompetency": _clip(g.get("toCompetency"), 80),
                # Set only when P4 found nothing to swap in: each competency it
                # excluded and why («key=covered», «key=asked», …).
                "p4Excluded": _clip(g.get("p4Excluded")),
            }
            if g
            else None
        ),
        "kind": "turn",
    }


#: Sentinel turn index for the single end-of-interview record, so it dedupes
#: against itself and never collides with a real turn.
END_RECORD_TURN_INDEX = -1


def build_end_record(
    *,
    trigger: str,
    wrap_up_trigger: str,
    questions_asked: int,
    asked_competency_keys: Any,
    total_competencies: int,
    final_closing_sent: bool,
    wrap_up_offered: bool,
    turn_index: int,
) -> dict[str, Any]:
    """Who ended the interview, and on which rule.

    ``endedBy`` on the session already separates ``page_hide`` / ``user_action``
    / ``room_disconnect``, but all three describe the BROWSER. None of them say
    whether the agent decided to stop, and if so on which rule — the model
    calling ``end_interview`` on its own judgement, or the reply-guard's
    wrap-up, and whether that wrap-up came from the 20-question hard cap or from
    running out of fresh questions at the 10-question floor. The 2026-09-23
    interview stopped at question 11 of 20 and all three remained possible.

    The ABSENCE of this record is itself an answer: it means the agent never
    concluded and the interview was cut from the candidate's side.
    """
    return {
        "turnIndex": END_RECORD_TURN_INDEX,
        "kind": "end",
        # "agent_tool" = the model chose to stop; "wrap_up_guard" = deterministic
        # closing; worker-level reasons (time limit, avatar failure) name themselves.
        "endTrigger": _clip(trigger, 60),
        # Which guard offered the wrap-up: "hard_question_cap" (20) or
        # "no_fresh_anchor" (>=10 and nothing left to ask).
        "wrapUpTrigger": _clip(wrap_up_trigger, 60),
        "wrapUpOffered": bool(wrap_up_offered),
        "finalClosingSent": bool(final_closing_sent),
        "questionsAsked": int(questions_asked),
        "askedCompetencyCount": len(asked_competency_keys or ()),
        "totalCompetencies": int(total_competencies),
        "endTurnIndex": int(turn_index),
    }


class TurnLogSink:
    """Publishes turn records to the room, and keeps a copy for the summary.

    The copy matters: if the data channel is down, or the browser tab died, the
    records still reach the agent's own shutdown summary. A degraded channel
    costs fidelity, never the whole log.
    """

    def __init__(self, ctx: Any) -> None:
        self._ctx = ctx
        self._records: list[dict[str, Any]] = []
        self._next_seq = 0
        self._publish_failures = 0
        #: Strong refs to in-flight publish tasks (see ``_publish``).
        self._pending: set[Any] = set()

    @property
    def records(self) -> list[dict[str, Any]]:
        return list(self._records)

    def emit_end(self, record: dict[str, Any]) -> None:
        """Record and publish the end-of-interview record. Never raises.

        At most ONE end record is ever kept: two teardown routes can both fire
        (the model calls ``end_interview`` while the guard has already scheduled
        a conclude), and the first route is the true one. The assistant enforces
        the same with ``_end_record_sent``; this is the second lock.
        """
        if any(r.get("kind") == "end" for r in self._records):
            return
        self.emit(record)

    def emit(self, record: dict[str, Any]) -> None:
        """Record and publish one agent utterance. Never raises.

        ⚠️ APPEND-ONLY, identified by ``seq`` — never de-duplicated by
        ``turnIndex``. The first version keyed records on ``(kind, turnIndex)``
        to absorb a feared "record_agent_reply runs twice per turn", and the live
        check against the deployed agent on 2026-09-23 showed why that was wrong:
        three distinct utterances all carried ``turnIndex: 0`` and would have
        collapsed into ONE stored record. ``turn_index`` only advances inside
        ``on_user_turn_completed``, so any two utterances without a completed user
        turn between them share it. The same run showed no double-emit at all
        (3 utterances → 3 emits). For telemetry a duplicate is recoverable at
        analysis time; a silent overwrite is not.
        """
        try:
            record["seq"] = self._next_seq
            self._next_seq += 1
            self._records.append(record)

            if record.get("kind") == "end":
                logger.info(
                    "[turn-log] END trigger=%s wrapUp=%s questions=%s competencies=%s/%s closing=%s",
                    record.get("endTrigger") or "-",
                    record.get("wrapUpTrigger") or "-",
                    record.get("questionsAsked"),
                    record.get("askedCompetencyCount"),
                    record.get("totalCompetencies"),
                    record.get("finalClosingSent"),
                )
                self._publish(record)
                return

            swap = record.get("guardSwap") or {}
            logger.info(
                "[turn-log] turn=%s competency=%s source=%s followup=%s skip=%s opener=%s/%s swap=%s",
                record.get("turnIndex"),
                record.get("competencyKey") or "-",
                record.get("planSource") or "-",
                record.get("followupFired"),
                record.get("followupSkipReason") or "-",
                record.get("openerAssigned") or "-",
                record.get("openerUsed") or "-",
                f"{swap.get('to')}:{swap.get('fromCompetency') or '-'}"
                if swap
                else "-",
            )
            self._publish(record)
        except Exception as e:  # pragma: no cover - telemetry must never break a turn
            logger.debug("[turn-log] emit failed: %s", e)

    def _publish(self, record: dict[str, Any]) -> None:
        room = getattr(self._ctx, "room", None)
        local = getattr(room, "local_participant", None)
        if local is None:
            return
        try:
            payload = json.dumps(record, ensure_ascii=False).encode("utf-8")
        except Exception as e:
            logger.debug("[turn-log] serialize failed: %s", e)
            return

        async def _send() -> None:
            try:
                await local.publish_data(payload, topic=TURN_LOG_TOPIC, reliable=True)
            except Exception as e:
                self._publish_failures += 1
                # Only the first failure is worth a line; a dead channel would
                # otherwise log once per turn for the whole interview.
                if self._publish_failures == 1:
                    logger.warning(
                        "[turn-log] publish failed (further failures silent): %s", e
                    )

        # No running loop (unit tests / sync context): the in-memory copy is
        # still kept, which is all the tests need.
        with contextlib.suppress(RuntimeError):
            task = asyncio.get_running_loop().create_task(_send())
            # asyncio keeps only a WEAK reference to a running task, so a task
            # nobody holds can be garbage-collected mid-flight and the record is
            # silently lost. Hold it until it finishes, then drop it — otherwise
            # the set is the leak instead.
            self._pending.add(task)
            task.add_done_callback(self._pending.discard)


def make_sink(ctx: Any) -> TurnLogSink | None:
    """Build a sink, or ``None`` when the feature is switched off."""
    if not turn_log_enabled():
        logger.info("[turn-log] disabled via INTERVIEW_TURN_LOG")
        return None
    return TurnLogSink(ctx)
