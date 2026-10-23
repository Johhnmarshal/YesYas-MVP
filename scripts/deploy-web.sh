#!/usr/bin/env bash
#
# YesYas! v1 — web deploy helper (Vercel)
#
# Usage:
#   bash scripts/deploy-web.sh           # show menu
#   bash scripts/deploy-web.sh build     # local web export to dist/ (sanity check)
#   bash scripts/deploy-web.sh login     # sign in to Vercel
#   bash scripts/deploy-web.sh link      # link this folder to a Vercel project
#   bash scripts/deploy-web.sh env       # push EXPO_PUBLIC_* env vars to Vercel
#   bash scripts/deploy-web.sh preview   # deploy a throwaway preview URL
#   bash scripts/deploy-web.sh prod      # deploy to production
#   bash scripts/deploy-web.sh url       # print the production URL
#   bash scripts/deploy-web.sh all       # walk through every step
#
# Recommended first-time flow:
#   build → login → link → env → preview → (test it) → prod

set -euo pipefail

# ---------- cosmetics ----------
if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'
  GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; RESET=""
fi

say()  { printf "%s\n" "$*"; }
bold() { printf "%s%s%s\n" "$BOLD" "$*" "$RESET"; }
ok()   { printf "%s%s%s\n" "$GREEN" "$*" "$RESET"; }
warn() { printf "%s%s%s\n" "$YELLOW" "$*" "$RESET"; }
err()  { printf "%s%s%s\n" "$RED" "$*" "$RESET" >&2; }
hr()   { printf '%s\n' "--------------------------------------------------------------"; }
banner() { hr; bold "YesYas! — $1"; hr; }

confirm() {
  local prompt="${1:-Continue?}" reply
  read -r -p "$prompt [y/N] " reply || true
  case "${reply:-}" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

# ---------- directory + PATH sanity ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR"

if [ ! -f package.json ]; then
  err "Run this script from the YesYAs App folder."
  exit 1
fi

# Pick up locally-installed CLIs (vercel, supabase, expo) from node_modules/.bin.
if [ -d "$APP_DIR/node_modules/.bin" ]; then
  export PATH="$APP_DIR/node_modules/.bin:$PATH"
fi

# Always invoke vercel via npx so it works whether installed locally or globally.
VERCEL="npx --yes vercel"

# ---------- steps ----------

step_build() {
  banner "Build: expo export -p web"
  say "${DIM}Produces a static dist/ folder. This is a local sanity check;"
  say "Vercel will rerun the same command in its build container.${RESET}"
  npx expo export -p web
  ok "dist/ written. Open dist/index.html in a browser to spot-check."
}

step_login() {
  banner "Login: vercel login"
  say "Opens a browser to authenticate. One-time per machine."
  $VERCEL login
  ok "Logged in to Vercel."
}

step_link() {
  banner "Link: connect this folder to a Vercel project"
  say "First run: choose 'Set up and deploy', accept the defaults, name it ${BOLD}yesyas${RESET}."
  say "Subsequent runs: this is a no-op (already linked, info stored in .vercel/)."
  $VERCEL link
  ok "Linked. .vercel/project.json now records project + org IDs."
}

step_env() {
  banner "Env: push EXPO_PUBLIC_* vars to Vercel"

  if [ ! -f .env ]; then
    err "No .env file. Run: bash scripts/setup.sh env first."
    exit 1
  fi

  local url key
  url=$(grep -E '^EXPO_PUBLIC_SUPABASE_URL=' .env | cut -d= -f2- || true)
  key=$(grep -E '^EXPO_PUBLIC_SUPABASE_ANON_KEY=' .env | cut -d= -f2- || true)

  if [ -z "$url" ] || [ -z "$key" ]; then
    err "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY in .env"
    exit 1
  fi

  warn "These are baked into the bundle at build time. EXPO_PUBLIC_* values"
  warn "ship to the browser and are not secret — that's expected for the anon key."

  say ""
  say "Pushing to ${BOLD}production${RESET} environment:"
  printf '%s' "$url" | $VERCEL env add EXPO_PUBLIC_SUPABASE_URL production --force
  printf '%s' "$key" | $VERCEL env add EXPO_PUBLIC_SUPABASE_ANON_KEY production --force

  say ""
  say "Pushing to ${BOLD}preview${RESET} environment too (so preview URLs work):"
  printf '%s' "$url" | $VERCEL env add EXPO_PUBLIC_SUPABASE_URL preview --force
  printf '%s' "$key" | $VERCEL env add EXPO_PUBLIC_SUPABASE_ANON_KEY preview --force

  ok "Env vars set on Vercel."
}

step_preview() {
  banner "Deploy: preview URL"
  say "Vercel runs ${DIM}npm install && npx expo export -p web${RESET} in its container,"
  say "then serves the dist/ output behind a temporary URL."
  $VERCEL
  ok ""
  ok "Preview deployed. Add the printed URL to Supabase → Auth → URL Configuration"
  ok "before testing magic-link sign-in (see notes below)."
}

step_prod() {
  banner "Deploy: production"
  warn "This promotes the latest commit/build to your production URL."
  if ! confirm "Proceed?"; then say "Skipped."; return 0; fi
  $VERCEL --prod
  ok "Production deploy complete."
}

step_url() {
  banner "Production URL"
  $VERCEL inspect --prod 2>/dev/null | grep -i 'url' || $VERCEL ls
}

# ---------- orchestrator ----------

run_all() {
  local steps=(build login link env preview)
  for s in "${steps[@]}"; do
    if ! confirm "Run step: ${BOLD}$s${RESET}?"; then say "Skipped $s."; continue; fi
    "step_$s"
    say ""
  done
  bold "Preview is live."
  say "Test sign-in on the preview URL, then promote with: bash scripts/deploy-web.sh prod"
}

show_menu() {
  banner "YesYas! web deploy"
  cat <<EOF
Steps (pass as an arg: ${DIM}bash scripts/deploy-web.sh <step>${RESET}):

  ${BOLD}build${RESET}      Local sanity-check export to dist/
  ${BOLD}login${RESET}      vercel login (one-time)
  ${BOLD}link${RESET}       Connect this folder to a Vercel project
  ${BOLD}env${RESET}        Push EXPO_PUBLIC_* vars from .env to Vercel
  ${BOLD}preview${RESET}    Deploy a temporary preview URL
  ${BOLD}prod${RESET}       Deploy to production URL
  ${BOLD}url${RESET}        Print the current production URL

Or: ${BOLD}bash scripts/deploy-web.sh all${RESET}   (walks through build → preview)

After deploy, add the deployed URL to:
  Supabase dashboard → Auth → URL Configuration → Site URL + Redirect URLs
or magic-link sign-in will fail.
EOF
}

# ---------- dispatch ----------
case "${1:-}" in
  ""|help|-h|--help) show_menu ;;
  all)        run_all ;;
  build)      step_build ;;
  login)      step_login ;;
  link)       step_link ;;
  env)        step_env ;;
  preview)    step_preview ;;
  prod)       step_prod ;;
  url)        step_url ;;
  *)
    err "Unknown step: $1"
    say ""
    show_menu
    exit 1
    ;;
esac
