#!/usr/bin/env bash
# scripts/install-sh-test.sh
#
# Unit tests for the pure functions in install.sh.
#
# Usage:
#   bash scripts/install-sh-test.sh
#
# Exit codes:
#   0  all assertions passed
#   1  one or more assertions failed
#
# install.sh is sourced with SWITCHUI_INSTALL_LIB_ONLY=1, which returns before
# the imperative install body. Nothing here touches ~/.hermes, the network, or
# the real `hermes` binary: `hermes` is shadowed by a stub on PATH and every
# fixture lives under a temp dir that is removed on exit.
#
# What this CANNOT cover (needs a clean machine): the agent installer download
# and run, the real clone/pnpm install, and a live gateway boot to prove the
# generated API_SERVER_KEY actually lets the API server bind.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_SH="$REPO_ROOT/install.sh"

PASS=0
FAIL=0

# ─── harness ──────────────────────────────────────────────────────────────

ok()   { PASS=$((PASS + 1)); printf '  \033[32mok\033[0m   %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf '  \033[31mFAIL\033[0m %s\n' "$1"; }
group(){ printf '\n\033[36m%s\033[0m\n' "$1"; }

assert_eq() { # assert_eq NAME EXPECTED ACTUAL
  if [[ "$2" == "$3" ]]; then
    ok "$1"
  else
    bad "$1"
    printf '        expected: %q\n        actual:   %q\n' "$2" "$3"
  fi
}

assert_true() { # assert_true NAME  (command already run; $? passed in)
  if [[ "$2" == "0" ]]; then ok "$1"; else bad "$1 (expected success, got exit $2)"; fi
}

assert_false() { # assert_false NAME STATUS
  if [[ "$2" != "0" ]]; then ok "$1"; else bad "$1 (expected failure, got exit 0)"; fi
}

assert_contains() { # assert_contains NAME HAYSTACK NEEDLE
  if [[ "$2" == *"$3"* ]]; then
    ok "$1"
  else
    bad "$1"
    printf '        %q\n        does not contain: %q\n' "$2" "$3"
  fi
}

TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT

# ─── hermes stub ──────────────────────────────────────────────────────────
# A fake `hermes` on PATH whose behaviour is driven by env vars, so we can
# replay real and historical --version output without a real agent.

STUBDIR="$TMPROOT/bin"
mkdir -p "$STUBDIR"
cat > "$STUBDIR/hermes" <<'STUB'
#!/usr/bin/env bash
case "${1:-}" in
  --version)
    printf '%s\n' "${STUB_VERSION_OUTPUT:-}"
    exit "${STUB_VERSION_RC:-0}"
    ;;
  config)
    [[ "${2:-}" == "env-path" ]] && { echo "${STUB_ENV_PATH:-/tmp/none/.env}"; exit "${STUB_CONFIG_RC:-0}"; }
    exit 1
    ;;
  dashboard)
    echo "usage: hermes dashboard"
    exit "${STUB_DASHBOARD_RC:-0}"
    ;;
esac
exit 1
STUB
chmod +x "$STUBDIR/hermes"

export PATH="$STUBDIR:$PATH"

# Real output from hermes-agent v0.19.9 on 2026-08-10.
CURRENT_VERSION_OUTPUT='Hermes Agent v0.19.9 (2026.8.1) · upstream 86480a4c
Install directory: __PROJECT__
Install method: git
Python: 3.11.15
OpenAI SDK: 2.24.0
Up to date'

# The format install.sh used to parse, kept as a fallback for older agents.
LEGACY_VERSION_OUTPUT='Hermes Agent v0.19.0 (2026.1.1)
Project: __PROJECT__
Python: 3.11.15'

reset_stub() {
  STUB_VERSION_OUTPUT=""
  STUB_VERSION_RC=0
  STUB_ENV_PATH="$TMPROOT/hermes/.env"
  STUB_CONFIG_RC=0
  STUB_DASHBOARD_RC=0
  export STUB_VERSION_OUTPUT STUB_VERSION_RC STUB_ENV_PATH STUB_CONFIG_RC STUB_DASHBOARD_RC
}

# make_agent_repo DIR ORIGIN — a git checkout with the given origin URL.
make_agent_repo() {
  local dir="$1" origin="$2"
  mkdir -p "$dir"
  git -C "$dir" init --quiet 2>/dev/null
  git -C "$dir" remote add origin "$origin"
}

# Load the functions under test. install.sh runs `set -euo pipefail` at the
# top, which would follow us into the harness and abort on the first
# deliberately-failing assertion — so put the options back afterwards.
# shellcheck source=../install.sh
SWITCHUI_INSTALL_LIB_ONLY=1 . "$INSTALL_SH"
set +e +u +o pipefail

# ══════════════════════════════════════════════════════════════════════════
group "version_ge"
# ══════════════════════════════════════════════════════════════════════════

version_ge "0.19.9" "0.18.0";      assert_true  "0.19.9 >= 0.18.0" $?
version_ge "0.18.0" "0.18.0";      assert_true  "0.18.0 >= 0.18.0 (equal)" $?
version_ge "0.17.9" "0.18.0";      assert_false "0.17.9 <  0.18.0" $?
version_ge "1.0.0"  "0.18.0";      assert_true  "1.0.0  >= 0.18.0" $?
version_ge "0.19"   "0.18.0";      assert_true  "short version padded" $?
version_ge "0.19.9.dev1" "0.19.9"; assert_true  "dev suffix tolerated" $?
version_ge ""       "0.18.0";      assert_false "empty version fails the floor" $?
version_ge "0.100.0" "0.99.0";     assert_true  "numeric, not lexical, compare" $?

# ══════════════════════════════════════════════════════════════════════════
group "is_interstellar_hermes"
# ══════════════════════════════════════════════════════════════════════════

# ── current 'Install directory:' output, correct fork, git checkout ────────
reset_stub
PROJ="$TMPROOT/agent-current"
make_agent_repo "$PROJ" "https://github.com/Interstellar-code/hermes-agent.git"
STUB_VERSION_OUTPUT="${CURRENT_VERSION_OUTPUT//__PROJECT__/$PROJ}"
is_interstellar_hermes; rc=$?
assert_true    "current output: accepted (issue #349 regression)" "$rc"
assert_eq      "current output: project parsed from 'Install directory:'" "$PROJ" "$HERMES_CHECK_PROJECT"
assert_eq      "current output: version parsed" "0.19.9" "$HERMES_CHECK_VERSION"
assert_eq      "current output: install method parsed" "git" "$HERMES_CHECK_INSTALL_METHOD"
assert_eq      "current output: provenance verified" "verified via git origin" "$HERMES_CHECK_PROVENANCE"
assert_eq      "current output: no failures" "0" "${#HERMES_CHECK_FAILURES[@]}"

# ── legacy 'Project:' output still parses ─────────────────────────────────
reset_stub
PROJ="$TMPROOT/agent-legacy"
make_agent_repo "$PROJ" "git@github.com:Interstellar-code/hermes-agent.git"
STUB_VERSION_OUTPUT="${LEGACY_VERSION_OUTPUT//__PROJECT__/$PROJ}"
is_interstellar_hermes; rc=$?
assert_true "legacy output: accepted" "$rc"
assert_eq   "legacy output: project parsed from 'Project:'" "$PROJ" "$HERMES_CHECK_PROJECT"
assert_eq   "legacy output: version parsed" "0.19.0" "$HERMES_CHECK_VERSION"
assert_eq   "legacy output: ssh origin still matches" "verified via git origin" "$HERMES_CHECK_PROVENANCE"

# ── no binary on PATH ─────────────────────────────────────────────────────
# Run in-process (not a subshell) so the diagnostic globals survive.
reset_stub
OLDPATH="$PATH"
# shellcheck disable=SC2123  # emptying PATH is the point of this case
PATH="/nonexistent"
is_interstellar_hermes; rc=$?
PATH="$OLDPATH"
assert_false "missing binary: rejected" "$rc"
assert_contains "missing binary: names the reason" \
  "${HERMES_CHECK_FAILURES[*]}" "no 'hermes' binary on PATH"

# ── non-git install (pipx): accepted on capability evidence ───────────────
reset_stub
PROJ="$TMPROOT/agent-pipx"
mkdir -p "$PROJ"   # deliberately NOT a git repo
STUB_VERSION_OUTPUT="${CURRENT_VERSION_OUTPUT//__PROJECT__/$PROJ}"
STUB_VERSION_OUTPUT="${STUB_VERSION_OUTPUT/Install method: git/Install method: pipx}"
is_interstellar_hermes; rc=$?
assert_true     "non-git install: accepted (no .git required)" "$rc"
assert_contains "non-git install: provenance flagged unverified" \
  "$HERMES_CHECK_PROVENANCE" "unverified"
assert_eq       "non-git install: no failures recorded" "0" "${#HERMES_CHECK_FAILURES[@]}"
assert_eq       "non-git install: install method surfaced" "pipx" "$HERMES_CHECK_INSTALL_METHOD"

# ── wrong-origin checkout: hard fail, even though capabilities pass ───────
reset_stub
PROJ="$TMPROOT/agent-wrongfork"
make_agent_repo "$PROJ" "https://github.com/someone-else/hermes-agent.git"
STUB_VERSION_OUTPUT="${CURRENT_VERSION_OUTPUT//__PROJECT__/$PROJ}"
is_interstellar_hermes; rc=$?
assert_false    "wrong origin: rejected" "$rc"
assert_eq       "wrong origin: provenance marked WRONG FORK" "WRONG FORK" "$HERMES_CHECK_PROVENANCE"
assert_contains "wrong origin: diagnostic names the origin" \
  "${HERMES_CHECK_FAILURES[*]}" "someone-else/hermes-agent"

# ── version below the floor ───────────────────────────────────────────────
reset_stub
PROJ="$TMPROOT/agent-old"
make_agent_repo "$PROJ" "https://github.com/Interstellar-code/hermes-agent.git"
STUB_VERSION_OUTPUT="Hermes Agent v0.9.0 (2025.1.1)
Install directory: $PROJ
Install method: git"
is_interstellar_hermes; rc=$?
assert_false    "old version: rejected" "$rc"
assert_contains "old version: diagnostic names the floor" \
  "${HERMES_CHECK_FAILURES[*]}" "older than the required"

# ── unparseable version output ────────────────────────────────────────────
reset_stub
STUB_VERSION_OUTPUT="command not found: hermes"
STUB_VERSION_RC=1
is_interstellar_hermes; rc=$?
assert_false    "garbage --version: rejected" "$rc"
assert_contains "garbage --version: diagnostic says so" \
  "${HERMES_CHECK_FAILURES[*]}" "could not parse a version"
assert_eq       "garbage --version: falls back to conventional path" \
  "$HOME/.hermes/hermes-agent" "$HERMES_CHECK_PROJECT"
assert_contains "garbage --version: raw output captured for diagnostics" \
  "$HERMES_CHECK_RAW" "command not found"

# ── a capability sub-check fails ──────────────────────────────────────────
reset_stub
PROJ="$TMPROOT/agent-nodash"
make_agent_repo "$PROJ" "https://github.com/Interstellar-code/hermes-agent.git"
STUB_VERSION_OUTPUT="${CURRENT_VERSION_OUTPUT//__PROJECT__/$PROJ}"
STUB_DASHBOARD_RC=1
is_interstellar_hermes; rc=$?
assert_false    "no dashboard subcommand: rejected" "$rc"
assert_contains "no dashboard subcommand: named specifically" \
  "${HERMES_CHECK_FAILURES[*]}" "hermes dashboard --help"

reset_stub
PROJ="$TMPROOT/agent-noenvpath"
make_agent_repo "$PROJ" "https://github.com/Interstellar-code/hermes-agent.git"
STUB_VERSION_OUTPUT="${CURRENT_VERSION_OUTPUT//__PROJECT__/$PROJ}"
STUB_CONFIG_RC=1
is_interstellar_hermes; rc=$?
assert_false    "no config env-path: rejected" "$rc"
assert_contains "no config env-path: named specifically" \
  "${HERMES_CHECK_FAILURES[*]}" "hermes config env-path"

# ── diagnostics printer does not explode on any state ─────────────────────
out="$(print_hermes_check_diagnostics 2>&1)"; rc=$?
assert_true     "print_hermes_check_diagnostics runs" "$rc"
assert_contains "diagnostics include the raw --version output" "$out" "Hermes Agent v0.19.9"
assert_contains "diagnostics include the computed project path" "$out" "$PROJ"

# ══════════════════════════════════════════════════════════════════════════
group "ensure_env_key / read_env_key"
# ══════════════════════════════════════════════════════════════════════════

envfile() { printf '%s' "$1" > "$2"; }

# ── insert into a missing file ────────────────────────────────────────────
F="$TMPROOT/env-new/.env"
ensure_env_key "$F" "API_SERVER_KEY" "abc123"
assert_eq "insert: file created with the key" "API_SERVER_KEY=abc123" "$(cat "$F")"
assert_eq "insert: read_env_key round-trips" "abc123" "$(read_env_key "$F" API_SERVER_KEY)"

# ── insert into an existing file without the key ──────────────────────────
F="$TMPROOT/env-append"
envfile 'FOO=1
BAR=2
' "$F"
ensure_env_key "$F" "API_SERVER_KEY" "xyz"
assert_contains "append: existing keys preserved" "$(cat "$F")" "FOO=1"
assert_eq "append: new key readable" "xyz" "$(read_env_key "$F" API_SERVER_KEY)"

# ── replace a plain existing value ────────────────────────────────────────
F="$TMPROOT/env-replace"
envfile 'FOO=1
API_SERVER_KEY=old
BAR=2
' "$F"
ensure_env_key "$F" "API_SERVER_KEY" "new"
assert_eq "replace: value updated" "new" "$(read_env_key "$F" API_SERVER_KEY)"
assert_eq "replace: exactly one definition" "1" "$(grep -c '^API_SERVER_KEY=' "$F")"
assert_contains "replace: order preserved (BAR still after)" "$(cat "$F")" "API_SERVER_KEY=new
BAR=2"

# ── commented-out form: uncommented in place, not duplicated ──────────────
# This is how .env.example ships HERMES_API_TOKEN.
F="$TMPROOT/env-commented"
envfile '# Leave unset for local loopback gateways.
# HERMES_API_TOKEN=your-gateway-secret
OTHER=1
' "$F"
assert_eq "commented: read_env_key ignores the comment" "" "$(read_env_key "$F" HERMES_API_TOKEN)"
ensure_env_key "$F" "HERMES_API_TOKEN" "realkey"
assert_eq "commented: value now active" "realkey" "$(read_env_key "$F" HERMES_API_TOKEN)"
assert_eq "commented: exactly one active definition" "1" "$(grep -c '^HERMES_API_TOKEN=' "$F")"
assert_eq "commented: stale placeholder line gone" "0" "$(grep -c 'your-gateway-secret' "$F")"

# ── '#KEY=' with no space ─────────────────────────────────────────────────
F="$TMPROOT/env-commented-tight"
envfile '#HERMES_API_TOKEN=placeholder
' "$F"
ensure_env_key "$F" "HERMES_API_TOKEN" "realkey"
assert_eq "commented (no space): uncommented in place" "1" "$(grep -c '^HERMES_API_TOKEN=realkey$' "$F")"
assert_eq "commented (no space): not duplicated" "1" "$(grep -c 'HERMES_API_TOKEN' "$F")"

# ── 'export KEY=' form: replaced, prefix preserved ────────────────────────
F="$TMPROOT/env-export"
envfile 'export API_SERVER_KEY=old
FOO=1
' "$F"
assert_eq "export: read_env_key strips the prefix" "old" "$(read_env_key "$F" API_SERVER_KEY)"
ensure_env_key "$F" "API_SERVER_KEY" "new"
assert_eq "export: value updated" "new" "$(read_env_key "$F" API_SERVER_KEY)"
assert_eq "export: prefix preserved" "1" "$(grep -c '^export API_SERVER_KEY=new$' "$F")"
assert_eq "export: not duplicated" "1" "$(grep -c 'API_SERVER_KEY' "$F")"

# ── duplicate active definitions collapse to one ──────────────────────────
F="$TMPROOT/env-dupes"
envfile 'API_SERVER_KEY=first
FOO=1
API_SERVER_KEY=second
' "$F"
assert_eq "dupes: read_env_key takes the last (dotenv semantics)" "second" "$(read_env_key "$F" API_SERVER_KEY)"
ensure_env_key "$F" "API_SERVER_KEY" "final"
assert_eq "dupes: collapsed to one definition" "1" "$(grep -c 'API_SERVER_KEY' "$F")"
assert_eq "dupes: winning value is ours" "final" "$(read_env_key "$F" API_SERVER_KEY)"

# ── prefix collisions must not match ──────────────────────────────────────
F="$TMPROOT/env-prefix"
envfile 'API_SERVER_KEY_OLD=nope
XAPI_SERVER_KEY=nope2
' "$F"
assert_eq "prefix: API_SERVER_KEY_OLD is not API_SERVER_KEY" "" "$(read_env_key "$F" API_SERVER_KEY)"
ensure_env_key "$F" "API_SERVER_KEY" "mine"
assert_eq "prefix: neighbour keys untouched" "nope" "$(read_env_key "$F" API_SERVER_KEY_OLD)"
assert_eq "prefix: our key appended" "mine" "$(read_env_key "$F" API_SERVER_KEY)"

# ── quoted values ─────────────────────────────────────────────────────────
F="$TMPROOT/env-quoted"
envfile 'API_SERVER_KEY="quoted-value-123456"
' "$F"
assert_eq "quoted: surrounding double quotes stripped" "quoted-value-123456" "$(read_env_key "$F" API_SERVER_KEY)"
envfile "API_SERVER_KEY='single-quoted-12345'
" "$F"
assert_eq "quoted: surrounding single quotes stripped" "single-quoted-12345" "$(read_env_key "$F" API_SERVER_KEY)"

# ── trailing whitespace / CR (files edited on Windows) ────────────────────
F="$TMPROOT/env-crlf"
printf 'API_SERVER_KEY=value-with-cr\r\n' > "$F"
assert_eq "CRLF: carriage return trimmed" "value-with-cr" "$(read_env_key "$F" API_SERVER_KEY)"

# ── a value containing shell/awk metacharacters survives byte-for-byte ────
# The backslash and & matter: awk -v expands escapes and sub() treats & as the
# whole match, so a naive implementation mangles these.
F="$TMPROOT/env-meta"
# shellcheck disable=SC2016  # the literal metacharacters are the test
META='a&b\c$d"e'
ensure_env_key "$F" "API_SERVER_KEY" "$META"
assert_eq "metachars: written and read back unchanged" "$META" "$(read_env_key "$F" API_SERVER_KEY)"

# ── missing file reads as empty, not an error ─────────────────────────────
assert_eq "read_env_key on a missing file returns empty" "" "$(read_env_key "$TMPROOT/does-not-exist" API_SERVER_KEY)"

# ══════════════════════════════════════════════════════════════════════════
group "is_usable_api_key / generate_api_key"
# ══════════════════════════════════════════════════════════════════════════

is_usable_api_key "$(printf '%064d' 0)"; assert_true  "64 chars accepted" $?
is_usable_api_key "0123456789abcdef";    assert_true  "exactly 16 chars accepted (gateway floor)" $?
is_usable_api_key "0123456789abcde";     assert_false "15 chars rejected" $?
is_usable_api_key "";                    assert_false "empty rejected" $?
is_usable_api_key "changeme";            assert_false "gateway placeholder 'changeme' rejected" $?
is_usable_api_key "your_api_key_here";   assert_false "gateway placeholder (>=16 chars) rejected" $?
is_usable_api_key "YOUR_API_KEY_HERE";   assert_false "placeholder match is case-insensitive" $?
is_usable_api_key "your-gateway-secret"; assert_false ".env.example placeholder rejected" $?
is_usable_api_key "   short   ";         assert_false "whitespace-padded short value rejected" $?

KEY="$(generate_api_key)"; rc=$?
assert_true "generate_api_key succeeds" "$rc"
assert_eq   "generated key is 64 chars" "64" "${#KEY}"
if [[ "$KEY" =~ ^[0-9a-f]{64}$ ]]; then ok "generated key is lowercase hex"; else bad "generated key is lowercase hex (got: $KEY)"; fi
is_usable_api_key "$KEY"; assert_true "generated key clears the gateway weak-key check" $?

KEY2="$(generate_api_key)"
if [[ "$KEY" != "$KEY2" ]]; then ok "successive keys differ"; else bad "successive keys differ"; fi

# ── each fallback branch in isolation ─────────────────────────────────────
# Shadow the higher-priority tools one at a time so the next branch runs.
FAKEBIN="$TMPROOT/fakebin"
mkdir -p "$FAKEBIN"
for tool in openssl od xxd python3; do
  printf '#!/usr/bin/env bash\nexit 127\n' > "$FAKEBIN/$tool"
  chmod +x "$FAKEBIN/$tool"
done

try_fallback() { # try_fallback LABEL BROKEN_TOOLS...
  local label="$1"; shift
  local dir="$TMPROOT/shadow-$label"
  mkdir -p "$dir"
  local t
  for t in "$@"; do cp "$FAKEBIN/openssl" "$dir/$t"; done
  local key
  key="$(PATH="$dir:$PATH" generate_api_key)" || { bad "$label: generate_api_key failed"; return; }
  if [[ ${#key} -ge 16 ]] && is_usable_api_key "$key"; then
    ok "$label: produced a usable ${#key}-char key"
  else
    bad "$label: produced an unusable key (${#key} chars: $key)"
  fi
}

# NB: the shadow only fools `command -v` if the stub exits non-zero *and* the
# branch checks output emptiness, which it does — a 127-exit stub yields "".
try_fallback "od-fallback"     openssl
try_fallback "xxd-fallback"    openssl od
try_fallback "python-fallback" openssl od xxd

# ── the od -v trap ────────────────────────────────────────────────────────
# Without -v, od collapses runs of identical input lines to "*", producing a
# short malformed key. Prove the flag is doing real work.
no_v="$(head -c 32 /dev/zero | od -An -tx1 | tr -d ' \t\r\n')"
with_v="$(head -c 32 /dev/zero | od -An -vtx1 | tr -d ' \t\r\n')"
if [[ "$no_v" != "$with_v" ]]; then
  ok "od without -v really does collapse (len $((${#no_v})) vs $((${#with_v})))"
else
  ok "od on this platform does not collapse; -v is harmless"
fi
assert_eq "od -v yields a full 64-char hex string" "64" "${#with_v}"

# ══════════════════════════════════════════════════════════════════════════
group "resolve_shared_api_key"
# ══════════════════════════════════════════════════════════════════════════

STRONG_A="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1"
STRONG_B="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2"

new_pair() { # new_pair LABEL -> sets AGENT_ENV / UI_ENV
  local d="$TMPROOT/pair-$1"
  mkdir -p "$d"
  AGENT_ENV="$d/hermes.env"
  UI_ENV="$d/ui.env"
  : > "$AGENT_ENV"
  : > "$UI_ENV"
}

# ── both absent: generate and write both sides ────────────────────────────
new_pair both-absent
( unset API_SERVER_KEY HERMES_API_TOKEN; resolve_shared_api_key "$AGENT_ENV" "$UI_ENV" ) >/dev/null
unset API_SERVER_KEY HERMES_API_TOKEN
resolve_shared_api_key "$AGENT_ENV" "$UI_ENV"; rc=$?
assert_true "both absent: resolves" "$rc"
assert_eq   "both absent: source is 'newly generated'" "newly generated" "$SHARED_API_KEY_SOURCE"
assert_eq   "both absent: key is 64 hex chars" "64" "${#SHARED_API_KEY}"
ensure_env_key "$AGENT_ENV" "API_SERVER_KEY" "$SHARED_API_KEY"
ensure_env_key "$UI_ENV" "HERMES_API_TOKEN" "$SHARED_API_KEY"
assert_eq "both absent: both sides now match" \
  "$(read_env_key "$AGENT_ENV" API_SERVER_KEY)" "$(read_env_key "$UI_ENV" HERMES_API_TOKEN)"

# ── agent present only: reuse it, sync the UI ─────────────────────────────
new_pair agent-only
printf 'API_SERVER_KEY=%s\n' "$STRONG_A" > "$AGENT_ENV"
resolve_shared_api_key "$AGENT_ENV" "$UI_ENV"
assert_eq "agent-only: reuses the agent key (no clobber)" "$STRONG_A" "$SHARED_API_KEY"
assert_contains "agent-only: source names the agent file" "$SHARED_API_KEY_SOURCE" "existing API_SERVER_KEY"
ensure_env_key "$UI_ENV" "HERMES_API_TOKEN" "$SHARED_API_KEY"
assert_eq "agent-only: UI synced to it" "$STRONG_A" "$(read_env_key "$UI_ENV" HERMES_API_TOKEN)"

# ── UI present only: adopt it, sync the agent ─────────────────────────────
new_pair ui-only
printf 'HERMES_API_TOKEN=%s\n' "$STRONG_B" > "$UI_ENV"
resolve_shared_api_key "$AGENT_ENV" "$UI_ENV"
assert_eq "ui-only: adopts the UI token (no clobber)" "$STRONG_B" "$SHARED_API_KEY"
assert_contains "ui-only: source names the UI file" "$SHARED_API_KEY_SOURCE" "existing HERMES_API_TOKEN"
ensure_env_key "$AGENT_ENV" "API_SERVER_KEY" "$SHARED_API_KEY"
assert_eq "ui-only: agent synced to it" "$STRONG_B" "$(read_env_key "$AGENT_ENV" API_SERVER_KEY)"

# ── both present and equal: no change, no noise ───────────────────────────
new_pair both-equal
printf 'API_SERVER_KEY=%s\n' "$STRONG_A" > "$AGENT_ENV"
printf 'HERMES_API_TOKEN=%s\n' "$STRONG_A" > "$UI_ENV"
resolve_shared_api_key "$AGENT_ENV" "$UI_ENV"
assert_eq "both equal: key unchanged" "$STRONG_A" "$SHARED_API_KEY"
assert_eq "both equal: no warnings emitted" "0" "${#SHARED_API_KEY_NOTES[@]}"

# ── both present but mismatched: agent wins, and we say so ────────────────
new_pair mismatch
printf 'API_SERVER_KEY=%s\n' "$STRONG_A" > "$AGENT_ENV"
printf 'HERMES_API_TOKEN=%s\n' "$STRONG_B" > "$UI_ENV"
resolve_shared_api_key "$AGENT_ENV" "$UI_ENV"
assert_eq       "mismatch: agent key wins" "$STRONG_A" "$SHARED_API_KEY"
assert_contains "mismatch: warned about the disagreement" \
  "${SHARED_API_KEY_NOTES[*]}" "disagree"
ensure_env_key "$UI_ENV" "HERMES_API_TOKEN" "$SHARED_API_KEY"
assert_eq "mismatch: UI re-pointed at the agent key" "$STRONG_A" "$(read_env_key "$UI_ENV" HERMES_API_TOKEN)"

# ── an existing but WEAK key is replaced, not preserved ───────────────────
new_pair weak-agent
printf 'API_SERVER_KEY=short\n' > "$AGENT_ENV"
unset API_SERVER_KEY HERMES_API_TOKEN
resolve_shared_api_key "$AGENT_ENV" "$UI_ENV"
if [[ "$SHARED_API_KEY" != "short" ]]; then ok "weak agent key: replaced"; else bad "weak agent key: replaced"; fi
assert_contains "weak agent key: explained why" "${SHARED_API_KEY_NOTES[*]}" "refuse to start"
is_usable_api_key "$SHARED_API_KEY"; assert_true "weak agent key: replacement is usable" $?

# ── the .env.example commented placeholder is NOT treated as configured ───
new_pair example-placeholder
printf '# HERMES_API_TOKEN=your-gateway-secret\n' > "$UI_ENV"
unset API_SERVER_KEY HERMES_API_TOKEN
resolve_shared_api_key "$AGENT_ENV" "$UI_ENV"
assert_eq "commented placeholder: ignored, key generated" "newly generated" "$SHARED_API_KEY_SOURCE"
ensure_env_key "$UI_ENV" "HERMES_API_TOKEN" "$SHARED_API_KEY"
assert_eq "commented placeholder: exactly one active token line" "1" "$(grep -c '^HERMES_API_TOKEN=' "$UI_ENV")"

# ── an uncommented .env.example placeholder is also rejected ──────────────
new_pair example-uncommented
printf 'HERMES_API_TOKEN=your-gateway-secret\n' > "$UI_ENV"
unset API_SERVER_KEY HERMES_API_TOKEN
resolve_shared_api_key "$AGENT_ENV" "$UI_ENV"
assert_eq "uncommented placeholder: replaced" "newly generated" "$SHARED_API_KEY_SOURCE"

# ── exported env vars are picked up when both files are empty ─────────────
new_pair exported
export API_SERVER_KEY="$STRONG_B"
unset HERMES_API_TOKEN
resolve_shared_api_key "$AGENT_ENV" "$UI_ENV"
assert_eq "exported API_SERVER_KEY: adopted" "$STRONG_B" "$SHARED_API_KEY"
assert_eq "exported API_SERVER_KEY: source labelled" "exported API_SERVER_KEY" "$SHARED_API_KEY_SOURCE"
unset API_SERVER_KEY

# ── file beats environment ────────────────────────────────────────────────
new_pair file-beats-env
printf 'API_SERVER_KEY=%s\n' "$STRONG_A" > "$AGENT_ENV"
export API_SERVER_KEY="$STRONG_B"
resolve_shared_api_key "$AGENT_ENV" "$UI_ENV"
assert_eq "file beats a stale exported var" "$STRONG_A" "$SHARED_API_KEY"
unset API_SERVER_KEY

# ── idempotency: a second pass changes nothing ────────────────────────────
new_pair idempotent
unset API_SERVER_KEY HERMES_API_TOKEN
resolve_shared_api_key "$AGENT_ENV" "$UI_ENV"
FIRST="$SHARED_API_KEY"
ensure_env_key "$AGENT_ENV" "API_SERVER_KEY" "$SHARED_API_KEY"
ensure_env_key "$UI_ENV" "HERMES_API_TOKEN" "$SHARED_API_KEY"
A1="$(cat "$AGENT_ENV")"; U1="$(cat "$UI_ENV")"
resolve_shared_api_key "$AGENT_ENV" "$UI_ENV"
ensure_env_key "$AGENT_ENV" "API_SERVER_KEY" "$SHARED_API_KEY"
ensure_env_key "$UI_ENV" "HERMES_API_TOKEN" "$SHARED_API_KEY"
assert_eq "idempotent: key stable across re-runs" "$FIRST" "$SHARED_API_KEY"
assert_eq "idempotent: agent file byte-identical" "$A1" "$(cat "$AGENT_ENV")"
assert_eq "idempotent: UI file byte-identical" "$U1" "$(cat "$UI_ENV")"

# ══════════════════════════════════════════════════════════════════════════
group "repo_url_matches"
# ══════════════════════════════════════════════════════════════════════════

R="$TMPROOT/checkout-ok"
make_agent_repo "$R" "https://github.com/Interstellar-code/hermes-switchui.git"
# shellcheck disable=SC2034  # REPO_URL is read by repo_url_matches
REPO_URL="https://github.com/Interstellar-code/hermes-switchui.git"
repo_url_matches "$R"; assert_true "matching origin accepted" $?
REPO_URL="https://github.com/Interstellar-code/hermes-switchui"
repo_url_matches "$R"; assert_true "trailing .git difference tolerated" $?
# shellcheck disable=SC2034  # REPO_URL is read by repo_url_matches
REPO_URL="https://github.com/other/thing.git"
repo_url_matches "$R"; assert_false "different origin rejected" $?

# ─── summary ──────────────────────────────────────────────────────────────

printf '\n────────────────────────────────────\n'
if [[ "$FAIL" -eq 0 ]]; then
  printf '\033[32m  %d passed, 0 failed\033[0m\n' "$PASS"
  exit 0
else
  printf '\033[31m  %d passed, %d FAILED\033[0m\n' "$PASS" "$FAIL"
  exit 1
fi
