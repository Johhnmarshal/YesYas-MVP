#!/usr/bin/env bash
#
# YesYas! v1 — interactive setup script
#
# Usage:
#   bash scripts/setup.sh           # show the menu
#   bash scripts/setup.sh all       # run every step with confirmation between
#   bash scripts/setup.sh <step>    # run a single step (see list below)
#
# Steps:
#   preflight        Check node, npm, and supabase CLI are installed
#   env              Verify .env exists and has the two required keys
#   install          Run `npm install` (swaps firebase out, pulls Supabase in)
#   local-start      Start the local Supabase stack (docker required)
#   local-reset      Apply migrations + seed locally, destructively
#   local-test       Run the RLS regression test (pgTAP)
#   local-stop       Stop the local Supabase stack
#   remote-link      Link this repo to your staging Supabase project
#   remote-push      Apply migrations to the linked remote project
#   remote-seed      Print instructions to load seed data on the remote
#   run-app          Start Expo dev server
#
# Recommended first-time flow:
#   bash scripts/setup.sh preflight
#   bash scripts/setup.sh env        # fill in .env first, then run this
#   bash scripts/setup.sh install
#   bash scripts/setup.sh local-start
#   bash scripts/setup.sh local-reset
#   bash scripts/setup.sh local-test
#   bash scripts/setup.sh remote-link
#   bash scripts/setup.sh remote-push
#   bash scripts/setup.sh remote-seed
#   bash scripts/setup.sh run-app

set -euo pipefail

# ---------- cosmetics ----------
if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'
  GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; RESET=""
fi

say()  { printf "%s\n" "$*"; }
bold() { printf "%s%s%s\n" "$BOLD" "$*" "$RESET"; }
ok()   { printf "%s%s%s\n" "$GREEN" "$*" "$RESET"; }
warn() { printf "%s%s%s\n" "$YELLOW" "$*" "$RESET"; }
err()  { printf "%s%s%s\n" "$RED" "$*" "$RESET" >&2; }
hr()   { printf '%s\n' "--------------------------------------------------------------"; }

banner() {
  hr
  bold "YesYas! — $1"
  hr
}

confirm() {
  # $1 = prompt; returns 0 on yes.
  local prompt="${1:-Continue?}"
  local reply
  read -r -p "$prompt [y/N] " reply || true
  case "${reply:-}" in
    y|Y|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

# ---------- directory sanity ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR"

if [ ! -f package.json ]; then
  err "Run this script from the YesYAs App folder (package.json not found in $APP_DIR)."
  exit 1
fi

# If supabase is installed as a local dev dep (npm install supabase --save-dev),
# put node_modules/.bin on PATH so a bare `supabase` call resolves to it.
if [ -d "$APP_DIR/node_modules/.bin" ]; then
  export PATH="$APP_DIR/node_modules/.bin:$PATH"
fi

# ---------- steps ----------

step_preflight() {
  banner "Preflight: checking required tools"

  local ok=true

  if command -v node >/dev/null 2>&1; then
    ok "node:      $(node --version)"
  elif command -v npm >/dev/null 2>&1; then
    warn "node:      not visible on PATH, but npm is — assuming node is usable via npm"
  else
    err "node:      MISSING — install Node 20 LTS (https://nodejs.org/)"
    ok=false
  fi

  if command -v npm >/dev/null 2>&1; then
    ok "npm:       $(npm --version)"
  else
    err "npm:       MISSING — comes with Node"
    ok=false
  fi

  if command -v supabase >/dev/null 2>&1; then
    ok "supabase:  $(supabase --version)"
  else
    err "supabase:  MISSING — install it one of these ways:"
    err "           Windows (recommended): npm install supabase --save-dev   (then rerun this script)"
    err "           Windows (scoop):       scoop bucket add supabase https://github.com/supabase/scoop-bucket.git && scoop install supabase"
    err "           macOS:                 brew install supabase/tap/supabase"
    err "           Linux/other:           download from https://github.com/supabase/cli/releases/latest"
    ok=false
  fi

  if command -v docker >/dev/null 2>&1; then
    if docker info >/dev/null 2>&1; then
      ok "docker:    running"
    else
      warn "docker:    installed but not running (needed for local-start)"
    fi
  else
    warn "docker:    MISSING — only needed for local-start. Install Docker Desktop if you want a local DB."
  fi

  if $ok; then
    ok ""
    ok "Preflight passed."
  else
    err ""
    err "Install the missing tools and rerun: bash scripts/setup.sh preflight"
    exit 1
  fi
}

step_env() {
  banner "Env: check .env"

  if [ ! -f .env ]; then
    warn ".env not found. Copying from .env.example…"
    cp .env.example .env
    ok "Created .env. Open it and paste:"
    say "  - EXPO_PUBLIC_SUPABASE_URL       (Supabase dashboard → Settings → API → Project URL)"
    say "  - EXPO_PUBLIC_SUPABASE_ANON_KEY  (Supabase dashboard → Settings → API → anon public)"
    say ""
    say "Then rerun: bash scripts/setup.sh env"
    exit 1
  fi

  local url key
  url=$(grep -E '^EXPO_PUBLIC_SUPABASE_URL=' .env | cut -d= -f2- || true)
  key=$(grep -E '^EXPO_PUBLIC_SUPABASE_ANON_KEY=' .env | cut -d= -f2- || true)

  if [ -z "$url" ] || [[ "$url" == *"YOUR-PROJECT-REF"* ]]; then
    err "EXPO_PUBLIC_SUPABASE_URL is missing or still a placeholder in .env"
    exit 1
  fi
  if [ -z "$key" ] || [[ "$key" == *"your-anon-key"* ]]; then
    err "EXPO_PUBLIC_SUPABASE_ANON_KEY is missing or still a placeholder in .env"
    exit 1
  fi

  ok "EXPO_PUBLIC_SUPABASE_URL:      ${url:0:40}…"
  ok "EXPO_PUBLIC_SUPABASE_ANON_KEY: ${key:0:12}…(redacted)"

  # Extract project-ref from URL, we'll use it for `supabase link` later.
  local ref
  ref=$(printf '%s' "$url" | sed -E 's|https?://([^.]+)\.supabase\.co.*|\1|')
  if [ -n "$ref" ] && [ "$ref" != "$url" ]; then
    ok "Detected project ref: $ref"
    printf '%s' "$ref" > .supabase-ref
  fi
}

step_install() {
  banner "Install: npm install"
  if [ ! -f package-lock.json ]; then
    warn "No package-lock.json. Running npm install (this will generate one)."
    npm install
  else
    # npm ci is stricter and matches the lockfile exactly — good for reproducibility.
    # But if deps were just added (firebase removed, supabase added), the lockfile
    # is stale, so fall back to `npm install` the first time.
    if grep -q '"firebase"' package-lock.json 2>/dev/null; then
      warn "package-lock.json still references firebase — regenerating with npm install"
      rm -f package-lock.json
      npm install
    else
      npm ci
    fi
  fi
  ok "Dependencies installed."

  # Optional: supply-chain audit.
  if confirm "Run npm audit now? (recommended)"; then
    npm run audit || warn "Audit found issues — review the output above."
  fi
}

step_local_start() {
  banner "Local: supabase start"
  say "${DIM}First run pulls Postgres + Auth + Studio Docker images (~1-2 min).${RESET}"
  supabase start
  ok "Local stack is up."
  say "  Studio UI:  http://localhost:54323"
  say "  DB:         postgresql://postgres:postgres@localhost:54322/postgres"
}

step_local_reset() {
  banner "Local: supabase db reset"
  warn "This DROPS the local database and re-applies all migrations + seed."
  if ! confirm "Proceed with destructive reset of LOCAL db?"; then
    say "Skipped."
    return 0
  fi
  supabase db reset
  ok "Local DB is fresh: 3 migrations applied + seed loaded."
}

step_local_test() {
  banner "Local: RLS regression test"
  say "Running supabase/tests/rls_test.sql (pgTAP — 8 assertions)."
  if supabase test db; then
    ok ""
    ok "ALL TESTS PASSED. User A cannot read user B's desires."
  else
    err ""
    err "TESTS FAILED. Do not ship. Halt and review the RLS policies."
    exit 1
  fi
}

step_local_stop() {
  banner "Local: supabase stop"
  supabase stop
  ok "Local stack stopped."
}

step_remote_link() {
  banner "Remote: supabase link"
  local ref=""
  if [ -f .supabase-ref ]; then
    ref=$(cat .supabase-ref)
  fi
  if [ -z "$ref" ]; then
    read -r -p "Paste your Supabase project ref (the subdomain in your URL): " ref
  fi
  if [ -z "$ref" ]; then
    err "No project ref supplied."
    exit 1
  fi
  supabase link --project-ref "$ref"
  ok "Linked to $ref."
}

step_remote_push() {
  banner "Remote: supabase db push"
  warn "This will apply the migrations in supabase/migrations/ to your LINKED remote project."
  if ! confirm "Proceed?"; then
    say "Skipped."
    return 0
  fi
  supabase db push
  ok "Migrations applied to remote."
}

step_remote_seed() {
  banner "Remote: apply seed.sql"
  cat <<EOF
The CLI does not push seed.sql automatically to a remote project. Two options:

1. Easiest (dashboard):
     • Open your project in the Supabase dashboard.
     • SQL Editor → New query.
     • Paste the contents of supabase/seed.sql.
     • Run.

2. CLI (if you have psql installed and the DB_URL):
     supabase db remote commit  # pulls your remote schema into a migration (optional)
     psql "\$DB_URL" -f supabase/seed.sql
     # DB_URL = postgresql://postgres:<your-db-password>@db.<ref>.supabase.co:5432/postgres

After either path, verify with the dashboard's Table Editor that
'desire_library_items' has 15 rows.
EOF
}

step_run_app() {
  banner "Run: expo start"
  say "Press ${BOLD}i${RESET} for iOS, ${BOLD}a${RESET} for Android, ${BOLD}w${RESET} for web. Ctrl+C to stop."
  npm start
}

# ---------- orchestrator ----------

run_all() {
  local steps=(preflight env install local-start local-reset local-test remote-link remote-push remote-seed)
  for s in "${steps[@]}"; do
    if ! confirm "Run step: ${BOLD}$s${RESET}?"; then
      say "Skipped $s."
      continue
    fi
    "step_$(echo "$s" | tr '-' '_')"
    say ""
  done
  bold "All selected steps complete."
  say "Run the app with: bash scripts/setup.sh run-app"
}

show_menu() {
  banner "YesYas! setup"
  cat <<EOF
Steps (pass as an arg: ${DIM}bash scripts/setup.sh <step>${RESET}):

  ${BOLD}preflight${RESET}      Check node, npm, and supabase CLI are installed
  ${BOLD}env${RESET}            Verify .env is filled in
  ${BOLD}install${RESET}        npm install (swaps firebase → supabase)

  ${BOLD}local-start${RESET}    Start local Supabase stack (needs Docker)
  ${BOLD}local-reset${RESET}    Apply migrations + seed locally (destructive)
  ${BOLD}local-test${RESET}     Run the RLS regression test
  ${BOLD}local-stop${RESET}     Stop local Supabase stack

  ${BOLD}remote-link${RESET}    Link this repo to your staging Supabase project
  ${BOLD}remote-push${RESET}    Push migrations to the linked remote project
  ${BOLD}remote-seed${RESET}    Instructions for seeding remote data

  ${BOLD}run-app${RESET}        npm start (launch Expo)

Or: ${BOLD}bash scripts/setup.sh all${RESET}   (step through everything with confirmations)

Recommended first-time order:
  preflight → env → install → local-start → local-reset → local-test →
  remote-link → remote-push → remote-seed → run-app
EOF
}

# ---------- dispatch ----------
case "${1:-}" in
  ""|help|-h|--help) show_menu ;;
  all)              run_all ;;
  preflight)        step_preflight ;;
  env)              step_env ;;
  install)          step_install ;;
  local-start)      step_local_start ;;
  local-reset)      step_local_reset ;;
  local-test)       step_local_test ;;
  local-stop)       step_local_stop ;;
  remote-link)      step_remote_link ;;
  remote-push)      step_remote_push ;;
  remote-seed)      step_remote_seed ;;
  run-app)          step_run_app ;;
  *)
    err "Unknown step: $1"
    say ""
    show_menu
    exit 1
    ;;
esac
