"""Keep-warm ping detection for the video-interview worker.

The backend heartbeat dispatches a throwaway room to keep the LiveKit worker
container warm (avoids the ~20s cold-start on the first real interview after an
idle stretch / redeploy). ``my_agent`` must recognize such a ping and return
before building the avatar / LLM / TTS. These tests pin that detection.
"""

from voice_interview.keep_warm import is_keep_warm_job as _is_keep_warm_job


def test_warmup_metadata_flag_is_keep_warm():
    assert _is_keep_warm_job({"warmup": "1"}, "room-anything") is True
    assert _is_keep_warm_job({"warmup": "true"}, None) is True
    assert _is_keep_warm_job({"warmup": "YES"}, "room-x") is True


def test_warmup_room_name_is_keep_warm():
    assert _is_keep_warm_job({}, "room-warmup-keepalive-123") is True
    assert _is_keep_warm_job({}, "WARMUP-abc") is True


def test_real_interview_is_not_keep_warm():
    assert _is_keep_warm_job({}, "room-video-interview-abc-123") is False
    assert _is_keep_warm_job({"warmup": "0"}, "room-video-interview-abc") is False
    assert _is_keep_warm_job({"warmup": ""}, "room-video-interview-abc") is False
    assert _is_keep_warm_job({}, None) is False


def test_none_meta_is_safe():
    assert _is_keep_warm_job(None, "room-video-interview-abc") is False  # type: ignore[arg-type]
    assert _is_keep_warm_job(None, "room-warmup-x") is True  # type: ignore[arg-type]
