#!/usr/bin/env bash
# Hermes Switch UI — one-liner installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Interstellar-code/hermes-switchui/main/install.sh | bash
#
# What it does:
#   1. Verifies Node 22+, git, pnpm
#   2. Installs hermes-agent via the Interstellar-code fork installer
#   3. Clones hermes-switchui
#   4. Sets up .env, enables the Hermes API server, installs deps,
#      and links bundled skills
#
# Re-runnable. Will skip anything already installed.

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Interstellar-code/hermes-switchui.git}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/hermes-switchui}"
GATEWAY_PORT="${GATEWAY_PORT:-8642}"
HERMES_AGENT_INSTALLER_URL="${HERMES_AGENT_INSTALLER_URL:-https://raw.githubusercontent.com/Interstellar-code/hermes-agent/main/scripts/install.sh}"
HERMES_AGENT_REPO="${HERMES_AGENT_REPO:-Interstellar-code/hermes-agent}"
HERMES_AGENT_MIN_VERSION="${HERMES_AGENT_MIN_VERSION:-0.18.0}"

# ─── helpers ──────────────────────────────────────────────────────────────

cyan()   { printf "\033[36m%s\033[0m\n" "$*"; }
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
red()    { printf "\033[31m%s\033[0m\n" "$*"; }
bold()   { printf "\033[1m%s\033[0m\n" "$*"; }

need() { command -v "$1" &>/dev/null || { red "Missing: $1"; red "$2"; exit 1; }; }

banner() {
  cat <<'EOF'

   ╭────────────────────────────────────────────╮
   │  HERMES SWITCH UI — installer              │
   │  Interstellar-code/hermes-switchui         │
   ╰────────────────────────────────────────────╯

EOF
}

# ensure_path: prepend a dir to PATH for this shell if it's not already there
ensure_path() {
  local candidate="$1"
  [[ -d "$candidate" ]] || return 0
  case ":$PATH:" in
    *":$candidate:"*) ;;
    *) export PATH="$candidate:$PATH" ;;
  esac
}

is_interstellar_hermes() {
  local project origin version
  command -v hermes &>/dev/null || return 1
  version="$(hermes --version 2>/dev/null | sed -n 's/^Hermes Agent v\([^ ]*\).*/\1/p' | head -1)"
  project="$(hermes --version 2>/dev/null | sed -n 's/^Project: //p' | head -1)"
  [[ -d "$project/.git" ]] || return 1
  origin="$(git -C "$project" remote get-url origin 2>/dev/null || true)"
  [[ "$origin" == *"$HERMES_AGENT_REPO"* ]] \
    && node -e 'const [a,b]=process.argv.slice(1).map(v=>v.split(".").map(Number)); for(let i=0;i<3;i++){if(a[i]!==b[i])process.exit(a[i]>b[i]?0:1)}' "$version" "$HERMES_AGENT_MIN_VERSION" \
    && hermes config env-path &>/dev/null \
    && hermes dashboard --help &>/dev/null
}

repo_url_matches() {
  local actual expected
  actual="$(git -C "$1" remote get-url origin 2>/dev/null || true)"
  expected="$REPO_URL"
  actual="${actual%.git}"
  expected="${expected%.git}"
  [[ "${actual%/}" == "${expected%/}" ]]
}

ensure_env_key() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp

  mkdir -p "$(dirname "$file")"
  tmp="$(mktemp)"

  if [[ -f "$file" ]]; then
    awk -v key="$key" -v value="$value" '
      BEGIN { found = 0 }
      index($0, key "=") == 1 {
        print key "=" value
        found = 1
        next
      }
      { print }
      END {
        if (!found) {
          if (NR > 0) print ""
          print key "=" value
        }
      }
    ' "$file" > "$tmp"
  else
    printf '%s=%s\n' "$key" "$value" > "$tmp"
  fi

  mv "$tmp" "$file"
}

# ─── preflight ────────────────────────────────────────────────────────────

banner
cyan "→ Checking prerequisites…"

need node "$(cat <<'MSG'
Node.js 22+ is required.
  • macOS (Homebrew):  brew install node@22
  • Linux (nvm):       nvm install 22 && nvm use 22
  • Or download:       https://nodejs.org/  (pick the LTS 22.x build)
MSG
)"
node_major=$(node -v | sed -E 's/v([0-9]+).*/\1/')
if [[ "$node_major" -lt 22 ]]; then
  red "Node $node_major detected; Hermes Switch UI needs Node 22 or newer."
  yellow "  Upgrade Node, then re-run this installer:"
  yellow "    • macOS (Homebrew):  brew install node@22 && brew link --overwrite node@22"
  yellow "    • Linux (nvm):       nvm install 22 && nvm use 22"
  yellow "    • Or download LTS:   https://nodejs.org/"
  exit 1
fi
green "  Node $(node -v) ✓"

need git "$(cat <<'MSG'
git is required to clone the repository.
  • macOS:  xcode-select --install   (or: brew install git)
  • Debian/Ubuntu:  sudo apt install git
  • Fedora:  sudo dnf install git
  • Or download:  https://git-scm.com/
MSG
)"
green "  git $(git --version | awk '{print $3}') ✓"

need curl "$(cat <<'MSG'
curl is required to fetch the hermes-agent installer.
  • Debian/Ubuntu:  sudo apt install curl
  • Fedora:  sudo dnf install curl
  • macOS:  curl ships with the OS (check your PATH if missing)
MSG
)"
green "  curl ✓"

if ! command -v pnpm &>/dev/null; then
  yellow "  pnpm not found — installing via corepack…"
  if ! corepack enable 2>/dev/null && ! npm install -g pnpm; then
    red "  Could not install pnpm automatically."
    yellow "  Install it manually, then re-run this script:"
    yellow "    • corepack enable        (bundled with Node 22)"
    yellow "    • npm install -g pnpm"
    yellow "    • https://pnpm.io/installation"
    exit 1
  fi
fi
green "  pnpm $(pnpm --version) ✓"

# ─── install hermes-agent (Interstellar fork installer) ──────────────────
# hermes-agent is NOT on PyPI. It installs from source via the
# Interstellar-code/hermes-agent install script, which handles PEP 668,
# uv, Python toolchain, Termux, etc. We only need to ensure `hermes` ends
# up on PATH before continuing.

cyan "→ Installing hermes-agent (Interstellar fork installer)…"
# Pick up hermes if it was installed in a prior run but not on PATH yet
ensure_path "$HOME/.hermes/bin"
ensure_path "$HOME/.local/bin"

if is_interstellar_hermes; then
  green "  Interstellar hermes-agent already installed ✓ ($(hermes --version 2>/dev/null | head -1))"
else
  if command -v hermes &>/dev/null; then
    yellow "  Existing 'hermes' is not a compatible Interstellar-code build — installing the required fork."
  fi
  yellow "  Delegating to: $HERMES_AGENT_INSTALLER_URL"
  HERMES_AGENT_INSTALLER="$(mktemp)"
  trap 'rm -f "$HERMES_AGENT_INSTALLER"' EXIT
  if ! curl -fsSL "$HERMES_AGENT_INSTALLER_URL" -o "$HERMES_AGENT_INSTALLER" \
    || ! bash -n "$HERMES_AGENT_INSTALLER" \
    || ! bash "$HERMES_AGENT_INSTALLER"; then
    red "  hermes-agent installer failed. See its output above for details."
    red "  Fix the reported problem, then re-run this installer."
    exit 1
  fi
  rm -f "$HERMES_AGENT_INSTALLER"
  trap - EXIT
  # The installer typically puts `hermes` in ~/.hermes/bin or ~/.local/bin
  ensure_path "$HOME/.hermes/bin"
  ensure_path "$HOME/.local/bin"
  if ! is_interstellar_hermes; then
    red "  A compatible Interstellar-code hermes-agent was not found after installation."
    yellow "  Required: $HERMES_AGENT_REPO v$HERMES_AGENT_MIN_VERSION or newer."
    exit 1
  fi
  green "  Interstellar hermes-agent installed ✓ ($(hermes --version 2>/dev/null | head -1))"
fi

# ─── clone workspace ──────────────────────────────────────────────────────

cyan "→ Cloning hermes-switchui…"
CHECKOUT_UPDATE_STATUS="fresh clone"
if [[ -d "$INSTALL_DIR/.git" ]]; then
  if ! repo_url_matches "$INSTALL_DIR"; then
    red "  Existing checkout has a different origin: $INSTALL_DIR"
    red "  Expected: $REPO_URL"
    red "  Move it or set INSTALL_DIR to a separate path."
    exit 1
  fi
  # Re-run path: never let a pull abort the installer. Users edit .env (and
  # other files) in place, so the working tree is almost always dirty.
  if [[ -n "$(git -C "$INSTALL_DIR" status --porcelain 2>/dev/null)" ]]; then
    CHECKOUT_UPDATE_STATUS="local changes; update skipped"
    yellow "  Local changes detected in $INSTALL_DIR — skipping update."
    yellow "  Commit/stash manually to update."
  else
    yellow "  $INSTALL_DIR exists; pulling latest"
    if ! git -C "$INSTALL_DIR" pull --ff-only; then
      CHECKOUT_UPDATE_STATUS="diverged checkout; update failed"
      yellow "  Could not fast-forward $INSTALL_DIR (diverged?) — skipping update."
      yellow "  Reconcile manually (e.g. git pull) to update."
    else
      CHECKOUT_UPDATE_STATUS="updated"
    fi
  fi
elif [[ -e "$INSTALL_DIR" ]]; then
  red "Path exists but is not a git repo: $INSTALL_DIR"
  red "Move/remove it or set INSTALL_DIR=..."
  exit 1
else
  git clone "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"
if [[ "$CHECKOUT_UPDATE_STATUS" == "fresh clone" || "$CHECKOUT_UPDATE_STATUS" == "updated" ]]; then
  green "  Workspace ready at $INSTALL_DIR ✓ ($CHECKOUT_UPDATE_STATUS)"
else
  yellow "  Workspace ready at $INSTALL_DIR (using existing checkout: $CHECKOUT_UPDATE_STATUS)"
fi

# ─── env + install ────────────────────────────────────────────────────────

cyan "→ Configuring .env…"
if [[ ! -f .env ]]; then
  cp .env.example .env
fi
ensure_env_key "$INSTALL_DIR/.env" "HERMES_API_URL" "http://127.0.0.1:${GATEWAY_PORT}"
green "  .env ready ✓"

cyan "→ Enabling Hermes API server…"
HERMES_ENV_PATH="$(hermes config env-path 2>/dev/null || true)"
if [[ -z "$HERMES_ENV_PATH" ]]; then
  HERMES_ENV_PATH="$HOME/.hermes/.env"
fi
ensure_env_key "$HERMES_ENV_PATH" "API_SERVER_ENABLED" "true"
green "  Hermes env updated: $HERMES_ENV_PATH ✓"

# API_SERVER_ENABLED is read at gateway startup. If a gateway is already
# running, the flag won't apply until it restarts — warn but never auto-kill.
if command -v hermes &>/dev/null; then
  GW_STATUS="$(hermes gateway status 2>/dev/null || true)"
  if echo "$GW_STATUS" | grep -qiE "running|active|online"; then
    yellow ""
    yellow "⚠  A Hermes gateway is already running."
    yellow "   API_SERVER_ENABLED=true takes effect only after a restart:"
    yellow "     hermes gateway restart"
    yellow "   (or stop it before running 'pnpm start:all')."
    yellow ""
  fi
fi

# Guard against a common foot-gun: users editing ~/.hermes/.env by hand and
# writing env var names without underscores (APISERVERENABLED vs
# API_SERVER_ENABLED). The gateway reads exact names — typos are silently
# ignored, which produces a "gateway starts but API server never binds"
# failure that's hard to diagnose from the UI.
if [[ -f "$HERMES_ENV_PATH" ]]; then
  SUSPICIOUS=$(grep -E "^(API[A-Z]+|HERMES[A-Z]+)=" "$HERMES_ENV_PATH" 2>/dev/null \
    | grep -vE "^(API_|HERMES_)" || true)
  if [[ -n "$SUSPICIOUS" ]]; then
    yellow ""
    yellow "⚠  Found env var names missing underscores in $HERMES_ENV_PATH:"
    echo "$SUSPICIOUS" | sed 's/^/      /'
    yellow "   The gateway reads names with underscores (API_SERVER_ENABLED,"
    yellow "   not APISERVERENABLED). These lines will be silently ignored."
    yellow "   Fix them and run: hermes gateway run --replace"
    yellow ""
  fi
fi

cyan "→ Installing npm deps (pnpm install --frozen-lockfile)…"
pnpm install --frozen-lockfile --silent
green "  deps installed ✓"

# ─── seed Hermes skills (Conductor needs workspace-dispatch) ─────────────

cyan "→ Linking bundled skills into ~/.hermes/skills…"
HERMES_SKILLS_DIR="$HOME/.hermes/skills"
mkdir -p "$HERMES_SKILLS_DIR"
if [[ -d "$INSTALL_DIR/skills" ]]; then
  for skill_path in "$INSTALL_DIR/skills"/*/; do
    skill_name=$(basename "$skill_path")
    target="$HERMES_SKILLS_DIR/$skill_name"
    if [[ -e "$target" || -L "$target" ]]; then
      continue
    fi
    ln -sf "$skill_path" "$target" 2>/dev/null && \
      green "  linked $skill_name ✓" || true
  done
fi

# ─── done ─────────────────────────────────────────────────────────────────

bold ""
bold "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
green "  ✓ Install complete!"
bold "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [[ "$CHECKOUT_UPDATE_STATUS" != "fresh clone" && "$CHECKOUT_UPDATE_STATUS" != "updated" ]]; then
  yellow "  ⚠ Repository was not updated: $CHECKOUT_UPDATE_STATUS."
  yellow "    Reconcile the checkout manually before relying on the latest release."
fi
cat <<EOF

  Installed to:   $INSTALL_DIR

  Start everything (gateway + dashboard + UI) with one command:

       cd $INSTALL_DIR
       pnpm start:all

  Then open:      http://localhost:3000

  On first launch, the in-browser onboarding wizard walks you
  through picking a provider and entering your API key — no need
  to hand-edit any config files.

  ── Want Hermes always on (survives reboot)? ──
  Install the gateway as a background service:

       hermes gateway install     # Linux: systemd · macOS: launchd
       hermes gateway start

  Then you only need the UI:  pnpm dev
  (Manage it with: hermes gateway status | stop | restart)
  Note: WSL has no systemd by default — stick with 'pnpm start:all' there.

  ── IMPORTANT: the Hermes dashboard (port 9119) ──
  Switch UI needs TWO backends:
    • gateway   (:8642) — chat
    • dashboard (:9119) — sessions, skills, memory, kanban, jobs
  Without the dashboard those features WILL NOT WORK. Start it
  (headless — keep it running in its own terminal or as a service):

       hermes dashboard --no-open --skip-build

EOF
yellow "  Note: if the Hermes Agent gateway was already running before"
yellow "  this install, restart it (or just use 'pnpm start:all') so"
yellow "  API_SERVER_ENABLED=true takes effect."
echo ""

# ─── backend reachability check ───────────────────────────────────────────
# Probe both backends so the user knows BEFORE opening the UI whether the
# dashboard (the rich-features backend) is up. 'pnpm start:all' now starts
# the dashboard together with the gateway and UI.
cyan "→ Checking backends…"
gw_up=0; dash_up=0
if command -v curl &>/dev/null; then
  curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:${GATEWAY_PORT}/health" 2>/dev/null && gw_up=1 || true
  curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:9119" 2>/dev/null && dash_up=1 || true
fi
if [[ "$gw_up" == "1" ]]; then green "  gateway   :${GATEWAY_PORT} reachable ✓"; else yellow "  gateway   :${GATEWAY_PORT} not running (start with 'pnpm start:all')"; fi
if [[ "$dash_up" == "1" ]]; then
  green "  dashboard :9119 reachable ✓"
else
  red   "  dashboard :9119 NOT running ⚠"
  yellow "    Sessions, skills, memory, kanban and jobs will NOT work until"
  yellow "    you start it:  hermes dashboard --no-open --skip-build"
fi
echo ""
cyan "Happy building. 🚀"
