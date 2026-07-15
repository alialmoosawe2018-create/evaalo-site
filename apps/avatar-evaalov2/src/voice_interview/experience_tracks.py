"""Experience track + interview path selection (data-driven — no per-role Python branches)."""

from __future__ import annotations

from typing import Any

from voice_interview.entity_policy import collapse_to_single_question
from voice_interview.heuristics import normalize_text

ExperienceTrackKey = str

# Universal STT signals — used when pack tracks are absent (L1/L2) or merged with pack signals.
UNIVERSAL_DETECT_SIGNALS: dict[str, tuple[str, ...]] = {
    "academic_only": (
        "جامعة",
        "تخرج",
        "مشروع تخرج",
        "اكاديمي",
        "اكاديميه",
        "نظري",
        "نظرية",
        "ما عندي خبرة ميدانية",
        "ما اشتغلت ميدان",
        "بالجامعة",
        "كل شي بالجامعة",
        "كل شيء بالجامعة",
        "university",
        "thesis",
        "graduation project",
        "academic",
        "simulation only",
        "no field",
        "classroom",
        "cmg",
        "eclipse",
        "petrel",
    ),
    "trainee": (
        "تدريب",
        "متدرب",
        "فترة تدريب",
        "تدريبي",
        "internship",
        "intern",
        "trainee",
        "co op",
        "co-op",
    ),
    "entry_level": (
        "خريج",
        "حديث تخرج",
        "طالب",
        "fresh graduate",
        "entry level",
        "first job",
        "ما عندي خبرة",
        "no experience",
    ),
    "experienced": (
        "اشتغلت",
        "بالموقع",
        "ميدان",
        "حقل",
        "بئر",
        "field",
        "site",
        "on site",
        "years of",
        "سنوات",
        "سنه",
        "سنة",
    ),
    "senior": (
        "قادت",
        "ادارة",
        "manager",
        "senior",
        "lead",
        "supervisor",
        "كبير",
        "اربع سنوات",
        "خمس سنوات",
        "عشر سنوات",
    ),
    "career_switcher": (
        "غيرت مجال",
        "من مجال",
        "انتقلت",
        "career change",
        "switch",
        "switched from",
        "كانوا",
        "قبل ما",
    ),
}

UNIVERSAL_OPENING_ANCHORS: dict[str, tuple[str, ...]] = {
    "academic_only": (
        "اذكرلي مشروع تخرج أو محاكاة سويتها — شنو كان الموضوع وشنو تعلمت منه؟",
        "شنو أصعب مفهوم درسته بالجامعة وطبّقته بمثال نظري أو محاكاة؟",
        "شلون استخدمت بيانات أو نماذج أكاديمية لفهم مشكلة إنتاج أو هندسية؟",
    ),
    "trainee": (
        "اذكرلي شنو شفت وشنو تعلمت بفترة التدريب — شنو كان دورك بالفريق؟",
        "شنو أهم مهارة أو أداة تعرّفت عليها بالتدريب وكيف استخدمتها؟",
        "شلون تعاملت وية موقف صعب شفته بالموقع وأنت متدرب؟",
    ),
    "entry_level": (
        "اذكرلي أول مشروع أو مهمة اشتغلت عليها بعد التخرج — شنو سويت؟",
        "شنو أهم شي تعلمته بأول سنة شغل لك؟",
        "شلون تطلب المساعدة أو تتأكد إن شغلك صحيح وأنت لسه مبتدئ؟",
    ),
    "experienced": (),
    "senior": (
        "اذكرلي قرار تشغيلي أو فني مهم قدته — شنو كان التأثير على الفريق أو الإنتاج؟",
        "شلون توازن بين السلامة والإنتاجية بموقف ضاغط؟",
        "شنو استراتيجية اتبعتها لتحسين أداء فريق أو عملية؟",
    ),
    "career_switcher": (
        "ليش قررت تنتقل لهذا المجال وشنو نقلته من شغلك السابق؟",
        "شنو أصعب فرق لاحظته بين مجالك السابق وهذا الدور؟",
        "شلون بنيت مصداقيتك بمهارة جديدة بدون خبرة طويلة بالمجال؟",
    ),
}

_TRACK_PRIORITY: tuple[str, ...] = (
    "academic_only",
    "career_switcher",
    "trainee",
    "entry_level",
    "senior",
    "experienced",
)


def _default_universal_tracks() -> list[dict[str, Any]]:
    return [
        {"trackKey": key, "detectSignals": list(signals)}
        for key, signals in UNIVERSAL_DETECT_SIGNALS.items()
    ]


def merge_track_signals(track: dict[str, Any]) -> tuple[str, ...]:
    key = str(track.get("trackKey") or "").strip()
    custom = tuple(
        str(s).strip() for s in (track.get("detectSignals") or []) if str(s).strip()
    )
    universal = UNIVERSAL_DETECT_SIGNALS.get(key, ())
    return tuple(dict.fromkeys([*custom, *universal]))


def score_track(norm: str, track: dict[str, Any]) -> int:
    if not norm:
        return 0
    signals = merge_track_signals(track)
    return sum(1 for s in signals if normalize_text(s) in norm)


def default_track_for_career_level(career_level: str) -> str:
    cl = normalize_text(career_level)
    if cl in ("entry", "junior", "intern", "graduate", "fresh"):
        return "entry_level"
    if cl in ("senior", "lead", "principal", "manager", "director", "executive"):
        return "senior"
    return "experienced"


def detect_experience_track(
    text: str,
    tracks: list[dict[str, Any]] | None,
    *,
    current_track: str = "",
    career_level: str = "",
    session_snippets: list[str] | None = None,
) -> str:
    """Infer experience track from candidate speech (sticky unless a stronger signal appears)."""
    parts = [text, *(session_snippets or [])]
    norm = normalize_text(" ".join(p for p in parts if p))
    catalog = list(tracks) if tracks else _default_universal_tracks()

    scored: list[tuple[str, int]] = []
    for track in catalog:
        key = str(track.get("trackKey") or "").strip()
        if not key:
            continue
        scored.append((key, score_track(norm, track)))

    def _prio(key: str) -> int:
        try:
            return _TRACK_PRIORITY.index(key)
        except ValueError:
            return 99

    scored.sort(key=lambda x: (-x[1], _prio(x[0])))

    if scored and scored[0][1] >= 2:
        return scored[0][0]
    if scored and scored[0][1] == 1:
        if not current_track:
            return scored[0][0]
        if scored[0][0] == current_track:
            return current_track
        # Single weak signal — switch for academic fairness (university-only candidates).
        if scored[0][0] == "academic_only":
            return "academic_only"
        return current_track
    if current_track:
        return current_track
    return default_track_for_career_level(career_level)


def get_track_spec(tracks: list[dict[str, Any]], track_key: str) -> dict[str, Any] | None:
    for track in tracks:
        if str(track.get("trackKey") or "") == track_key:
            return track
    return None


def track_question_difficulty(
    track_key: str,
    tracks: list[dict[str, Any]] | None,
) -> int | None:
    if not tracks or not track_key:
        return None
    spec = get_track_spec(tracks, track_key)
    if not spec:
        return None
    raw = spec.get("questionDifficulty")
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return None
    return max(1, min(3, n))


def pick_track_opening_anchor(
    track_key: str,
    tracks: list[dict[str, Any]] | None,
    *,
    cursor: int = 0,
    asked_keys: set[str],
) -> tuple[str | None, int]:
    anchors: list[str] = []
    if tracks:
        spec = get_track_spec(tracks, track_key)
        if spec:
            anchors = [
                str(a).strip()
                for a in (spec.get("openingAnchors") or [])
                if str(a).strip()
            ]
    if not anchors:
        anchors = list(UNIVERSAL_OPENING_ANCHORS.get(track_key, ()))
    if not anchors:
        return None, cursor

    idx = max(0, cursor)
    while idx < len(anchors):
        q = collapse_to_single_question(anchors[idx])
        key = normalize_text(q)
        idx += 1
        if key and key not in asked_keys:
            return q, idx
    return None, idx


def resolve_interview_path(
    paths: list[dict[str, Any]] | None,
    track_key: str,
) -> dict[str, Any] | None:
    if not paths:
        return None
    for path in paths:
        path_key = str(path.get("pathKey") or "")
        if track_key and track_key in path_key:
            return path
    return paths[0]


def peek_path_step_question(
    paths: list[dict[str, Any]] | None,
    track_key: str,
    path_cursor: int,
    asked_keys: set[str],
) -> str | None:
    q, _, _, _ = peek_path_step_detail(paths, track_key, path_cursor, asked_keys)
    return q


def _step_cluster_key(pack_key: str, step: dict[str, Any]) -> str | None:
    step_key = str(step.get("stepKey") or "").strip()
    comp_key = str(step.get("competencyKey") or step_key or "").strip()
    raw_cluster = str(step.get("clusterKey") or "").strip()
    if raw_cluster:
        return raw_cluster
    for key in (step_key, comp_key):
        cluster = resolve_competency_cluster(pack_key, key)
        if cluster:
            return cluster
    return step_key or comp_key or None


def pick_distant_step(
    pack_key: str,
    paths: list[dict[str, Any]] | None,
    track_key: str,
    *,
    rejected_step_keys: set[str],
    rejected_cluster_keys: set[str],
    completed_step_keys: set[str],
    asked_competency_keys: set[str],
    current_cluster_key: str | None,
    asked_question_keys: set[str],
    closed_question_ids: set[str] | None = None,
    pack_key_for_ids: str | None = None,
    path_key_for_ids: str | None = None,
) -> tuple[str | None, str | None, str | None, str | None]:
    """Pick a path step far from rejected clusters — data-driven skip jump."""
    path = resolve_interview_path(paths, track_key)
    if not path:
        return None, None, None, None
    pack = (pack_key or "").strip().lower()
    path_key = path_key_for_ids or str(path.get("pathKey") or "").strip()
    closed_ids = closed_question_ids or set()
    steps = path.get("steps") or []
    if not isinstance(steps, list):
        return None, None, None, None

    best: tuple[str, str, str, str, int] | None = None
    for i, step in enumerate(steps):
        if not isinstance(step, dict):
            continue
        step_key = str(step.get("stepKey") or "").strip()
        comp_key = str(step.get("competencyKey") or step_key or "").strip()
        cluster_key = _step_cluster_key(pack, step) or ""
        q = str(step.get("sampleQuestion") or "").strip()
        if not q or not step_key:
            continue
        single = collapse_to_single_question(q)
        q_key = normalize_text(single)
        if not q_key or q_key in asked_question_keys:
            continue
        id_pack = (pack_key_for_ids or pack_key or pack).strip()
        if id_pack and path_key and step_key:
            stable_id = f"{id_pack}:path:{path_key}:step:{step_key}"
            if stable_id in closed_ids:
                continue
        if step_key in rejected_step_keys or step_key in completed_step_keys:
            continue
        if cluster_key and cluster_key in rejected_cluster_keys:
            continue
        if current_cluster_key and cluster_key == current_cluster_key:
            continue
        if comp_key and comp_key in asked_competency_keys:
            continue
        if _cluster_is_rejected(pack, comp_key or step_key, rejected_cluster_keys):
            continue
        if best is None or i < best[4]:
            best = (single, step_key, comp_key, cluster_key, i)

    if not best:
        return None, None, None, None
    return best[0], best[1], best[2], best[3]


def peek_path_step_detail(
    paths: list[dict[str, Any]] | None,
    track_key: str,
    path_cursor: int,
    asked_keys: set[str],
    *,
    closed_question_ids: set[str] | None = None,
    completed_step_keys: set[str] | None = None,
    rejected_cluster_keys: set[str] | None = None,
    covered_cluster_keys: set[str] | None = None,
    pack_key: str = "",
) -> tuple[str | None, str | None, str | None, str | None]:
    """Return (question, step_key, competency_key, cluster_key) for the next eligible path step."""
    path = resolve_interview_path(paths, track_key)
    if not path:
        return None, None, None, None
    steps = path.get("steps") or []
    if not isinstance(steps, list):
        return None, None, None, None
    closed_ids = closed_question_ids or set()
    completed = completed_step_keys or set()
    rejected_clusters = rejected_cluster_keys or set()
    covered = covered_cluster_keys or set()
    path_key = str(path.get("pathKey") or "").strip()
    pack = (pack_key or "").strip().lower()
    idx = max(0, path_cursor)
    while idx < len(steps):
        step = steps[idx]
        idx += 1
        if not isinstance(step, dict):
            continue
        step_key = str(step.get("stepKey") or "").strip()
        if step_key and step_key in completed:
            continue
        q = str(step.get("sampleQuestion") or "").strip()
        if not q:
            continue
        single = collapse_to_single_question(q)
        key = normalize_text(single)
        if key and key in asked_keys:
            continue
        comp_key = str(step.get("competencyKey") or step_key or "").strip() or None
        cluster_key = _step_cluster_key(pack, step) if pack else (
            str(step.get("clusterKey") or step_key or comp_key or "").strip() or None
        )
        if cluster_key and cluster_key in rejected_clusters:
            continue
        if cluster_key and cluster_key in covered:
            continue
        if pack and path_key and step_key:
            stable_id = f"{pack}:path:{path_key}:step:{step_key}"
            if stable_id in closed_ids:
                continue
        return single, step_key, comp_key, cluster_key
    return None, None, None, None


def parse_experience_tracks(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw[:8]:
        if not isinstance(item, dict):
            continue
        key = str(item.get("trackKey") or "").strip()
        if not key:
            continue
        out.append(item)
    return out


def parse_interview_paths(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw[:4]:
        if not isinstance(item, dict):
            continue
        path_key = str(item.get("pathKey") or "").strip()
        steps = item.get("steps")
        if not path_key or not isinstance(steps, list) or not steps:
            continue
        out.append(item)
    return out


# Maps pack → clusterKey → member step/competency keys (for skip rejection).
COMPETENCY_STEP_CLUSTERS: dict[str, dict[str, frozenset[str]]] = {
    "petroleum_engineer": {
        "star_project_chain": frozenset(
            {
                "project_example",
                "data_reviewed",
                "problem",
                "analysis",
                "action",
                "result",
                "field_data_analysis",
                "reservoir_fundamentals",
                "production_operations",
            }
        ),
        "simulation_and_tools": frozenset(
            {"simulation_and_tools", "graduation_project", "simulation_data", "findings"}
        ),
        "hse_field_safety": frozenset({"hse_field_safety"}),
        "technical_communication": frozenset({"technical_communication"}),
        "experience_mode": frozenset({"experience_mode", "background"}),
    },
    "hr_recruiter": {
        "sourcing": frozenset(
            {
                "sourcing",
                "sourcing_channels",
                "channel_quality",
                "channel_strategy",
                "sourcing_strategy",
            }
        ),
        "screening": frozenset(
            {"screening", "candidate_screening", "structured_evaluation"}
        ),
        "manager_intake": frozenset(
            {
                "manager_alignment",
                "intake",
                "requirements",
                "role_intake_alignment",
            }
        ),
        "difficult_role": frozenset({"difficult_role", "hard_to_fill_roles"}),
        "candidate_experience": frozenset({"candidate_experience", "experience"}),
        "metrics": frozenset({"metrics", "recruiting_metrics"}),
        "background": frozenset({"background"}),
        "structured_interview": frozenset({"structured_interview"}),
    },
}

# Neighboring clusters for tier-2 skip rejection (P0.6-2).
CLUSTER_NEIGHBORS: dict[str, dict[str, frozenset[str]]] = {
    "hr_recruiter": {
        "sourcing": frozenset({"screening", "manager_intake", "channel_quality"}),
        "screening": frozenset({"sourcing", "metrics", "manager_intake"}),
        "manager_intake": frozenset({"sourcing", "screening", "difficult_role"}),
        "difficult_role": frozenset({"manager_intake", "sourcing"}),
        "candidate_experience": frozenset({"screening", "metrics"}),
        "metrics": frozenset({"screening", "sourcing"}),
        "experience": frozenset({"screening", "metrics"}),
    },
}


def build_skip_rejection_clusters(
    pack_key: str,
    current_cluster_key: str | None,
    skip_count: int,
) -> set[str]:
    """First skip: no cluster ban. Second+ skip in same area: current + neighbors."""
    if skip_count < 2:
        return set()
    cluster = (current_cluster_key or "").strip()
    if not cluster:
        return set()
    pack = (pack_key or "").strip().lower()
    neighbors = CLUSTER_NEIGHBORS.get(pack, {}).get(cluster, frozenset())
    return {cluster, *neighbors}

# Fallback competency questions when skipping (pack-specific).
COMPETENCY_JUMP_QUESTIONS: dict[str, dict[str, str]] = {
    "petroleum_engineer": {
        "simulation_and_tools": (
            "خلينا نغير للمفاهيم والأدوات: أي برنامج محاكاة استخدمت — CMG أو Eclipse أو Petrel — "
            "وشنو كان الهدف؟"
        ),
        "reservoir_fundamentals": (
            "خلينا نغير للمفاهيم الأساسية: شنو البيانات اللي تتوقع تكون مهمة حتى نفهم أداء بئر نفطي؟"
        ),
        "hse_field_safety": (
            "خلينا نغير لموضوع السلامة: اذكرلي موقف وازنت فيه بين إجراءات HSE وضغط الإنتاج؟"
        ),
        "production_operations": (
            "خلينا نغير أكثر: أي جانب من هندسة النفط تحس نفسك أقرب له — الإنتاج، المكامن، الحفر، "
            "لو المحاكاة؟"
        ),
        "technical_communication": (
            "شلون تشرح نتائج تقنية لفريق أو إدارة بدون تعقيد زائد؟"
        ),
        "field_data_analysis": (
            "شلون تقرأ بيانات بئر أو مكمن عشان تتخذ قرار — شنو المؤشرات اللي تبدي بيها؟"
        ),
    },
    "hr_recruiter": {
        "sourcing": "شنو قنوات الاستقطاب اللي تعتمد عليها أكثر شي؟",
        "screening": "شلون تفرّق بين مرشح مناسب ومرشح ضعيف بمرحلة الفرز؟",
        "metrics": "شنو المؤشرات اللي تتابعها بشكل دوري بعملية التوظيف؟",
        "manager_alignment": "شلون تاخذ متطلبات الدور من المدير قبل ما تبدي البحث؟",
    },
}

# Preferred competency rotation order per pack (after rejections).
COMPETENCY_ROTATION_ORDER: dict[str, tuple[str, ...]] = {
    "petroleum_engineer": (
        "simulation_and_tools",
        "reservoir_fundamentals",
        "hse_field_safety",
        "production_operations",
        "technical_communication",
        "field_data_analysis",
    ),
    "hr_recruiter": (
        "sourcing",
        "screening",
        "metrics",
        "manager_alignment",
    ),
}


def resolve_competency_cluster(pack_key: str, key: str) -> str | None:
    """Map a stepKey or competencyKey to its cluster for rejection tracking."""
    k = (key or "").strip()
    if not k:
        return None
    clusters = COMPETENCY_STEP_CLUSTERS.get((pack_key or "").strip().lower(), {})
    for cluster_key, members in clusters.items():
        if k in members:
            return cluster_key
    return k


def _cluster_is_rejected(
    pack_key: str,
    competency_key: str,
    rejected: set[str],
) -> bool:
    cluster = resolve_competency_cluster(pack_key, competency_key)
    if not cluster:
        return competency_key in rejected
    return cluster in rejected or competency_key in rejected


def _question_from_paths(
    interview_paths: list[dict[str, Any]] | None,
    competency_key: str,
    asked_keys: set[str],
) -> str | None:
    if not interview_paths or not competency_key:
        return None
    for path in interview_paths:
        for step in path.get("steps") or []:
            if not isinstance(step, dict):
                continue
            step_comp = str(step.get("competencyKey") or step.get("stepKey") or "")
            if step_comp != competency_key:
                continue
            q = str(step.get("sampleQuestion") or "").strip()
            if not q:
                continue
            single = collapse_to_single_question(q)
            if normalize_text(single) not in asked_keys:
                return single
    return None


def pick_next_competency_question(
    pack_key: str,
    *,
    interview_paths: list[dict[str, Any]] | None,
    asked_competency_keys: set[str],
    rejected_competency_keys: set[str],
    asked_question_keys: set[str],
    track_key: str = "experienced",
    rejected_step_keys: set[str] | None = None,
    rejected_cluster_keys: set[str] | None = None,
    completed_step_keys: set[str] | None = None,
    current_cluster_key: str | None = None,
) -> tuple[str | None, str | None]:
    """Pick next competency question after skip. Returns (question, competency_key)."""
    pack = (pack_key or "").strip().lower()
    rejected_steps = rejected_step_keys or set()
    rejected_clusters = rejected_cluster_keys or set()
    completed_steps = completed_step_keys or set()

    distant_q, _step, comp_key, _cluster = pick_distant_step(
        pack,
        interview_paths,
        track_key,
        rejected_step_keys=rejected_steps,
        rejected_cluster_keys=rejected_clusters,
        completed_step_keys=completed_steps,
        asked_competency_keys=asked_competency_keys,
        current_cluster_key=current_cluster_key,
        asked_question_keys=asked_question_keys,
        closed_question_ids=set(),
    )
    if distant_q and comp_key:
        return distant_q, comp_key

    order = COMPETENCY_ROTATION_ORDER.get(pack, ())
    jump_qs = COMPETENCY_JUMP_QUESTIONS.get(pack, {})

    for comp_key in order:
        if _cluster_is_rejected(pack, comp_key, rejected_competency_keys):
            continue
        if comp_key in asked_competency_keys:
            continue
        path_q = _question_from_paths(interview_paths, comp_key, asked_question_keys)
        if path_q:
            return path_q, comp_key
        jump_q = jump_qs.get(comp_key)
        if jump_q:
            single = collapse_to_single_question(jump_q)
            if normalize_text(single) not in asked_question_keys:
                return single, comp_key

    # Blueprint competencies fallback — any key not rejected/asked
    for comp_key in jump_qs:
        if comp_key in order:
            continue
        if _cluster_is_rejected(pack, comp_key, rejected_competency_keys):
            continue
        if comp_key in asked_competency_keys:
            continue
        single = collapse_to_single_question(jump_qs[comp_key])
        if normalize_text(single) not in asked_question_keys:
            return single, comp_key

    return None, None


def reject_competency_cluster(
    pack_key: str,
    current_key: str | None,
    rejected: set[str],
) -> None:
    """Mark current competency and its cluster as rejected."""
    key = (current_key or "").strip()
    if not key:
        return
    rejected.add(key)
    cluster = resolve_competency_cluster(pack_key, key)
    if cluster:
        rejected.add(cluster)

