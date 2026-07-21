#!/usr/bin/env bash
# ============================================================================
# ONE backend deployment command (run from the monorepo):  npm run deploy:backend
#
# GitOps push-to-deploy. The monorepo (apps/backend) is the SOLE source of
# truth. This script mirrors the backend application code into the deploy
# repo (evaalo-backend) and pushes it. The VPS auto-deployer (systemd timer)
# then pulls, builds, and replaces the container behind health gates.
#
# There is NO manual copy, NO manual SSH, NO other deploy path.
#
# Canonical boundary:
#   synced from monorepo : src/ scripts/ ops/ Dockerfile .dockerignore tsconfig*.json
#   deploy-owned (kept)  : package.json package-lock.json docker-compose.yml .gitignore .gitattributes
#   never deployed       : .env* sendgrid.env uploads/ docs/ *.csv node_modules/ dist/
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
M="$ROOT/apps/backend"
D="$ROOT/.deploy-tmp/evaalo-backend"
SKIP_TSC="${SKIP_TSC:-0}"

say() { printf '\033[36m[deploy:backend]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[deploy:backend] GATE FAILED:\033[0m %s\n' "$*" >&2; exit 1; }

[ -d "$M" ] || die "monorepo backend not found: $M"
[ -d "$D/.git" ] || die "deploy mirror not found: $D (expected a git clone of evaalo-backend)"

# --- Gate 1: monorepo backend committed (no uncommitted app changes) ---------
say "Gate 1/5 — monorepo apps/backend is committed"
if [ -n "$(git -C "$ROOT" status --porcelain apps/backend | grep -v '^??' || true)" ]; then
  die "apps/backend has uncommitted changes — commit them in the monorepo first (it is the source of truth)."
fi

# --- Gate 2: local type-check (build sanity, skippable with SKIP_TSC=1) -------
if [ "$SKIP_TSC" != "1" ]; then
  say "Gate 2/5 — tsc --noEmit (set SKIP_TSC=1 to skip)"
  ( cd "$M" && npx tsc --noEmit -p tsconfig.json ) || die "type-check failed — fix before deploying."
else
  say "Gate 2/5 — tsc SKIPPED (SKIP_TSC=1); VPS build gate still enforces it"
fi

# --- Sync application code (mirror dirs so deletions propagate) ---------------
say "Syncing application code monorepo -> mirror"
rm -rf "$D/src";     cp -r "$M/src"     "$D/src"
rm -rf "$D/scripts"; cp -r "$M/scripts" "$D/scripts"
mkdir -p "$D/ops";   cp -f "$M/ops/deploy.sh" "$D/ops/deploy.sh"
cp -f "$M/Dockerfile" "$D/Dockerfile"
[ -f "$M/.dockerignore" ] && cp -f "$M/.dockerignore" "$D/.dockerignore" || true
for tc in tsconfig.json tsconfig.build.json; do [ -f "$M/$tc" ] && cp -f "$M/$tc" "$D/$tc" || true; done

# --- Gate 3: byte-for-byte (LF) src parity monorepo == mirror ----------------
say "Gate 3/5 — src hash parity (LF-normalized)"
sig() { find "$1" -type f -name '*.ts' | sort | while read -r f; do tr -d '\r' < "$f" | md5sum | cut -c1-32; echo "  ${f#$1/}"; done | md5sum | cut -c1-16; }
SM="$(sig "$M/src")"; SD="$(sig "$D/src")"
[ "$SM" = "$SD" ] || die "src signature mismatch (monorepo=$SM mirror=$SD)"
say "  parity OK: $SM"

# --- Gate 4: dependencies unchanged vs deploy package.json (warn only) --------
say "Gate 4/5 — dependency parity check"
DM="$(node -e "const d=require('$M/package.json');console.log(Object.keys({...d.dependencies,...d.devDependencies}).sort().join(','))" | md5sum | cut -c1-12)"
DD="$(node -e "const d=require('$D/package.json');console.log(Object.keys({...d.dependencies,...d.devDependencies}).sort().join(','))" | md5sum | cut -c1-12)"
if [ "$DM" != "$DD" ]; then
  printf '\033[33m[deploy:backend] WARN:\033[0m dependencies differ (monorepo=%s deploy=%s). If the monorepo added a package, update the deploy package.json before deploying.\n' "$DM" "$DD"
fi

# --- Commit + push mirror (only if changed) ----------------------------------
cd "$D"
git add -A src scripts ops Dockerfile .dockerignore tsconfig*.json 2>/dev/null || true
if git diff --cached --quiet; then
  say "Mirror already up to date — nothing to push."
  say "Current mirror HEAD: $(git rev-parse --short HEAD). VPS is already on it."
  exit 0
fi
say "Gate 5/5 — committing + pushing mirror"
git commit -q -m "deploy(backend): sync from monorepo $(git -C "$ROOT" rev-parse --short HEAD)

Automated mirror sync via npm run deploy:backend. Do not hand-edit this repo.
" || die "commit failed"
git push -q origin main || die "push failed (check GitHub auth)"
NEW="$(git rev-parse --short HEAD)"

say "✅ Pushed mirror $NEW to evaalo-backend@main."
say "   VPS auto-deployer will pull + build + replace within ~1 min."
say "   Watch:  ssh evaalo-vps 'tail -f /root/evaalo-backend/ops/deploy.log'"
say "   Verify: curl -s -o /dev/null -w '%{http_code}\\n' https://api.evaalo.com/health"
