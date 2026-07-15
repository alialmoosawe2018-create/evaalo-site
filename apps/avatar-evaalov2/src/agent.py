"""LiveKit worker entry: video-interview-agent.

Implementation lives in `voice_interview` (config, factories, assistant, worker).
Docs: https://docs.livekit.io/agents/
"""

import voice_interview.config  # noqa: F401 — load `.env.local` before other tweaks
from playback_patches import configure_and_apply_playback_patches
from voice_interview.sdk_tweaks import apply_env_sdk_tweaks
from voice_interview.speechmatics_patches import apply_all_speechmatics_patches

apply_all_speechmatics_patches()
configure_and_apply_playback_patches()
apply_env_sdk_tweaks()

from livekit.agents import cli  # noqa: E402

from voice_interview.worker import server  # noqa: E402

if __name__ == "__main__":
    cli.run_app(server)
