#!/bin/bash
# ══════════════════════════════════════════════════════
#  Backend deploy script (pnpm + PM2)
#
#  Run on the server as the user that owns the PM2 process:
#    bash scripts/deploy.sh
#
#  Every setting can be overridden through the environment:
#    APP_DIR      repository checkout on the server   (default: the repo containing this script)
#    BRANCH       branch to deploy                    (default: production)
#    PM2_CONFIG   PM2 ecosystem file inside APP_DIR   (default: ecosystem.config.cjs)
#    PM2_APP      PM2 process name                    (default: padel-backend)
#    HEALTH_URL   URL that must answer 401            (default: http://127.0.0.1:3002/api/v1/auth/me)
#    SKIP_PULL=1  deploy the current checkout without fetching
#    SKIP_PM2=1   stop after migrations (no PM2 restart, no health check)
#
#  Prerequisites:
#    - Node.js 20+ and pnpm (corepack enable pnpm, as root)
#    - PM2 for the deploy user
#    - PostgreSQL reachable with the values in APP_DIR/.env
# ══════════════════════════════════════════════════════

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BRANCH="${BRANCH:-production}"
PM2_CONFIG="${PM2_CONFIG:-ecosystem.config.cjs}"
PM2_APP="${PM2_APP:-padel-backend}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3002/api/v1/auth/me}"
SKIP_PULL="${SKIP_PULL:-0}"
SKIP_PM2="${SKIP_PM2:-0}"

fail() {
  echo -e "${RED}Error: $1${NC}" >&2
  exit 1
}

echo -e "${GREEN}PadelSys — backend deploy (${BRANCH})${NC}"

# ── 1. Preflight: everything is checked before the code changes ──
echo -e "\n${YELLOW}[1/6] Checking environment...${NC}"
[ -d "$APP_DIR" ] || fail "directory $APP_DIR does not exist."
[ -f "$APP_DIR/.env" ] || fail ".env not found in $APP_DIR (copy .env.production.example and fill it in)."
command -v pnpm > /dev/null 2>&1 || fail "pnpm is not installed. As root run: corepack enable pnpm"
# pnpm-workspace.yaml uses pnpm 11 settings (allowBuilds); an older pnpm
# silently skips the bcrypt native build and logins break.
PNPM_MAJOR="$(pnpm --version | cut -d. -f1)"
[ "$PNPM_MAJOR" -ge 11 ] || fail "pnpm $(pnpm --version) found, pnpm 11+ is required (it needs Node 22.13+)."
if [ "$SKIP_PM2" != "1" ]; then
  command -v pm2 > /dev/null 2>&1 || fail "pm2 is not installed for user $(whoami)."
  [ -f "$APP_DIR/$PM2_CONFIG" ] || fail "PM2 config $APP_DIR/$PM2_CONFIG not found."
fi
cd "$APP_DIR"
if [ "$SKIP_PULL" != "1" ] && [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  fail "the checkout has uncommitted changes; commit or discard them first."
fi
echo -e "${GREEN}✓ Environment OK (node $(node --version), pnpm $(pnpm --version))${NC}"

# ── 2. Update source ─────────────────────────────────────
echo -e "\n${YELLOW}[2/6] Updating source...${NC}"
PREVIOUS_COMMIT="$(git rev-parse HEAD)"
if [ "$SKIP_PULL" = "1" ]; then
  echo "SKIP_PULL=1: keeping $(git rev-parse --short HEAD)"
else
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git merge --ff-only "origin/$BRANCH"
fi
echo -e "${GREEN}✓ $(git log -1 --format='%h %s') (previous: ${PREVIOUS_COMMIT:0:7})${NC}"

# ── 3. Install dependencies ──────────────────────────────
# Dev dependencies are required: the build uses @nestjs/cli/typescript and
# the migrations run through ts-node.
echo -e "\n${YELLOW}[3/6] Installing dependencies...${NC}"
pnpm install --frozen-lockfile
echo -e "${GREEN}✓ Dependencies installed${NC}"

# ── 4. Build ─────────────────────────────────────────────
echo -e "\n${YELLOW}[4/6] Building...${NC}"
pnpm run build
[ -f dist/main.js ] || fail "build finished without dist/main.js."
echo -e "${GREEN}✓ Build ready in dist/${NC}"

# ── 5. Migrations ────────────────────────────────────────
echo -e "\n${YELLOW}[5/6] Running database migrations...${NC}"
pnpm run migration:run
echo -e "${GREEN}✓ Migrations applied${NC}"

if [ "$SKIP_PM2" = "1" ]; then
  echo -e "\n${GREEN}✓ Done (SKIP_PM2=1: process not restarted)${NC}"
  exit 0
fi

# ── 6. Restart and health check ──────────────────────────
echo -e "\n${YELLOW}[6/6] Restarting with PM2...${NC}"
pm2 startOrReload "$PM2_CONFIG" --update-env
pm2 save > /dev/null

HTTP_CODE="000"
for _ in $(seq 1 15); do
  HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL" || true)"
  [ "$HTTP_CODE" = "401" ] && break
  sleep 2
done

if [ "$HTTP_CODE" = "401" ]; then
  echo -e "${GREEN}✓ API answering (HTTP 401 expected on $HEALTH_URL)${NC}"
else
  echo -e "${RED}Health check returned HTTP $HTTP_CODE.${NC}" >&2
  echo "  Logs:     pm2 logs $PM2_APP --lines 100 --nostream" >&2
  echo "  Rollback: git checkout ${PREVIOUS_COMMIT:0:7} && pnpm install --frozen-lockfile && pnpm run build && pm2 restart $PM2_APP" >&2
  exit 1
fi

echo -e "\n${GREEN}✓ Deploy finished: $(git log -1 --format='%h %s')${NC}"
