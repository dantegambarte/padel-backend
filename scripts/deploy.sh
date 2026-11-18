#!/bin/bash
# ══════════════════════════════════════════════════════
#  Backend deploy script (pnpm + PM2, atomic releases)
#
#  Layout under DEPLOY_ROOT:
#    repo/              git clone used only to export release sources
#    releases/<sha>/    one immutable directory per deployed commit
#    shared/.env        production secrets, symlinked into every release
#    current -> releases/<sha>   the live release (PM2 runs from here)
#
#  A new release is prepared entirely in releases/<sha>; the live directory
#  is never modified. The switch is an atomic rename of the `current`
#  symlink. If the readiness check fails, `current` goes back to the
#  previous release and PM2 is reloaded automatically.
#
#  Usage (on the server, as the user that owns the PM2 process):
#    bash scripts/deploy.sh [--artifact <path-or-url-to-dist.tar.gz>] [--sha <commit>]
#
#    --artifact  tarball containing dist/ (the CI "Build artifact" job output).
#                Without it, the release is built inside releases/<sha>.
#    --sha       commit to deploy (default: tip of origin/$BRANCH).
#
#  Environment overrides:
#    DEPLOY_ROOT   base directory           (default: two levels above this script via `current`)
#    REPO_URL      git remote for repo/     (default: origin of DEPLOY_ROOT/repo, required on first run)
#    BRANCH        branch to deploy         (default: production)
#    KEEP_RELEASES releases kept on disk    (default: 5, never fewer than 2)
#    PM2_CONFIG    ecosystem file name      (default: ecosystem.config.cjs)
#    PM2_APP       PM2 process name         (default: padel-backend)
#    HEALTH_URL    readiness URL, must answer 200 (default: http://127.0.0.1:3002/api/v1/health/ready)
#    SKIP_PM2=1    stop after migrations (no switch, no reload, no health check)
#    SKIP_BACKUP=1 skip the pre-migration database dump (not recommended)
#    BACKUP_*      forwarded to scripts/backup-db.sh (see that file)
#
#  Note: migrations are not reverted on rollback. Restore from the
#  pre-migration dump (scripts/restore-db.sh) if a migration is the problem.
# ══════════════════════════════════════════════════════

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

fail() {
  echo -e "${RED}Error: $1${NC}" >&2
  exit 1
}

ARTIFACT=""
TARGET_SHA=""
while [ $# -gt 0 ]; do
  case "$1" in
    --artifact) ARTIFACT="${2:-}"; shift 2 ;;
    --sha) TARGET_SHA="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,37p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

# `pwd` (logical) keeps the `current` symlink in the path, so running
# DEPLOY_ROOT/current/scripts/deploy.sh resolves DEPLOY_ROOT correctly.
DEPLOY_ROOT="${DEPLOY_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
BRANCH="${BRANCH:-production}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
PM2_CONFIG="${PM2_CONFIG:-ecosystem.config.cjs}"
PM2_APP="${PM2_APP:-padel-backend}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3002/api/v1/health/ready}"
SKIP_PM2="${SKIP_PM2:-0}"
SKIP_BACKUP="${SKIP_BACKUP:-0}"

REPO_DIR="$DEPLOY_ROOT/repo"
RELEASES_DIR="$DEPLOY_ROOT/releases"
SHARED_DIR="$DEPLOY_ROOT/shared"
CURRENT_LINK="$DEPLOY_ROOT/current"

[ "$KEEP_RELEASES" -ge 2 ] 2>/dev/null || fail "KEEP_RELEASES must be an integer >= 2."

echo -e "${GREEN}PadelSys — backend deploy (${BRANCH})${NC}"

# ── 1. Preflight ─────────────────────────────────────────
echo -e "\n${YELLOW}[1/7] Checking environment...${NC}"
[ -f "$SHARED_DIR/.env" ] || fail "$SHARED_DIR/.env not found (copy .env.production.example there and fill it in)."
command -v git > /dev/null 2>&1 || fail "git is not installed."
command -v pnpm > /dev/null 2>&1 || fail "pnpm is not installed. As root run: corepack enable pnpm"
# pnpm-workspace.yaml uses pnpm 11 settings (allowBuilds); an older pnpm
# silently skips the bcrypt native build and logins break.
PNPM_MAJOR="$(pnpm --version | cut -d. -f1)"
[ "$PNPM_MAJOR" -ge 11 ] || fail "pnpm $(pnpm --version) found, pnpm 11+ is required (it needs Node 22.13+)."
if [ "$SKIP_PM2" != "1" ]; then
  command -v pm2 > /dev/null 2>&1 || fail "pm2 is not installed for user $(whoami)."
  command -v curl > /dev/null 2>&1 || fail "curl is not installed."
fi
if [ "$SKIP_BACKUP" != "1" ]; then
  command -v pg_dump > /dev/null 2>&1 || fail "pg_dump is not installed (apt install postgresql-client), or set SKIP_BACKUP=1."
fi
if [ -n "$ARTIFACT" ] && [ ! -f "$ARTIFACT" ]; then
  case "$ARTIFACT" in
    http://*|https://*) ;;
    *) fail "artifact $ARTIFACT not found." ;;
  esac
fi
mkdir -p "$RELEASES_DIR"
PREVIOUS_RELEASE=""
if [ -L "$CURRENT_LINK" ]; then
  PREVIOUS_RELEASE="$(readlink "$CURRENT_LINK")"
fi
echo -e "${GREEN}✓ Environment OK (node $(node --version), pnpm $(pnpm --version))${NC}"

# ── 2. Resolve the commit ────────────────────────────────
echo -e "\n${YELLOW}[2/7] Fetching source...${NC}"
if [ ! -d "$REPO_DIR/.git" ]; then
  [ -n "${REPO_URL:-}" ] || fail "$REPO_DIR does not exist; set REPO_URL for the first clone."
  git clone --quiet "$REPO_URL" "$REPO_DIR"
fi
git -C "$REPO_DIR" fetch --quiet origin "$BRANCH"
if [ -z "$TARGET_SHA" ]; then
  TARGET_SHA="$(git -C "$REPO_DIR" rev-parse "origin/$BRANCH")"
else
  TARGET_SHA="$(git -C "$REPO_DIR" rev-parse --verify "${TARGET_SHA}^{commit}")"
fi
RELEASE_DIR="$RELEASES_DIR/$TARGET_SHA"
[ "$PREVIOUS_RELEASE" != "$RELEASE_DIR" ] || fail "commit ${TARGET_SHA:0:7} is already live."
echo -e "${GREEN}✓ Deploying $(git -C "$REPO_DIR" log -1 --format='%h %s' "$TARGET_SHA")${NC}"

# ── 3. Prepare the release directory ─────────────────────
# Built in a temporary directory and renamed at the end, so a half-prepared
# release never sits at releases/<sha>.
echo -e "\n${YELLOW}[3/7] Preparing release...${NC}"
STAGING_DIR="$RELEASES_DIR/.staging-$TARGET_SHA"
rm -rf "$STAGING_DIR" "$RELEASE_DIR"
mkdir -p "$STAGING_DIR"
trap 'rm -rf "$STAGING_DIR"' EXIT
git -C "$REPO_DIR" archive "$TARGET_SHA" | tar -x -C "$STAGING_DIR"
ln -s "$SHARED_DIR/.env" "$STAGING_DIR/.env"

# Dev dependencies are required: migrations run through ts-node and the
# fallback build uses @nestjs/cli/typescript.
(cd "$STAGING_DIR" && pnpm install --frozen-lockfile)

if [ -n "$ARTIFACT" ]; then
  echo "Using build artifact: $ARTIFACT"
  case "$ARTIFACT" in
    http://*|https://*)
      curl -fsSL "$ARTIFACT" -o "$STAGING_DIR/.artifact.tar.gz"
      tar -xzf "$STAGING_DIR/.artifact.tar.gz" -C "$STAGING_DIR"
      rm -f "$STAGING_DIR/.artifact.tar.gz"
      ;;
    *) tar -xzf "$ARTIFACT" -C "$STAGING_DIR" ;;
  esac
else
  echo "No artifact given: building inside the release directory"
  (cd "$STAGING_DIR" && pnpm run build)
fi
[ -f "$STAGING_DIR/dist/main.js" ] || fail "release has no dist/main.js."
mv "$STAGING_DIR" "$RELEASE_DIR"
trap - EXIT
echo -e "${GREEN}✓ Release ready at $RELEASE_DIR${NC}"

# ── 4. Migrations ────────────────────────────────────────
echo -e "\n${YELLOW}[4/7] Running database migrations...${NC}"
if [ "$SKIP_BACKUP" = "1" ]; then
  echo "SKIP_BACKUP=1: no pre-migration dump"
else
  BACKUP_FILE="$(BACKUP_LABEL=predeploy APP_DIR="$RELEASE_DIR" bash "$RELEASE_DIR/scripts/backup-db.sh" | tail -n 1)"
  echo -e "${GREEN}✓ Pre-migration backup: $BACKUP_FILE${NC}"
fi
(cd "$RELEASE_DIR" && pnpm run migration:run)
echo -e "${GREEN}✓ Migrations applied${NC}"

if [ "$SKIP_PM2" = "1" ]; then
  echo -e "\n${GREEN}✓ Done (SKIP_PM2=1: release prepared, current not switched)${NC}"
  exit 0
fi

# Atomically points `current` at $1: a temporary symlink renamed over the old
# one (rename(2) is atomic; `ln -sfn` alone unlinks then creates).
switch_current() {
  ln -sfn "$1" "$DEPLOY_ROOT/.current.tmp"
  mv -T "$DEPLOY_ROOT/.current.tmp" "$CURRENT_LINK"
}

reload_pm2() {
  (cd "$CURRENT_LINK" && APP_CURRENT_DIR="$CURRENT_LINK" pm2 startOrReload "$PM2_CONFIG" --update-env)
  pm2 save > /dev/null
}

is_ready() {
  local code="000"
  for _ in $(seq 1 15); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL" || true)"
    [ "$code" = "200" ] && return 0
    sleep 2
  done
  echo "Readiness check returned HTTP $code" >&2
  return 1
}

# ── 5. Switch and reload ─────────────────────────────────
echo -e "\n${YELLOW}[5/7] Switching current and reloading PM2...${NC}"
switch_current "$RELEASE_DIR"
reload_pm2 || true

# ── 6. Readiness check / automatic rollback ──────────────
echo -e "\n${YELLOW}[6/7] Checking readiness ($HEALTH_URL)...${NC}"
if ! is_ready; then
  echo -e "${RED}New release is not ready.${NC}" >&2
  if [ -n "$PREVIOUS_RELEASE" ] && [ -d "$PREVIOUS_RELEASE" ]; then
    echo -e "${YELLOW}Rolling back to $PREVIOUS_RELEASE...${NC}" >&2
    switch_current "$PREVIOUS_RELEASE"
    reload_pm2
    if is_ready; then
      echo -e "${YELLOW}Rollback OK: previous release is serving.${NC}" >&2
    else
      echo -e "${RED}Previous release is not ready either; check the database.${NC}" >&2
    fi
  else
    echo -e "${RED}No previous release to roll back to.${NC}" >&2
  fi
  echo "  Logs: pm2 logs $PM2_APP --lines 100 --nostream" >&2
  [ "$SKIP_BACKUP" = "1" ] || echo "  Pre-migration dump: ${BACKUP_FILE:-}" >&2
  exit 1
fi
echo -e "${GREEN}✓ API and database ready${NC}"

# ── 7. Prune old releases ────────────────────────────────
echo -e "\n${YELLOW}[7/7] Pruning releases (keeping $KEEP_RELEASES)...${NC}"
# Newest first by mtime; never remove the live or the previous release.
find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d ! -name '.staging-*' -printf '%T@ %p\n' \
  | sort -rn | cut -d' ' -f2- | tail -n +"$((KEEP_RELEASES + 1))" \
  | while IFS= read -r old; do
      [ "$old" = "$RELEASE_DIR" ] || [ "$old" = "$PREVIOUS_RELEASE" ] && continue
      rm -rf "$old"
      echo "removed $old"
    done

echo -e "\n${GREEN}✓ Deploy finished: ${TARGET_SHA:0:7} is live${NC}"
