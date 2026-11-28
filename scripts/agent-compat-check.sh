#!/usr/bin/env bash
# agent-compat-check.sh — does a hermes-agent merge candidate still work with Switch UI?
#
# Usage:
#   scripts/agent-compat-check.sh [--agent-repo DIR] [--base REF] [--candidate REF] [--live] [--out DIR]
#
# Defaults: agent repo = $HERMES_AGENT_PATH or ~/.hermes/hermes-agent,
#           base = origin/main (the fork before the merge), candidate = HEAD of the agent repo.
#
# Read-only toward the agent repo: it never checks out, fetches, stashes or commits there.
# Base and candidate are exported with `git archive` into the output folder and tested from those copies.
#
# Exit: 0 PASS, 1 FAIL, 2 UNVERIFIED (something required could not be checked), 3 usage/setup error.
set -uo pipefail

UI_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_REPO="${HERMES_AGENT_PATH:-$HOME/.hermes/hermes-agent}"
BASE="origin/main"
CANDIDATE="HEAD"
LIVE=0
OUT=""
LIVE_PORT="${COMPAT_LIVE_PORT:-18642}"

need() { [ $# -ge 2 ] && [ -n "$2" ] || { echo "$1 needs a value" >&2; exit 3; }; }
while [ $# -gt 0 ]; do
  case "$1" in
    --agent-repo) need "$@"; AGENT_REPO="$2"; shift 2 ;;
    --base) need "$@"; BASE="$2"; shift 2 ;;
    --candidate) need "$@"; CANDIDATE="$2"; shift 2 ;;
    --out) need "$@"; OUT="$2"; shift 2 ;;
    --live) LIVE=1; shift ;;
    -h|--help) sed -n 2,13p "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 3 ;;
  esac
done

command -v node >/dev/null || { echo "node is required" >&2; exit 3; }
git -C "$AGENT_REPO" rev-parse --git-dir >/dev/null 2>&1 || { echo "not a git repo: $AGENT_REPO" >&2; exit 3; }
BASE_SHA="$(git -C "$AGENT_REPO" rev-parse --verify --quiet "$BASE^{commit}")" || { echo "cannot resolve base $BASE" >&2; exit 3; }
CAND_SHA="$(git -C "$AGENT_REPO" rev-parse --verify --quiet "$CANDIDATE^{commit}")" || { echo "cannot resolve candidate $CANDIDATE" >&2; exit 3; }
UI_SHA="$(git -C "$UI_ROOT" rev-parse HEAD)"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${OUT:-${TMPDIR:-/tmp}/agent-compat/$STAMP-${CAND_SHA:0:10}}"
mkdir -p "$OUT" && OUT="$(cd "$OUT" && pwd)" || { echo "cannot create $OUT" >&2; exit 3; }
REPORT="$OUT/report.md"
FAILS=0; UNVERIFIED=0
ROWS=()
NOTES=()
row() { ROWS+=("| $1 | $2 | $3 | $4 |"); case "$2" in FAIL) FAILS=$((FAILS+1));; UNVERIFIED) UNVERIFIED=$((UNVERIFIED+1));; esac; }
log() { echo "[compat] $*" >&2; }
isint() { case "$1" in ''|*[!0-9]*) return 1;; *) return 0;; esac; }

AGENT_DIRTY="clean"
[ -n "$(git -C "$AGENT_REPO" status --porcelain --untracked-files=no 2>/dev/null)" ] && AGENT_DIRTY="DIRTY: uncommitted changes are NOT tested, only the candidate commit"
UI_DIRTY="clean"
[ -n "$(git -C "$UI_ROOT" status --porcelain --untracked-files=no -- src 2>/dev/null)" ] && UI_DIRTY="DIRTY under src/: tests ran on the working tree"

# Base sanity: the control comparison only means "new in this merge" when base is an ancestor of candidate.
if ! git -C "$AGENT_REPO" merge-base --is-ancestor "$BASE_SHA" "$CAND_SHA" 2>/dev/null; then
  NOTES+=("Base is not an ancestor of the candidate: diffs include unrelated history and the control does not isolate this merge.")
fi
BASE_AGE="$(git -C "$AGENT_REPO" log -1 --format=%cr "$BASE_SHA")"
NOTES+=("Base $BASE was last committed $BASE_AGE and is read as stored locally (no fetch). Fetch first if it may be stale.")

# ---------------------------------------------------------------- 1. route surface diff
log "1/4 route surface diff ${BASE_SHA:0:10}..${CAND_SHA:0:10}"
routes_at() { # every /api, /v1, /health string literal in the agent's Python (f-string {x} -> *)
  git -C "$AGENT_REPO" grep -h -o -E "[\"'](/(api|v1)/[^\"' ]*|/health[A-Za-z/]*)[\"']" "$1" -- '*.py' ':!tests/**' ':!evals/**' 2>/dev/null \
    | tr -d "\"'" | sed -E 's#\{[^}]*\}?#*#g; s#<[^>]*>#*#g; s#/:[A-Za-z_]+#/*#g; s#\?.*$##; s#/+$##' | sort -u
}
routes_at "$BASE_SHA" > "$OUT/routes-base.txt"
routes_at "$CAND_SHA" > "$OUT/routes-candidate.txt"
comm -23 "$OUT/routes-base.txt" "$OUT/routes-candidate.txt" > "$OUT/routes-removed.txt"
comm -13 "$OUT/routes-base.txt" "$OUT/routes-candidate.txt" > "$OUT/routes-added.txt"

# Routes Switch UI's server code calls, and which removed agent routes they match ('*' matches one segment).
node - "$UI_ROOT/src/server" "$OUT" <<'NODE'
const fs = require('fs'), path = require('path');
const [dir, out] = process.argv.slice(2);
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  const p = path.join(d, e.name);
  if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '__tests__') walk(p); }
  else if (/\.(ts|tsx|js|mjs)$/.test(e.name) && !/\.test\./.test(e.name)) files.push(p);
} })(dir);
const routes = new Set();
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  const re = /\/(api|v1)\/|\/health\b/g; let m;
  while ((m = re.exec(s))) {
    const prev = s[m.index - 1];
    if (prev && /[A-Za-z0-9_.-]/.test(prev)) continue;          // part of a longer path or URL host
    let i = m.index, r = '';
    while (i < s.length) {
      const c = s[i];
      if (c === '$' && s[i + 1] === '{') {                      // template placeholder, balanced braces
        let depth = 0, j = i + 1;
        for (; j < s.length; j++) { if (s[j] === '{') depth++; else if (s[j] === '}' && --depth === 0) break; }
        r += '*'; i = j + 1; continue;
      }
      if (/[\s'"`?#,)]/.test(c)) break;
      r += c; i++;
    }
    r = r.replace(/\*+/g, '*').replace(/\/+$/, '');
    if (r.length > 4) routes.add(r);
  }
}
const ui = [...routes].sort();
fs.writeFileSync(path.join(out, 'ui-routes.txt'), ui.join('\n') + '\n');
const segMatch = (a, b) => {                                     // '*' matches one segment or a partial one
  const A = a.split('/'), B = b.split('/');
  if (A.length !== B.length) return false;
  const glob = (g, s) => new RegExp('^' + g.split('*').map(p => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$').test(s);
  return A.every((x, k) => x === B[k] || glob(x, B[k]) || glob(B[k], x));
};
const removed = fs.readFileSync(path.join(out, 'routes-removed.txt'), 'utf8').split('\n').filter(Boolean);
const cand = fs.readFileSync(path.join(out, 'routes-candidate.txt'), 'utf8').split('\n').filter(Boolean);
const hits = [];
for (const r of removed) {
  if (cand.some(c => segMatch(c, r))) continue;                 // still served in another spelling
  const users = ui.filter(u => segMatch(u, r));
  if (users.length) hits.push(r + '  <- ' + users.join(', '));
}
fs.writeFileSync(path.join(out, 'routes-removed-used.txt'), hits.join('\n') + (hits.length ? '\n' : ''));
NODE
if [ $? -ne 0 ] || [ ! -s "$OUT/ui-routes.txt" ]; then
  row "routes" UNVERIFIED "static diff" "could not extract the UI's route list"
else
  N_REM=$(wc -l < "$OUT/routes-removed.txt" | tr -d ' ')
  N_ADD=$(wc -l < "$OUT/routes-added.txt" | tr -d ' ')
  N_UI=$(wc -l < "$OUT/ui-routes.txt" | tr -d ' ')
  N_BROKEN=$(grep -c . "$OUT/routes-removed-used.txt")
  if [ "$N_BROKEN" -gt 0 ]; then row "routes" FAIL "static diff" "$N_BROKEN removed routes still called by UI (see below)"
  else row "routes" PASS "static diff" "$N_REM removed, $N_ADD added; none of $N_UI UI routes hit"; fi
fi

# ---------------------------------------------------------------- 2. surface files changed
log "2/4 changed integration files"
SURFACE='^(gateway/platforms/api_server|gateway/session_api|gateway/run_api|gateway/cwd_placeholder|gateway/config|hermes_cli/web_server|hermes_cli/dashboard|hermes_cli/gateway_client|plugins/(hermes-switch-ui|kanban|projects|delegation|dashboard_auth|personas|workflow-engine)/|hermes_state|persistence/|session_keys|tui_gateway/)'
git -C "$AGENT_REPO" -c diff.renameLimit=50000 diff --find-renames --name-status "$BASE_SHA" "$CAND_SHA" > "$OUT/changed-all.txt"
awk -F'\t' -v re="$SURFACE" '{ if ($NF ~ re || $2 ~ re) print }' "$OUT/changed-all.txt" > "$OUT/changed-surface.txt"
N_ALL=$(wc -l < "$OUT/changed-all.txt" | tr -d ' ')
N_SURF=$(wc -l < "$OUT/changed-surface.txt" | tr -d ' ')
N_DEL=$(awk -F'\t' '$1 ~ /^(D|R)/' "$OUT/changed-surface.txt" | wc -l | tr -d ' ')
row "surface files" INFO "static diff" "$N_SURF of $N_ALL changed files are UI-facing, $N_DEL deleted/renamed: review"

# ---------------------------------------------------------------- 3. tests against the candidate
log "3/4 export snapshots and run tests"
export_to() { mkdir -p "$2" && git -C "$AGENT_REPO" archive "$1" | tar -x -C "$2"; }
SNAP="$OUT/agent-snapshot"
export_to "$CAND_SHA" "$SNAP" 2>"$OUT/archive.err" || { row "snapshot" UNVERIFIED "setup" "git archive of candidate failed"; SNAP=""; }

VT_P=0; VT_F=0; VT_S=0
vt_counts() { # json -> "passed failed skipped" or nothing; a suite that failed to load counts as failed
  node -e '
    const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    let p = 0, f = 0, s = 0;
    for (const t of r.testResults || []) {
      const a = t.assertionResults || [];
      if (t.status === "failed" && !a.some(x => x.status === "failed")) f++;
      for (const x of a) { if (x.status === "passed") p++; else if (x.status === "failed") f++; else s++; }
    }
    if (!(r.testResults || []).length) process.exit(1);
    console.log(p + " " + f + " " + s);' "$1" 2>/dev/null
}
run_vitest() { # name kind agentpath files...
  local name="$1" kind="$2" agentpath="$3"; shift 3
  local json="$OUT/vitest-$name.json"
  rm -f "$json"
  ( cd "$UI_ROOT" && CLAUDE_AGENT_PATH="$agentpath" HERMES_AGENT_PATH="$agentpath" \
      pnpm exec vitest run --reporter=json --outputFile="$json" "$@" >"$OUT/vitest-$name.log" 2>&1 )
  local code=$? counts
  counts="$( [ -s "$json" ] && vt_counts "$json" )"
  set -- $counts
  if ! isint "${1:-}" || ! isint "${2:-}" || ! isint "${3:-}"; then
    row "$name" UNVERIFIED "$kind" "no readable vitest result (exit $code): vitest-$name.log"; return 1
  fi
  VT_P=$1; VT_F=$2; VT_S=$3
  if [ "$2" -gt 0 ]; then row "$name" FAIL "$kind" "$1 passed, $2 failed, $3 skipped"
  elif [ "$3" -gt 0 ]; then row "$name" UNVERIFIED "$kind" "$1 passed, $3 SKIPPED (a skip is not a pass)"
  elif [ "$1" -eq 0 ]; then row "$name" UNVERIFIED "$kind" "no tests ran"
  elif [ "$code" -ne 0 ]; then row "$name" UNVERIFIED "$kind" "counts clean but vitest exited $code"
  else row "$name" PASS "$kind" "$1 passed"; fi
}

if [ -n "$SNAP" ]; then
  # Reads the candidate's Python source and compares constants with the UI's copies.
  run_vitest "agent-cwd-contract" "agent source contract" "$SNAP" src/server/agent-cwd.contract.test.ts
  CAND_F=$VT_F
  # Control: same test on the base. Pass on base + fail on candidate = regression introduced by this merge.
  CTRL="$OUT/agent-base-snapshot"
  if export_to "$BASE_SHA" "$CTRL" 2>/dev/null; then
    rows_before=${#ROWS[@]}; f_before=$FAILS; u_before=$UNVERIFIED
    run_vitest "control" "agent source contract" "$CTRL" src/server/agent-cwd.contract.test.ts
    # The control informs; it does not change the verdict.
    ROWS=("${ROWS[@]:0:$rows_before}"); FAILS=$f_before; UNVERIFIED=$u_before
    if [ "$VT_F" -eq 0 ] && [ "${CAND_F:-0}" -gt 0 ]; then row "contract control (base)" INFO "agent source contract" "base passes: the candidate failures are new in this merge"
    elif [ "$VT_F" -gt 0 ]; then row "contract control (base)" INFO "agent source contract" "base also fails ($VT_F): some failures predate this merge"
    else row "contract control (base)" INFO "agent source contract" "base passes"; fi
  fi
fi
# Switch UI's own consumers of the agent API. Mocked: proves the UI side is self-consistent, not the agent.
run_vitest "ui-consumers" "mocked unit" "${SNAP:-/nonexistent}" \
  src/server/__tests__/gateway-capabilities.test.ts src/server/__tests__/optional-apis.test.ts \
  src/server/hermes-api.test.ts src/server/hermes-api.get-messages.test.ts \
  src/server/hermes-api.list-sessions.test.ts src/server/hermes-api.session-create.test.ts \
  src/server/hermes-rpc.test.ts

# ---------------------------------------------------------------- 4. live probe (opt-in)
GW=""
cleanup() {
  if [ -n "$GW" ]; then
    pkill -TERM -P "$GW" 2>/dev/null; kill -TERM "$GW" 2>/dev/null; sleep 1
    pkill -KILL -P "$GW" 2>/dev/null; kill -KILL "$GW" 2>/dev/null; wait "$GW" 2>/dev/null; GW=""
  fi
}
trap cleanup EXIT
trap 'cleanup; exit 3' INT TERM

if [ "$LIVE" -eq 1 ] && [ -n "$SNAP" ]; then
  log "4/4 live probe on 127.0.0.1:$LIVE_PORT"
  PY="$AGENT_REPO/venv/bin/python"; [ -x "$PY" ] || PY="$AGENT_REPO/.venv/bin/python"
  if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$LIVE_PORT/health"; then
    row "live" UNVERIFIED "real service" "port $LIVE_PORT already in use; not probing a process we did not start"
  elif [ ! -x "$PY" ]; then
    row "live" UNVERIFIED "real service" "no python venv in $AGENT_REPO"
  else
    LHOME="$OUT/live-home"; mkdir -p "$LHOME"
    KEY="compat-synthetic-$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
    # Scrubbed env: throwaway HOME/HERMES_HOME, synthetic key, no provider credentials inherited.
    # The venv's packages come from the agent repo; the agent's own code comes from the candidate export.
    ( cd "$SNAP" && exec env -i PATH="/usr/bin:/bin" HOME="$LHOME" HERMES_HOME="$LHOME/.hermes" \
        API_SERVER_ENABLED=true API_SERVER_KEY="$KEY" API_SERVER_HOST=127.0.0.1 API_SERVER_PORT="$LIVE_PORT" \
        PYTHONPATH="$SNAP" "$PY" -m gateway.run ) >"$OUT/live-gateway.log" 2>&1 &
    GW=$!
    up=0
    for _ in $(seq 1 60); do
      kill -0 "$GW" 2>/dev/null || break
      curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$LIVE_PORT/health" && { up=1; break; }
      sleep 1
    done
    if [ "$up" -eq 0 ]; then
      row "live: start" UNVERIFIED "real service" "candidate gateway did not come up in 60s: live-gateway.log"
    else
      probe() { # name method path auth expected-code [body] -- 2xx expectation accepts any 2xx
        local code; code=$(curl -s -o "$OUT/live-$1.body" -w '%{http_code}' --max-time 10 -X "$2" \
          ${4:+-H "Authorization: Bearer $4"} -H 'Content-Type: application/json' \
          ${6:+--data "$6"} "http://127.0.0.1:$LIVE_PORT$3")
        if [ "$code" = "$5" ] || { [ "${5:0:1}" = "2" ] && [ "${code:0:1}" = "2" ]; }; then return 0; fi
        row "live: $1" FAIL "real service" "$2 $3 -> $code (expected $5)"; return 1
      }
      js() { node -e "try{const b=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));process.exit(($1)?0:1)}catch{process.exit(1)}" "$OUT/live-$2.body"; }
      shape() { # name check-js detail
        if js "$2" "$1"; then row "live: $1" PASS "real service" "$3"; else row "live: $1" FAIL "real service" "$3: unexpected body shape (live-$1.body)"; fi
      }
      probe health GET /health "" 200 && row "live: health" PASS "real service" "GET /health 200"
      probe auth-reject GET /v1/models "wrong-key" 401 && row "live: auth-reject" PASS "real service" "bad key -> 401"
      probe models GET /v1/models "$KEY" 200 && shape models "Array.isArray(b.data)" "GET /v1/models, data[]"
      probe sessions-list GET /api/sessions "$KEY" 200 && shape sessions-list "Array.isArray(b.data)||Array.isArray(b.items)||Array.isArray(b.sessions)" "GET /api/sessions, list"
      if probe session-create POST /api/sessions "$KEY" 200 '{"title":"compat-check"}'; then
        shape session-create "b.session&&typeof b.session.id==='string'" "POST /api/sessions, session.id"
        SID=$(node -e 'try{const b=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(b.session.id)}catch{}' "$OUT/live-session-create.body")
        if [ -n "$SID" ]; then
          probe session-messages GET "/api/sessions/$SID/messages" "$KEY" 200 && \
            shape session-messages "Array.isArray(b.data)||Array.isArray(b.items)||Array.isArray(b.messages)" "GET session messages, list"
        else row "live: session-messages" UNVERIFIED "real service" "no session id to read back"; fi
      fi
    fi
    cleanup
  fi
else
  row "live" UNVERIFIED "real service" "not run (pass --live)"
fi

# Paths the script does not exercise yet. Listed so a PASS can never hide them.
row "chat streaming" UNVERIFIED "not covered" "/api/sessions/*/chat/stream to a model"
row "dashboard + WS RPC" UNVERIFIED "not covered" "port 9119 routes and RPC socket"
row "switch-ui plugin" UNVERIFIED "not covered" "register, heartbeat, settings readback"

# ---------------------------------------------------------------- report
if [ "$FAILS" -gt 0 ]; then VERDICT="FAIL"; CODE=1
elif [ "$UNVERIFIED" -gt 0 ]; then VERDICT="UNVERIFIED"; CODE=2
else VERDICT="PASS"; CODE=0; fi

{
  echo "# Agent compatibility check: $VERDICT"
  echo
  echo "- Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "- Agent repo: $AGENT_REPO ($AGENT_DIRTY)"
  echo "- Base: $BASE = $BASE_SHA"
  echo "- Candidate: $CANDIDATE = $CAND_SHA"
  echo "- Switch UI: $UI_SHA ($UI_DIRTY)"
  for n in "${NOTES[@]}"; do echo "- Note: $n"; done
  echo
  echo "| Check | Result | Evidence | Detail |"
  echo "| --- | --- | --- | --- |"
  printf '%s\n' "${ROWS[@]}"
  echo
  echo "Verdict: any FAIL -> FAIL; else any UNVERIFIED -> UNVERIFIED; else PASS. INFO rows do not count."
  echo "Mocked unit tests never prove the agent side. Raw files: $OUT"
  if [ -s "$OUT/routes-removed-used.txt" ]; then
    echo; echo "## Removed routes the UI still calls"; echo; echo '```'; cat "$OUT/routes-removed-used.txt"; echo '```'
  fi
  if [ -s "$OUT/vitest-agent-cwd-contract.json" ]; then
    FAILED_TESTS="$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const t of r.testResults)for(const a of t.assertionResults)if(a.status==="failed")console.log("- "+a.title)' "$OUT/vitest-agent-cwd-contract.json" 2>/dev/null)"
    if [ -n "$FAILED_TESTS" ]; then echo; echo "## Failed contract tests"; echo; echo "$FAILED_TESTS"; fi
  fi
  echo; echo "## UI-facing agent files changed"; echo
  if [ -s "$OUT/changed-surface.txt" ]; then echo '```'; cat "$OUT/changed-surface.txt"; echo '```'; else echo "None."; fi
  echo; echo "## Agent routes removed (-) and added (+)"; echo
  echo '```'; sed 's/^/- /' "$OUT/routes-removed.txt"; sed 's/^/+ /' "$OUT/routes-added.txt"; echo '```'
} > "$REPORT"

cat "$REPORT"
exit "$CODE"
