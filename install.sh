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
# SWITCHUI_REF pins the checkout to a tag, branch or commit (e.g.
# SWITCHUI_REF=v2.5.32). Unset = current behaviour: clone the default branch
# and fast-forward it on re-runs.
SWITCHUI_REF="${SWITCHUI_REF:-}"
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

# version_ge HAVE WANT — dotted numeric compare, tolerant of extra components
# and of dev/rc suffixes ("0.19.9.dev1" is treated as "0.19.9.1"). Pure bash so
# it stays testable without Node.
version_ge() {
  local have want
  have="${1%%[!0-9.]*}"
  want="${2%%[!0-9.]*}"
  local -a h w
  local oldifs="$IFS"
  IFS='.' read -r -a h <<< "$have"
  IFS='.' read -r -a w <<< "$want"
  IFS="$oldifs"
  local n=${#h[@]}
  [[ ${#w[@]} -gt $n ]] && n=${#w[@]}
  local i hv wv
  for (( i = 0; i < n; i++ )); do
    hv="${h[i]:-0}"; hv="${hv//[!0-9]/}"; hv="${hv:-0}"
    wv="${w[i]:-0}"; wv="${wv//[!0-9]/}"; wv="${wv:-0}"
    if (( 10#$hv > 10#$wv )); then return 0; fi
    if (( 10#$hv < 10#$wv )); then return 1; fi
  done
  return 0
}

# Diagnostics published by is_interstellar_hermes so callers can print what
# actually went wrong instead of "something was wrong".
HERMES_CHECK_RAW=""
HERMES_CHECK_VERSION=""
HERMES_CHECK_PROJECT=""
HERMES_CHECK_ORIGIN=""
HERMES_CHECK_INSTALL_METHOD=""
HERMES_CHECK_PROVENANCE="unknown"
HERMES_CHECK_FAILURES=()

# is_interstellar_hermes: decide whether the `hermes` on PATH is a build this
# UI can drive.
#
# Provenance vs capability — these are two different questions and only one of
# them needs a git checkout:
#
#   * With a checkout we can read `origin` and *prove* the fork. A wrong origin
#     is a hard fail; we will not silently accept a different fork.
#   * A pipx/pip install has no remote to inspect, and no fork marker survives
#     in the artifact — the "· upstream <sha>" suffix in `hermes --version` is
#     rendered from the git checkout (hermes_cli/banner.py), so it is absent
#     too. There we fall back to capability evidence: the version floor plus
#     the two subcommands Switch UI depends on. That proves the binary is
#     *adequate*, not that it is *ours*. Callers say so out loud.
#
# Previously all four checks sat behind `[[ -d "$project/.git" ]]`, so a
# non-git install failed exactly like a missing one.
is_interstellar_hermes() {
  HERMES_CHECK_RAW=""
  HERMES_CHECK_VERSION=""
  HERMES_CHECK_PROJECT=""
  HERMES_CHECK_ORIGIN=""
  HERMES_CHECK_INSTALL_METHOD=""
  HERMES_CHECK_PROVENANCE="unknown"
  HERMES_CHECK_FAILURES=()

  if ! command -v hermes &>/dev/null; then
    HERMES_CHECK_FAILURES+=("no 'hermes' binary on PATH")
    return 1
  fi

  # 2>&1: if the binary errors we want the error text in the diagnostics.
  HERMES_CHECK_RAW="$(hermes --version 2>&1 || true)"

  HERMES_CHECK_VERSION="$(printf '%s\n' "$HERMES_CHECK_RAW" \
    | sed -n 's/^Hermes Agent v\([^ ]*\).*/\1/p' | head -1)"
  HERMES_CHECK_INSTALL_METHOD="$(printf '%s\n' "$HERMES_CHECK_RAW" \
    | sed -n 's/^Install method: *//p' | head -1)"

  # Current agents print "Install directory:"; older ones printed "Project:".
  # Neither is guaranteed, so fall back to the conventional install path.
  HERMES_CHECK_PROJECT="$(printf '%s\n' "$HERMES_CHECK_RAW" \
    | sed -n 's/^Install directory: *//p' | head -1)"
  if [[ -z "$HERMES_CHECK_PROJECT" ]]; then
    HERMES_CHECK_PROJECT="$(printf '%s\n' "$HERMES_CHECK_RAW" \
      | sed -n 's/^Project: *//p' | head -1)"
  fi
  if [[ -z "$HERMES_CHECK_PROJECT" ]]; then
    HERMES_CHECK_PROJECT="$HOME/.hermes/hermes-agent"
  fi

  if [[ -z "$HERMES_CHECK_VERSION" ]]; then
    HERMES_CHECK_FAILURES+=("could not parse a version out of 'hermes --version'")
  elif ! version_ge "$HERMES_CHECK_VERSION" "$HERMES_AGENT_MIN_VERSION"; then
    HERMES_CHECK_FAILURES+=("version $HERMES_CHECK_VERSION is older than the required $HERMES_AGENT_MIN_VERSION")
  fi

  if [[ -d "$HERMES_CHECK_PROJECT/.git" ]]; then
    HERMES_CHECK_ORIGIN="$(git -C "$HERMES_CHECK_PROJECT" remote get-url origin 2>/dev/null || true)"
    if [[ "$HERMES_CHECK_ORIGIN" == *"$HERMES_AGENT_REPO"* ]]; then
      HERMES_CHECK_PROVENANCE="verified via git origin"
    else
      HERMES_CHECK_PROVENANCE="WRONG FORK"
      HERMES_CHECK_FAILURES+=("git origin at $HERMES_CHECK_PROJECT is '${HERMES_CHECK_ORIGIN:-<none>}', expected it to contain '$HERMES_AGENT_REPO'")
    fi
  else
    HERMES_CHECK_PROVENANCE="unverified (no git checkout at $HERMES_CHECK_PROJECT)"
  fi

  hermes config env-path &>/dev/null \
    || HERMES_CHECK_FAILURES+=("'hermes config env-path' failed — this build cannot report its .env location")
  hermes dashboard --help &>/dev/null \
    || HERMES_CHECK_FAILURES+=("'hermes dashboard --help' failed — this build has no dashboard subcommand")

  [[ ${#HERMES_CHECK_FAILURES[@]} -eq 0 ]]
}

print_hermes_check_diagnostics() {
  local f
  yellow "  Diagnostics:"
  yellow "    computed project path : ${HERMES_CHECK_PROJECT:-<none>}"
  yellow "    parsed version        : ${HERMES_CHECK_VERSION:-<could not parse>}"
  yellow "    install method        : ${HERMES_CHECK_INSTALL_METHOD:-<unknown>}"
  yellow "    git origin            : ${HERMES_CHECK_ORIGIN:-<no git checkout>}"
  yellow "    provenance            : ${HERMES_CHECK_PROVENANCE}"
  if [[ ${#HERMES_CHECK_FAILURES[@]} -gt 0 ]]; then
    yellow "    failed checks:"
    for f in ${HERMES_CHECK_FAILURES[@]+"${HERMES_CHECK_FAILURES[@]}"}; do
      yellow "      • $f"
    done
  fi
  yellow "    raw 'hermes --version' output:"
  if [[ -n "$HERMES_CHECK_RAW" ]]; then
    printf '%s\n' "$HERMES_CHECK_RAW" | sed 's/^/        /'
  else
    yellow "        <no output>"
  fi
}

# Say out loud when we accepted a build on capability evidence alone.
warn_if_provenance_unverified() {
  case "$HERMES_CHECK_PROVENANCE" in
    unverified*)
      yellow "  Note: no git checkout at ${HERMES_CHECK_PROJECT} (install method:"
      yellow "  ${HERMES_CHECK_INSTALL_METHOD:-unknown}), so the fork could not be confirmed from a"
      yellow "  git remote. Accepted on capability evidence: version floor plus"
      yellow "  'hermes config env-path' and 'hermes dashboard'."
      ;;
  esac
}

repo_url_matches() {
  local actual expected
  actual="$(git -C "$1" remote get-url origin 2>/dev/null || true)"
  expected="$REPO_URL"
  actual="${actual%.git}"
  expected="${expected%.git}"
  [[ "${actual%/}" == "${expected%/}" ]]
}

# ensure_env_key FILE KEY VALUE — set KEY=VALUE in a dotenv file, exactly once.
#
# Handles the forms that actually turn up in ~/.hermes/.env and .env:
#   KEY=v              → replaced in place
#   export KEY=v       → replaced in place, the `export ` prefix preserved
#   #KEY=v  /  # KEY=v → uncommented in place
# The commented form matters: .env.example ships
# `# HERMES_API_TOKEN=your-gateway-secret`, and the old prefix-match ("does the
# line start with KEY=") missed it and appended a second definition.
#
# Any *extra* active definitions of the same key are dropped. dotenv readers
# take the last occurrence, so a stale duplicate below our edit would silently
# win.
ensure_env_key() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp

  mkdir -p "$(dirname "$file")"
  tmp="$(mktemp)"

  if [[ -f "$file" ]]; then
    # Values travel via ENVIRON, not -v: awk expands backslash escapes in -v
    # assignments and we must write secrets through byte-for-byte.
    EK_KEY="$key" EK_VALUE="$value" awk '
      function active_prefix(line,   s) {
        s = line
        sub(/^[ \t]+/, "", s)
        if (sub(/^export[ \t]+/, "", s)) {
          return (index(s, key "=") == 1) ? "export " : "\001"
        }
        return (index(s, key "=") == 1) ? "" : "\001"
      }
      function is_commented(line,   s) {
        s = line
        sub(/^[ \t]+/, "", s)
        if (!sub(/^#+[ \t]*/, "", s)) return 0
        sub(/^export[ \t]+/, "", s)
        return index(s, key "=") == 1
      }
      BEGIN { key = ENVIRON["EK_KEY"]; value = ENVIRON["EK_VALUE"] }
      { lines[NR] = $0 }
      END {
        has_active = 0
        for (i = 1; i <= NR; i++) {
          if (active_prefix(lines[i]) != "\001") { has_active = 1; break }
        }
        written = 0
        for (i = 1; i <= NR; i++) {
          line = lines[i]
          prefix = active_prefix(line)
          if (has_active && prefix != "\001") {
            if (!written) { print prefix key "=" value; written = 1 }
            continue    # drop duplicate definitions
          }
          if (!has_active && !written && is_commented(line)) {
            print key "=" value      # uncomment in place
            written = 1
            continue
          }
          print line
        }
        if (!written) {
          if (NR > 0 && lines[NR] != "") print ""
          print key "=" value
        }
      }
    ' "$file" > "$tmp"
  else
    printf '%s=%s\n' "$key" "$value" > "$tmp"
  fi

  mv "$tmp" "$file"
  # These files hold API_SERVER_KEY / HERMES_API_TOKEN. mktemp already gives
  # 0600 and mv carries that over, but make it deliberate rather than a
  # side effect — a world-readable .env with a gateway key in it is a bug.
  chmod 600 "$file" 2>/dev/null || true
}

# read_env_key FILE KEY — echo the active value of KEY (last definition wins,
# matching python-dotenv). Commented-out lines are ignored on purpose: treating
# `# HERMES_API_TOKEN=your-gateway-secret` from .env.example as "already
# configured" is exactly how a placeholder reaches the gateway.
read_env_key() {
  local file="$1"
  local key="$2"
  [[ -f "$file" ]] || return 0
  EK_KEY="$key" awk '
    BEGIN { key = ENVIRON["EK_KEY"]; out = ""; sq = sprintf("%c", 39) }
    {
      line = $0
      sub(/^[ \t]+/, "", line)
      sub(/^export[ \t]+/, "", line)
      if (index(line, key "=") != 1) next
      v = substr(line, length(key) + 2)
      sub(/[ \t\r]+$/, "", v)
      first = substr(v, 1, 1)
      last = substr(v, length(v), 1)
      if (length(v) >= 2 && first == last && (first == "\"" || first == sq)) {
        v = substr(v, 2, length(v) - 2)
      }
      out = v
    }
    END { print out }
  ' "$file"
}

# is_usable_api_key VALUE — mirror of the gateway's own startup guard.
# gateway/platforms/api_server.py calls has_usable_secret(key, min_length=16)
# (hermes_cli/auth.py) and *refuses to bind* if it fails. A value that fails
# here is worse than no value at all: API_SERVER_ENABLED still switches the
# platform on, and it then declines to listen. So we treat an unusable value as
# absent and replace it rather than "preserving" it.
is_usable_api_key() {
  local v="${1:-}"
  v="${v#"${v%%[![:space:]]*}"}"
  v="${v%"${v##*[![:space:]]}"}"
  [[ ${#v} -ge 16 ]] || return 1
  case "$(printf '%s' "$v" | tr '[:upper:]' '[:lower:]')" in
    # the gateway's _PLACEHOLDER_SECRET_VALUES …
    '*'|'**'|'***'|changeme|your_api_key|your_api_key_here|your-api-key) return 1 ;;
    placeholder|example|dummy|null|none) return 1 ;;
    # … plus the placeholders our own docs and .env.example hand out, which are
    # long enough to slip past the gateway's check.
    your-gateway-secret|your-secret-here|your-secret|changeme-please) return 1 ;;
  esac
  return 0
}

# generate_api_key — 64 hex chars of CSPRNG output, or non-zero if this machine
# offers no acceptable source. We never fall back to $RANDOM: this key gates an
# endpoint that dispatches terminal-capable agent work, so a guessable value is
# remote code execution. Better to fail loudly and let the user set one.
generate_api_key() {
  local key=""

  if command -v openssl &>/dev/null; then
    key="$(openssl rand -hex 32 2>/dev/null | tr -d ' \t\r\n')"
  fi

  # od is POSIX and present on coreutils, busybox and macOS; xxd is not.
  # -v is load-bearing: without it od collapses runs of identical input lines
  # to "*", which silently yields a short, malformed key.
  if [[ -z "$key" && -r /dev/urandom ]] && command -v od &>/dev/null; then
    key="$(od -An -vtx1 -N32 < /dev/urandom 2>/dev/null | tr -d ' \t\r\n')"
  fi

  if [[ -z "$key" && -r /dev/urandom ]] && command -v xxd &>/dev/null; then
    key="$(xxd -p -l 32 < /dev/urandom 2>/dev/null | tr -d ' \t\r\n')"
  fi

  if [[ -z "$key" ]] && command -v python3 &>/dev/null; then
    key="$(python3 -c 'import secrets; print(secrets.token_hex(32))' 2>/dev/null | tr -d ' \t\r\n')"
  fi

  is_usable_api_key "$key" || return 1
  printf '%s\n' "$key"
}

# resolve_shared_api_key AGENT_ENV UI_ENV
#
# Decide the single secret both sides must agree on, without ever invalidating
# a working setup. Sets:
#   SHARED_API_KEY        the value to use ("" if none could be produced)
#   SHARED_API_KEY_SOURCE human-readable provenance, for the install log
#
# Precedence: agent .env  →  UI .env  →  exported API_SERVER_KEY  →  exported
# HERMES_API_TOKEN  →  freshly generated. The agent side wins a mismatch
# because that is the value the gateway will actually enforce; syncing the UI
# to it keeps an already-running gateway working.
SHARED_API_KEY=""
SHARED_API_KEY_SOURCE=""
SHARED_API_KEY_NOTES=()
resolve_shared_api_key() {
  local agent_env="$1"
  local ui_env="$2"
  local agent_key ui_key

  SHARED_API_KEY=""
  SHARED_API_KEY_SOURCE=""
  SHARED_API_KEY_NOTES=()

  agent_key="$(read_env_key "$agent_env" API_SERVER_KEY)"
  ui_key="$(read_env_key "$ui_env" HERMES_API_TOKEN)"

  if [[ -n "$agent_key" ]] && ! is_usable_api_key "$agent_key"; then
    SHARED_API_KEY_NOTES+=("API_SERVER_KEY in $agent_env is too short or a placeholder; the gateway would refuse to start with it — replacing.")
    agent_key=""
  fi
  if [[ -n "$ui_key" ]] && ! is_usable_api_key "$ui_key"; then
    SHARED_API_KEY_NOTES+=("HERMES_API_TOKEN in $ui_env is too short or a placeholder — replacing.")
    ui_key=""
  fi

  if [[ -n "$agent_key" && -n "$ui_key" && "$agent_key" != "$ui_key" ]]; then
    SHARED_API_KEY_NOTES+=("API_SERVER_KEY and HERMES_API_TOKEN disagree; keeping the agent's key (the gateway enforces that one) and re-pointing the UI at it.")
  fi

  if [[ -n "$agent_key" ]]; then
    SHARED_API_KEY="$agent_key"
    SHARED_API_KEY_SOURCE="existing API_SERVER_KEY in $agent_env"
  elif [[ -n "$ui_key" ]]; then
    SHARED_API_KEY="$ui_key"
    SHARED_API_KEY_SOURCE="existing HERMES_API_TOKEN in $ui_env"
  elif is_usable_api_key "${API_SERVER_KEY:-}"; then
    SHARED_API_KEY="$API_SERVER_KEY"
    SHARED_API_KEY_SOURCE="exported API_SERVER_KEY"
  elif is_usable_api_key "${HERMES_API_TOKEN:-}"; then
    SHARED_API_KEY="$HERMES_API_TOKEN"
    SHARED_API_KEY_SOURCE="exported HERMES_API_TOKEN"
  elif SHARED_API_KEY="$(generate_api_key)"; then
    SHARED_API_KEY_SOURCE="newly generated"
  else
    SHARED_API_KEY=""
    SHARED_API_KEY_SOURCE="unavailable"
    return 1
  fi

  return 0
}

# Everything above is pure function/constant definitions. Tests source this
# file with SWITCHUI_INSTALL_LIB_ONLY=1 to exercise them without installing
# anything.
if [[ -n "${SWITCHUI_INSTALL_LIB_ONLY:-}" ]]; then
  # shellcheck disable=SC2317  # `return` only succeeds when sourced; the
  # `exit` is the executed-directly path.
  return 0 2>/dev/null || exit 0
fi

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
  warn_if_provenance_unverified
else
  if command -v hermes &>/dev/null; then
    yellow "  Existing 'hermes' is not a compatible Interstellar-code build — installing the required fork."
    print_hermes_check_diagnostics
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
  # Deliberately non-fatal. The agent installer just reported success and it
  # takes ~10 minutes; throwing that away — and the UI clone with it — because
  # our sanity check disagrees is the worse outcome. Warn loudly, show exactly
  # which sub-check failed, and carry on.
  if ! is_interstellar_hermes; then
    yellow ""
    yellow "⚠  The hermes-agent installer reported success, but this script could"
    yellow "   not confirm a compatible Interstellar-code build afterwards."
    yellow "   Expected: $HERMES_AGENT_REPO v$HERMES_AGENT_MIN_VERSION or newer."
    print_hermes_check_diagnostics
    yellow ""
    yellow "   Continuing with the Switch UI install. If the UI cannot reach the"
    yellow "   gateway later, start from the failed checks above."
    yellow ""
  else
    green "  Interstellar hermes-agent installed ✓ ($(hermes --version 2>/dev/null | head -1))"
    warn_if_provenance_unverified
  fi
fi

# ─── clone workspace ──────────────────────────────────────────────────────

cyan "→ Cloning hermes-switchui…"
if [[ -n "$SWITCHUI_REF" ]]; then
  cyan "  Pinned to SWITCHUI_REF=$SWITCHUI_REF"
fi
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
  elif [[ -n "$SWITCHUI_REF" ]]; then
    yellow "  $INSTALL_DIR exists; checking out $SWITCHUI_REF"
    if ! git -C "$INSTALL_DIR" fetch --tags --quiet origin 2>/dev/null \
      || ! git -C "$INSTALL_DIR" checkout --quiet "$SWITCHUI_REF"; then
      CHECKOUT_UPDATE_STATUS="could not check out $SWITCHUI_REF"
      yellow "  Could not check out '$SWITCHUI_REF' in $INSTALL_DIR — leaving it as-is."
    else
      # A tag or SHA leaves a detached HEAD; for a branch, fast-forward it.
      git -C "$INSTALL_DIR" pull --ff-only --quiet 2>/dev/null || true
      CHECKOUT_UPDATE_STATUS="pinned to $SWITCHUI_REF"
    fi
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
  if [[ -n "$SWITCHUI_REF" ]]; then
    # Separate checkout rather than `clone --branch`, so SWITCHUI_REF may also
    # be a plain commit SHA.
    if ! git -C "$INSTALL_DIR" checkout --quiet "$SWITCHUI_REF"; then
      red "  Cloned, but '$SWITCHUI_REF' is not a valid tag, branch or commit."
      red "  Check SWITCHUI_REF and re-run."
      exit 1
    fi
    CHECKOUT_UPDATE_STATUS="fresh clone pinned to $SWITCHUI_REF"
  fi
fi
cd "$INSTALL_DIR"
checkout_is_current() {
  case "$CHECKOUT_UPDATE_STATUS" in
    "fresh clone"|updated|"pinned to "*|"fresh clone pinned to "*) return 0 ;;
    *) return 1 ;;
  esac
}
if checkout_is_current; then
  green "  Workspace ready at $INSTALL_DIR ✓ ($CHECKOUT_UPDATE_STATUS)"
else
  yellow "  Workspace ready at $INSTALL_DIR (using existing checkout: $CHECKOUT_UPDATE_STATUS)"
fi

# ─── env + install ────────────────────────────────────────────────────────

cyan "→ Configuring .env…"
if [[ ! -f .env ]]; then
  cp .env.example .env
fi

# Resolve the agent's env file first: it may already pin API_SERVER_PORT, and
# the UI's HERMES_API_URL has to point at whatever port the gateway will
# actually bind.
HERMES_ENV_PATH="$(hermes config env-path 2>/dev/null || true)"
if [[ -z "$HERMES_ENV_PATH" ]]; then
  HERMES_ENV_PATH="$HOME/.hermes/.env"
fi
EFFECTIVE_PORT="$(read_env_key "$HERMES_ENV_PATH" API_SERVER_PORT)"
if [[ ! "$EFFECTIVE_PORT" =~ ^[0-9]+$ ]]; then
  EFFECTIVE_PORT="$GATEWAY_PORT"
elif [[ "$EFFECTIVE_PORT" != "$GATEWAY_PORT" ]]; then
  yellow "  $HERMES_ENV_PATH pins API_SERVER_PORT=$EFFECTIVE_PORT — using that instead of $GATEWAY_PORT."
fi

ensure_env_key "$INSTALL_DIR/.env" "HERMES_API_URL" "http://127.0.0.1:${EFFECTIVE_PORT}"
green "  .env ready ✓"

cyan "→ Enabling Hermes API server…"
ensure_env_key "$HERMES_ENV_PATH" "API_SERVER_ENABLED" "true"

# API_SERVER_ENABLED alone is a trap. gateway/config.py enables the api_server
# platform when *either* API_SERVER_ENABLED or API_SERVER_KEY is set, and
# gateway/platforms/api_server.py then refuses to bind without a key — loopback
# included — and refuses again if the key is under 16 chars or a known
# placeholder. Enabling without a key therefore produces "nothing listens on
# :$EFFECTIVE_PORT" and a UI health check that times out.
#
# So the two sides get one shared secret: API_SERVER_KEY for the agent,
# HERMES_API_TOKEN for the UI. Existing values are reused, never clobbered.
#
# Caveat worth knowing: api_server.py reads
#   extra.get("key", os.getenv("API_SERVER_KEY", ""))
# so a `platforms.api_server.extra.key` written into ~/.hermes/config.yaml is
# consulted before the environment. gateway/config.py copies a non-empty
# API_SERVER_KEY into that same extra slot, so env normally wins — but a
# config.yaml key that is present-and-empty, or written after env resolution,
# silently defeats everything below. If the gateway rejects the token, check
# config.yaml before suspecting these files.
if resolve_shared_api_key "$HERMES_ENV_PATH" "$INSTALL_DIR/.env"; then
  for _note in ${SHARED_API_KEY_NOTES[@]+"${SHARED_API_KEY_NOTES[@]}"}; do
    yellow "  $_note"
  done
  ensure_env_key "$HERMES_ENV_PATH" "API_SERVER_KEY" "$SHARED_API_KEY"
  ensure_env_key "$INSTALL_DIR/.env" "HERMES_API_TOKEN" "$SHARED_API_KEY"
  green "  Gateway API key in sync ✓ ($SHARED_API_KEY_SOURCE)"
  green "    agent: API_SERVER_KEY   → $HERMES_ENV_PATH"
  green "    UI:    HERMES_API_TOKEN → $INSTALL_DIR/.env"
else
  red ""
  red "⚠  Could not generate an API_SERVER_KEY: no usable random source"
  red "   (tried openssl, /dev/urandom via od and xxd, and python3)."
  yellow "   The gateway will REFUSE TO START with API_SERVER_ENABLED=true and no"
  yellow "   key. Set one by hand — the same value in both files:"
  yellow "     $HERMES_ENV_PATH        API_SERVER_KEY=<64 hex chars>"
  yellow "     $INSTALL_DIR/.env   HERMES_API_TOKEN=<same value>"
  red ""
fi
green "  Hermes env updated: $HERMES_ENV_PATH ✓"

# API_SERVER_ENABLED and API_SERVER_KEY are read at gateway startup. If a
# gateway is already running, they won't apply until it restarts — warn but
# never auto-kill.
GW_ALREADY_RUNNING=0
if command -v hermes &>/dev/null; then
  GW_STATUS="$(hermes gateway status 2>/dev/null || true)"
  if echo "$GW_STATUS" | grep -qiE "running|active|online"; then
    GW_ALREADY_RUNNING=1
    yellow ""
    yellow "⚠  A Hermes gateway is already running."
    yellow "   API_SERVER_ENABLED / API_SERVER_KEY take effect only after a restart:"
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
if ! checkout_is_current; then
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
    • gateway   (:${EFFECTIVE_PORT}) — chat
    • dashboard (:9119) — sessions, skills, memory, kanban, jobs
  Without the dashboard those features WILL NOT WORK. Start it
  (headless — keep it running in its own terminal or as a service):

       hermes dashboard --no-open --skip-build

EOF
yellow "  Note: if the Hermes Agent gateway was already running before"
yellow "  this install, restart it (or just use 'pnpm start:all') so"
yellow "  API_SERVER_ENABLED=true and API_SERVER_KEY take effect."
echo ""

# ─── backend reachability check ───────────────────────────────────────────
# Probe both backends so the user knows BEFORE opening the UI whether the
# dashboard (the rich-features backend) is up. 'pnpm start:all' now starts
# the dashboard together with the gateway and UI.
#
# The gateway probe doubles as the assertion for the API_SERVER_KEY work above:
# /health is unauthenticated, /health/detailed requires the Bearer token, so
# hitting both tells us whether the platform bound AND whether the two sides
# agree on the secret.
cyan "→ Checking backends…"
gw_up=0; dash_up=0; gw_auth="unknown"
if command -v curl &>/dev/null; then
  for _attempt in 1 2 3; do
    if curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:${EFFECTIVE_PORT}/health" 2>/dev/null; then
      gw_up=1
      break
    fi
    [[ "$_attempt" == "3" ]] || sleep 1
  done
  if [[ "$gw_up" == "1" && -n "${SHARED_API_KEY:-}" ]]; then
    _code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 \
      -H "Authorization: Bearer ${SHARED_API_KEY}" \
      "http://127.0.0.1:${EFFECTIVE_PORT}/health/detailed" 2>/dev/null || echo 000)"
    case "$_code" in
      200) gw_auth="ok" ;;
      401|403) gw_auth="rejected" ;;
      *) gw_auth="inconclusive ($_code)" ;;
    esac
  fi
  curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:9119" 2>/dev/null && dash_up=1 || true
fi

if [[ "$gw_up" == "1" ]]; then
  green "  gateway   :${EFFECTIVE_PORT} reachable ✓"
  case "$gw_auth" in
    ok)
      green "  gateway token accepted ✓ (API_SERVER_KEY ↔ HERMES_API_TOKEN match)"
      ;;
    rejected)
      red   "  gateway REJECTED the token ⚠"
      yellow "    The running gateway is using a different API_SERVER_KEY than the one"
      yellow "    now in $HERMES_ENV_PATH — it was started before this install wrote it."
      yellow "    Restart it to pick up the new key:  hermes gateway restart"
      yellow "    If it still rejects after a restart, check for"
      yellow "    'platforms.api_server.extra.key' in ~/.hermes/config.yaml — that"
      yellow "    value is read ahead of the environment variable."
      ;;
    inconclusive*)
      yellow "  gateway token check $gw_auth — could not confirm the key end to end."
      ;;
  esac
elif [[ "$GW_ALREADY_RUNNING" == "1" ]]; then
  # This is issue #350's exact signature: a gateway process is alive but the
  # API server platform never bound, which is what happens when
  # API_SERVER_ENABLED is set without a usable API_SERVER_KEY.
  red   "  gateway   :${EFFECTIVE_PORT} NOT answering, but a gateway process IS running ⚠"
  yellow "    The API server platform is enabled but did not bind. Almost always"
  yellow "    the key: the gateway refuses to start (loopback included) without a"
  yellow "    usable API_SERVER_KEY, and refuses again if it is under 16 chars."
  yellow "    This install wrote one — restart to apply it:"
  yellow "      hermes gateway restart"
  yellow "    Then re-check:  curl -fsS http://127.0.0.1:${EFFECTIVE_PORT}/health"
else
  yellow "  gateway   :${EFFECTIVE_PORT} not running (start with 'pnpm start:all')"
  yellow "    Config written but not yet verified — nothing is listening to probe."
  yellow "    After 'pnpm start:all', confirm with:"
  yellow "      curl -fsS http://127.0.0.1:${EFFECTIVE_PORT}/health"
  yellow "    If that hangs or refuses, the gateway declined to bind; check its"
  yellow "    log for 'API_SERVER_KEY is required'."
fi

if [[ "$dash_up" == "1" ]]; then
  green "  dashboard :9119 reachable ✓"
else
  red   "  dashboard :9119 NOT running ⚠"
  yellow "    Sessions, skills, memory, kanban and jobs will NOT work until"
  yellow "    you start it:  hermes dashboard --no-open --skip-build"
fi
echo ""
cyan "Happy building. 🚀"
