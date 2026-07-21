#!/usr/bin/env bash
# ============================================================================
# Evaalo backend auto-deployer (GitOps, pull-based).
#
# Source of truth: monorepo apps/backend  →  evaalo-backend@main (mirror)  →
# this VPS pulls it here.  This script pulls origin/main, builds the image,
# replaces the api container behind health gates, and AUTO-ROLLS-BACK on any
# failure.  Runnable by the systemd timer (push-to-deploy) OR manually.
#
# It must NEVER be the place code is edited — code only flows from the monorepo.
# ============================================================================
set -uo pipefail

REPO="/root/evaalo-backend"
BRANCH="main"
SVC="api"
CONTAINER="evaalo-api"
HEALTH_URL="https://api.evaalo.com/health"
LOG="$REPO/ops/deploy.log"
LOCK="/tmp/evaalo-backend-deploy.lock"

log() { echo "[$(date -u +%FT%TZ)] $*" | tee -a "$LOG"; }

# Single-flight: never run two deploys at once.
exec 9>"$LOCK" || exit 0
flock -n 9 || { exit 0; }

cd "$REPO" || { log "FATAL: repo $REPO missing"; exit 1; }

# --- AppArmor-safe container replace (Docker snap denies dockerd stop) --------
replace_container() {
  local name pid
  name="$(docker ps -a --format '{{.Names}}' | grep -E 'evaalo-api$' | head -1)"
  if [ -n "$name" ]; then
    pid="$(docker inspect -f '{{.State.Pid}}' "$name" 2>/dev/null)"
    docker update --restart=no "$name" >/dev/null 2>&1 || true
    [ -n "$pid" ] && [ "$pid" != "0" ] && kill -9 "$pid" 2>/dev/null || true
    sleep 2
    docker rm -f "$name" >/dev/null 2>&1 || true
  fi
  docker compose up -d --no-deps "$SVC" >>"$LOG" 2>&1
  local new
  new="$(docker ps -a --format '{{.Names}}' | grep -E 'evaalo-api$' | head -1)"
  [ -n "$new" ] && [ "$new" != "$CONTAINER" ] && docker rename "$new" "$CONTAINER" 2>/dev/null || true
}

# --- health gate: container healthy AND public /health == 200 ----------------
health_ok() {
  local h code i
  for i in $(seq 1 20); do
    h="$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || true)"
    [ "$h" = "healthy" ] && break
    sleep 3
  done
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$HEALTH_URL" 2>/dev/null || echo 000)"
  [ "$h" = "healthy" ] && [ "$code" = "200" ]
}

# --- is there anything to deploy? --------------------------------------------
git fetch origin "$BRANCH" -q 2>>"$LOG" || { log "fetch failed"; exit 1; }
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"
[ "$LOCAL" = "$REMOTE" ] && exit 0   # up to date — no-op (timer-friendly)

PREV="$LOCAL"
log "=== deploy start: ${LOCAL:0:9} -> ${REMOTE:0:9} ==="

# Drift gate: warn + stash any manual edits to tracked files (must not exist).
if [ -n "$(git status --porcelain | grep -v '^??')" ]; then
  log "WARN: tracked working tree was dirty (out-of-band manual edit) — stashing"
  git stash push -q -m "auto-deploy-stash-$(date -u +%FT%TZ)" || true
fi

git reset --hard "origin/$BRANCH" -q 2>>"$LOG" || { log "reset failed"; exit 1; }
log "pulled $(git rev-parse --short HEAD)"

# Build gate.
if ! docker compose build "$SVC" >>"$LOG" 2>&1; then
  log "BUILD FAILED -> rollback to ${PREV:0:9}"
  git reset --hard "$PREV" -q
  exit 1
fi
log "build ok"

replace_container

# Health gate + auto-rollback.
if health_ok; then
  log "=== deploy OK: $(git rev-parse --short HEAD) healthy, /health 200 ==="
  exit 0
else
  log "HEALTH FAILED -> ROLLING BACK to ${PREV:0:9}"
  git reset --hard "$PREV" -q
  docker compose build "$SVC" >>"$LOG" 2>&1 || log "rollback build FAILED (manual intervention needed)"
  replace_container
  if health_ok; then
    log "rollback OK (running ${PREV:0:9})"
  else
    log "CRITICAL: rollback health still failing — manual intervention required"
  fi
  exit 1
fi
