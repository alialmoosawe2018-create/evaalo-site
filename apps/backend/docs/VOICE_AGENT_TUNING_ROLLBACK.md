# Voice Agent Tuning — Rollback Reference

> **Purpose:** Preserve original values before tuning so we can revert quickly on request.  
> **Last updated:** 2026-08-09  
> **Session:** agent wait-time / anti-interruption tuning (local + LiveKit unified)

**Trigger phrases (say any of these to revert everything):**
- `ارجع قيم الوكيل`
- `rollback agent tuning`
- `ارجع للقيم الأصلية قبل التغيير`

---

## Summary — all changes at a glance

| Agent | What changed | Original | Current (test) | Deploy status |
|---|---|---|---|---|
| **Local WS** (interview + reception) | `max_delay` default | `0.85` | **`1.35`** | Code only — needs `deploy:backend` |
| **LiveKit Interview** | EOU + endpointing | `0.44 s` total | **`0.60 s`** (0.48+0.12) | `.env.local` only — needs Cloud + `lk agent deploy` |
| **LiveKit Reception** | EOU + endpointing | `~0.48 s` total | **`0.60 s`** (0.48+0.12) | VPS `.env.local` updated — needs `docker restart evaalo-reception-agent` |

**Important:** `EOU = 0.48` seconds; **`0.60` is the combined wait** (EOU + endpointing), not EOU alone.

**Unchanged everywhere:** `SPEECHMATICS_MAX_DELAY=0.70` (LiveKit), `VOICE_USER_STOPPED_MS=1300` (local WS).

---

## 1. LiveKit — Interview agent (`video-interview-agent`)

**Where it runs:** LiveKit Cloud (not VPS).  
**Local mirror:** `cursor-react/apps/avatar-evaalov2/.env.local` (gitignored — copy values to Cloud dashboard).  
**Deploy after Cloud change:** `lk agent deploy` from `apps/avatar-evaalov2`.

| Variable | Original | Current (test) | Notes |
|---|---|---|---|
| `SPEECHMATICS_EOU_SILENCE` | `0.40` | `0.48` | Speechmatics end-of-utterance silence (seconds) |
| `MIN_ENDPOINTING_DELAY` | `0.04` | `0.12` | LiveKit wait after STT EOU signal |
| `INTERVIEW_MIN_ENDPOINTING_FLOOR` | `0.04` | `0.12` | Floor if `MIN_ENDPOINTING_DELAY` unset on Cloud |
| `SPEECHMATICS_MAX_DELAY` | `0.70` | `0.70` | **Unchanged** — do not lower below 0.70 |

**Combined wait (EOU + endpointing):** `0.44 s` → **`0.60 s`** (+160 ms)

**Revert — local file** (`apps/avatar-evaalov2/.env.local`):

```env
SPEECHMATICS_EOU_SILENCE=0.40
MIN_ENDPOINTING_DELAY=0.04
INTERVIEW_MIN_ENDPOINTING_FLOOR=0.04
```

**Revert — LiveKit Cloud:** set the same three variables in Agents → Environment, then `lk agent deploy`.

**Verify in logs:** `eou_silence=0.40` and `MIN_ENDPOINTING_DELAY=0.04` (or absent → floor 0.04).

---

## 2. Local voice agents — Interview + Reception (WebSocket)

**Where it runs:** VPS inside `evaalo-api` (`/ws/voice-interview`, `/ws/voice-reception`).  
**STT path:** `speechmaticsStreamingService.ts` → `max_delay` from `getVoiceVadSettings()`.

| Setting | Original | Current (test) | File(s) |
|---|---|---|---|
| Default `VOICE_SPEECHMATICS_MAX_DELAY_SEC` | `0.85` | `1.35` | `apps/backend/src/evaalo-only-voice/voiceTimingEnv.ts` |
| Same (reception copy) | `0.85` | `1.35` | `apps/backend/src/evaalo-only-voice-reception/voiceTimingEnv.ts` |

**Unchanged (still at code defaults — no env override on VPS):**

| Variable | Value | Role |
|---|---|---|
| `VOICE_USER_STOPPED_MS` | `1300` | JS timer after last STT text (no punctuation) |
| `VOICE_USER_STOPPED_PUNCT_MS` | `1050` | JS timer when sentence ends with `. ؟ !` |
| `VOICE_SPEECH_SILENCE_MS` | `1000` | Batch path silence (streaming uses max_delay + JS timer) |

**Approx wait after user stops:** `~2.15 s` → **`~2.65 s`** (1.35 + 1.30)

**Revert — code** (both files, line `speechmaticsMaxDelaySec` default):

```typescript
speechmaticsMaxDelaySec: n(process.env.VOICE_SPEECHMATICS_MAX_DELAY_SEC, 0.85, 0.2, 2.5),
```

**Revert — VPS env** (if ever set in `.env.api`):

```env
VOICE_SPEECHMATICS_MAX_DELAY_SEC=0.85
```

**Ship revert:** commit monorepo → `npm run deploy:backend` → VPS auto-deploy (~60 s).

---

## 3. LiveKit — Reception agent (`evaalo-reception-agent`)

**Where it runs:** VPS Docker (`evaalo-reception-agent`), env from `/root/evaalo-backend/.env.local`.  
**Local mirror:** `cursor-react/apps/avatar-evaalo-reception/.env.local` (gitignored).

| Variable | Original | Current (test) | Notes |
|---|---|---|---|
| `SPEECHMATICS_EOU_SILENCE` | `0.40` | `0.48` | Unified with interview agent |
| `MIN_ENDPOINTING_DELAY` | unset → `0.08` | `0.12` | Was not set on VPS before |
| `RECEPTION_MIN_ENDPOINTING_FLOOR` | unset → `0.08` | `0.12` | Reception-specific floor |
| `SPEECHMATICS_MAX_DELAY` | `0.70` | `0.70` | **Unchanged** |

**Combined wait:** `~0.48 s` → **`~0.60 s`** (same as LiveKit interview)

**Revert — VPS** (`/root/evaalo-backend/.env.local`):

```env
SPEECHMATICS_EOU_SILENCE=0.40
```

Remove or comment out:

```env
# MIN_ENDPOINTING_DELAY=0.12
# RECEPTION_MIN_ENDPOINTING_FLOOR=0.12
```

Then: `docker restart evaalo-reception-agent`

**Revert — local** (`apps/avatar-evaalo-reception/.env.local`):

```env
SPEECHMATICS_EOU_SILENCE=0.40
MIN_ENDPOINTING_DELAY=0.04
INTERVIEW_MIN_ENDPOINTING_FLOOR=0.04
# remove RECEPTION_MIN_ENDPOINTING_FLOOR=0.12
```

---

## 4. One-shot rollback (agent executes when user asks)

When reverting, apply **all three** sections below in order:

1. **§1** — `apps/avatar-evaalov2/.env.local` + LiveKit Cloud env + `lk agent deploy`
2. **§2** — both `voiceTimingEnv.ts` files (`0.85` default) + `npm run deploy:backend`
3. **§3** — VPS `/root/evaalo-backend/.env.local` + `apps/avatar-evaalo-reception/.env.local` + `docker restart evaalo-reception-agent`

---

## 5. Quick rollback checklist

| Agent | Action |
|---|---|
| LiveKit interview | Restore §1 env on Cloud + `lk agent deploy`; restore `.env.local` |
| Local interview + reception | Restore §2 default in both `voiceTimingEnv.ts` + `deploy:backend` |
| LiveKit reception | Restore §3 env on VPS `.env.local` + `docker restart evaalo-reception-agent`; restore `apps/avatar-evaalo-reception/.env.local` |

---

## 5b. Local interview agent — strict follow-up rules

**Where it runs:** VPS inside `evaalo-api` (`/ws/voice-interview`).  
**Problem fixed:** agent kept issuing follow-ups (a follow-up every other turn, with no interview-wide cap).

| Rule | Before | After | File |
|---|---|---|---|
| Interview-wide cap | none (per-question only) | **5 follow-ups max** | `interviewState.ts` (`FOLLOW_UP_MAX_PER_INTERVIEW`) |
| Gap between follow-ups | 1 turn (counter reset each turn) | **3 turns** = 2 normal questions | `interviewState.ts` (`FOLLOW_UP_MIN_GAP_TURNS`) |
| Challenge detector | matched `صار`, `قدرت`, `كدرت`, `hard`, `difficult`; any length | those removed; **min 15 words** | `questionEngine.ts` (`CHALLENGE_MIN_WORDS`) |
| Clarification / change-question | reset counter → extra follow-up | **no longer resets** | `voiceSessionCore.ts` |
| LLM implicit follow-up | not forbidden | **`NO_FOLLOW_UP_RULE`** appended in topic/rephrase modes | `llmService.ts` |
| Phases allowed | all | all (unchanged, per decision) | — |

**New state fields:** `totalFollowUps`, `lastFollowUpTurn` on `InterviewState`.

**Diagnostic log:** `[FOLLOW-UP BLOCKED] <sid> used=N/5 turn=T lastAt=L budget=… gap=…`

**Revert:** `git revert` the commit, or manually:
- `interviewState.ts` — remove `totalFollowUps`, `lastFollowUpTurn`, both constants, and the `followUpAsked` option
- `questionEngine.ts` — restore original `isChallengeMention` regex (with `صار|صارلي|كدرت|قدرت|difficult|hard`) and drop `CHALLENGE_MIN_WORDS`
- `voiceSessionCore.ts` — restore `currentFollowUp` logic (`changeRequested || clarificationRequested ? 0 : …`)
- `llmService.ts` — remove `NO_FOLLOW_UP_RULE` constant and its usages

**Ship:** commit → `npm run deploy:backend`

**Note:** `voiceWs.ts` used to sit beside `voiceSessionCore.ts` holding a duplicate of the old logic. It was dead code (imported nowhere) and has been deleted — `voiceSessionCore.ts`, reached through `voiceInterviewWs.ts`, is the only voice-interview session handler.

---

## 6. Planned but NOT applied yet

Documented for future tests — **still at original values:**

| Variable | Original | Discussed target | Agents |
|---|---|---|---|
| `VOICE_USER_STOPPED_MS` | `1300` | `1800–2000` | Local WS only |
| `VOICE_USER_STOPPED_PUNCT_MS` | `1050` | `1500` | Local WS only |

If applied later, add a row to §2 before changing.

---

## 7. Related session work (not agent tuning)

- Frontend deploy path: cherry-pick to `master` for Cloudflare (commits `594bfbc`, `ee50aa8`) — unrelated to voice timing.
- The frontend ships via `git push origin master` (Cloudflare Pages builds it). `npm run deploy:frontend` is retired and now hard-fails.
