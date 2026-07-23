# Evaalo — Official Deployment Guide

> The single canonical reference for how Evaalo ships. If a workflow is not
> described here, it is not sanctioned. Applies to **everyone** — human, Cursor,
> Claude, ChatGPT, any tool.

## 0. The one rule

**The monorepo (`cursor-react`, GitHub `evaalo-site`) is the ONLY source of truth.**
Nothing is edited on the VPS. Nothing is copied by hand. Every deployment starts
from a monorepo commit and flows through Git.

```
Monorepo → Commit → Push → (deploy command) → Git mirror → VPS git pull → build → production
```

---

## 1. Architecture

| Layer | Location | Role |
|---|---|---|
| **Source of truth** | `cursor-react` → GitHub `alialmoosawe2018-create/evaalo-site` (`master`) | Where ALL code is written & committed (frontend + backend) |
| **Backend deploy mirror** | GitHub `alialmoosawe2018-create/evaalo-backend` (`main`) | GENERATED mirror of `apps/backend`. **Never hand-edited.** |
| **Local mirror clone** | `cursor-react/.deploy-tmp/evaalo-backend` | Working clone the deploy command syncs & pushes |
| **Production (backend)** | VPS `/root/evaalo-backend` (git clone of `evaalo-backend@main`) | Pulled by the auto-deployer; builds the Docker image |
| **Running backend** | Docker container `evaalo-api` (compose service `api`) | `api.evaalo.com` ← cloudflared tunnel |
| **Production (frontend)** | GitHub Pages (`evaalo-site` branch `main`, dist-only) → `www.evaalo.com` | Built from `apps/frontend`, deployed via `gh-pages`. **Being migrated to Cloudflare Pages — see §2.1.** |
| **Staging (frontend)** | Cloudflare Pages (`evaalo-site` branch `staging`) → `staging.evaalo.com` | Auto-built on push. Talks to the **production** API |

**Canonical file boundary (backend):**
- **Synced from monorepo** (byte-for-byte, LF): `src/`, `scripts/`, `ops/`, `Dockerfile`, `.dockerignore`, `tsconfig*.json`.
- **Partly synced:** `package.json` — its **`dependencies`/`devDependencies` are auto-synced from the monorepo** by `deploy:backend` (monorepo is the source of truth for deps); its `name`/`scripts` are deploy-owned (standalone build, no monorepo-only `sync-job-catalog`).
- **Deploy-owned, kept in `evaalo-backend`** (environment-specific — NOT overwritten from the monorepo): `docker-compose.yml` (VPS stack), `package-lock.json`, `.gitignore`, `.gitattributes`, `.env.api` (secrets).
- **Never deployed:** `.env*`, `sendgrid.env`, `uploads/`, `docs/`, `*.csv`, `node_modules/`, `dist/`.

Line endings: the monorepo may store CRLF (Windows); the mirror & VPS store **LF**
(via `.gitattributes * text=auto eol=lf`). Content is identical after LF
normalization — that is the verification contract.

---

## 2. Deployment pipeline (backend)

### Deploy
```bash
# from the monorepo root, after committing your apps/backend changes:
npm run deploy:backend
```
`scripts/deploy-backend.sh` runs these **gates** (fails closed):
1. `apps/backend` is committed (source of truth first).
2. `tsc --noEmit` passes (skip with `SKIP_TSC=1`).
3. `src` hash parity: monorepo == mirror (LF-normalized).
4. Dependencies auto-synced from the monorepo into the deploy `package.json` (hard-fails if the sync doesn't achieve parity — no silent dependency drift).
5. Commits + pushes the mirror to `evaalo-backend@main`.

Then the **VPS auto-deployer** (systemd timer `evaalo-backend-deploy.timer`, every
~60 s) runs `/root/evaalo-backend/ops/deploy.sh`:
- `git fetch`. **Continuous drift self-heal:** every tick, if the working tree has an out-of-band manual edit it is reverted to `origin/main` — a manual VPS change can never persist between deploys. If `origin/main` is unchanged and clean → no-op.
- `git reset --hard origin/main` (pull).
- `docker compose build api` — **build gate** (rollback on failure).
- AppArmor-safe container replace (`update --restart=no` → `kill -9 PID` → `rm` → `compose up -d` → `rename`).
- **Health gate**: container `healthy` AND `https://api.evaalo.com/health` == 200.
- **Automatic rollback** to the previous commit + rebuild if any gate fails.
- Logs everything to `/root/evaalo-backend/ops/deploy.log`.

> **Push = deploy.** Pushing to `evaalo-backend@main` (which `deploy:backend` does)
> triggers production within ~1 min. Nothing else is required.

### Frontend
```bash
npm run deploy:frontend   # builds apps/frontend and publishes to gh-pages (www.evaalo.com)
```

---

## 2.1 Frontend hosting: migration to Cloudflare Pages

`www.evaalo.com` is moving off GitHub Pages onto Cloudflare Pages. Until the
cutover, `npm run deploy:frontend` remains the live path and this section
describes the target state.

**Cloudflare Pages project settings** (these are not inferrable — get them right):

| Setting | Value | Why |
|---|---|---|
| Production branch | **`master`** | `main` holds only the old built `dist`. Cloudflare defaults to `main` — it must be changed |
| Root directory | *(empty — monorepo root)* | Vite aliases `@evaalo/job-catalog` to `apps/shared/jobCatalog`, which lives outside `apps/frontend` |
| Build command | `npm ci && npm run build:frontend` | |
| Output directory | `apps/frontend/dist` | |
| Preview deployments | **disabled** | Clerk runs a production instance on `clerk.evaalo.com`; its cookies are scoped to `.evaalo.com`, so auth can never work on a `*.pages.dev` host |
| `NODE_VERSION` | `20` | |
| `PUPPETEER_SKIP_DOWNLOAD` | `1` | `npm ci` at the root installs the `apps/backend` workspace too, and `puppeteer` would otherwise download Chromium on every build |

No `VITE_*` variables are needed in the dashboard — `apps/frontend/.env.production`
is committed and Vite reads it at build time. (Dashboard variables still win if
set, since Vite gives `process.env` precedence.)

**Files that make this work** (all in `apps/frontend/public/`):
- `_redirects` — `/* /index.html 200`, the SPA fallback. Replaces the GitHub
  Pages `404.html` trick, which is removed at cutover **in the same commit**.
- `_headers` — HSTS, `nosniff`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy` (camera/mic allowed — the interview flows need them), and
  immutable caching for `/assets/*`.
- `robots.txt` / `sitemap.xml` — candidate session routes are `Disallow`ed.

**Staging.** `staging.evaalo.com` is served from branch `staging` and points at
the **production** API. Do NOT repoint the backend at it — see the rule below.

> ### ⛔ Never set `FRONTEND_URL` or `APP_PUBLIC_URL` to a test environment
> They are not just CORS. They build the public links emailed/WhatsApp'd to
> candidates (`services/messaging/messagingService.ts`), the Stripe checkout
> return URLs (`services/stripeService.ts`), and integration links
> (`routes/integrations.ts`). Pointing them at staging sends real candidates
> staging links and returns real payments to staging.
>
> To admit another origin, use **`CORS_EXTRA_ORIGINS`** in `.env.api` —
> a comma-separated list of exact origins, consumed by
> `buildCorsAllowedOrigins()` in `src/server.ts`. Exact match only; no wildcard
> or suffix rules (a loose `.pages.dev` rule plus `credentials: true` would let
> anyone register a matching host and read authenticated responses).

---

## 3. Verification

```bash
# 1) content parity across all four (must be identical):
sig(){ cd "$1" && find src -type f -name '*.ts' | LC_ALL=C sort | tr '\n' '\0' | xargs -0 cat | tr -d '\r' | md5sum | cut -c1-16; }
sig apps/backend                    # monorepo
sig .deploy-tmp/evaalo-backend      # mirror
ssh evaalo-vps 'cd /root/evaalo-backend && find src -type f -name "*.ts" | LC_ALL=C sort | tr "\n" "\0" | xargs -0 cat | tr -d "\r" | md5sum | cut -c1-16'  # VPS

# 2) VPS git state clean & on origin/main:
ssh evaalo-vps 'cd /root/evaalo-backend && git rev-parse --short HEAD origin/main && git status --porcelain | grep -v "^??"'

# 3) production health + which commit it runs:
curl -s -o /dev/null -w '%{http_code}\n' https://api.evaalo.com/health   # 200
ssh evaalo-vps 'grep "deploy OK" /root/evaalo-backend/ops/deploy.log | tail -1'
```

---

## 4. Rollback

Automatic on health-gate failure. Manual:
```bash
ssh evaalo-vps
cd /root/evaalo-backend
git log --oneline -5                       # find the good commit
git reset --hard <good-sha>
docker compose build api && bash ops/deploy.sh   # or run the replace manually
```
Env/secret rollback: backups live at `/root/evaalo-backend/.env.api.backup-*`.

---

## 5. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `git pull` on VPS asks for a username | remote set to HTTPS | `git remote set-url origin git@github.com:alialmoosawe2018-create/evaalo-backend.git` (VPS uses SSH key `~/.ssh/id_ed25519`) |
| `deploy.sh` logs "dirty tree" | someone edited files on the VPS by hand | forbidden — it is auto-stashed; re-deploy from the monorepo |
| container name has a hash prefix (`xxxx_evaalo-api`) | compose prefixed on replace | `deploy.sh` auto-renames; if stuck: `docker rename <prefixed> evaalo-api` |
| build fails on VPS | `docker compose build api` error | check `ops/deploy.log`; the previous version keeps running (rollback) |
| dep-parity WARN in `deploy:backend` | monorepo added an npm package | update the deploy `package.json`/`package-lock.json` in `evaalo-backend`, then redeploy |
| timer not deploying | `systemctl status evaalo-backend-deploy.timer` | `systemctl enable --now evaalo-backend-deploy.timer` |

Disable auto-deploy (deploy only manually): `ssh evaalo-vps 'systemctl disable --now evaalo-backend-deploy.timer'`
then deploy on demand with `ssh evaalo-vps 'bash /root/evaalo-backend/ops/deploy.sh'`.

---

## 6. The permanent workflow (mandatory for ALL contributors)

```
        edit apps/backend (or apps/frontend) in the MONOREPO only
                              │
                        git commit
                              │
                        git push  (evaalo-site)
                              │
         backend: npm run deploy:backend   │   frontend: npm run deploy:frontend
                              │
        mirror push → VPS git pull → build → health-gated replace (auto-rollback)
                              │
                    production verified (health 200)
```

**Never:** edit code on the VPS · `rsync`/`scp`/copy backend folders · push to
`evaalo-backend` by hand · run a deploy that skips these commands · add an
`evaalo-backend` remote to the monorepo root (it was removed to prevent
clobbering production).

If you are an AI agent (Cursor / Claude / ChatGPT): follow this file exactly.
The monorepo is the only place you write code. `npm run deploy:backend` is the
only way backend code reaches production.
