#!/usr/bin/env bash
# scripts/parity-suite.sh
# Runs the same workflows through both the native TS backend and the Python
# plugin backend, then diffs definitions + run rows + node rows.
#
# Usage:
#   bash scripts/parity-suite.sh          # full run (requires live hermes-agent)
#   bash scripts/parity-suite.sh --help   # show this help and exit 0
#
# Exit codes:
#   0  PARITY: PASS (or --help)
#   1  PARITY: FAIL  (diff output written to stdout)
#   2  Setup error (missing deps, agent not reachable)
set -euo pipefail

# ─── Help ─────────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
parity-suite.sh — Workflow backend parity checker

DESCRIPTION
  Triggers a subset of canonical workflows through both the native TypeScript
  workflow engine (backend=native) and the Python plugin backend
  (backend=plugin), then compares:
    • definitions list  (slug, name, description — modulo updated_at)
    • run rows          (status, workflow_id, node_count — modulo id, timestamps)
    • node rows         (node_id, status, exit_code — modulo timestamps, run_id)

WORKFLOWS TESTED
  hello-world
  githubawesome-monitor
  tool-catalog-write

USAGE
  bash scripts/parity-suite.sh [--help]

OPTIONS
  --help, -h    Print this help message and exit 0.

ENVIRONMENT
  SWITCHUI_BASE   Base URL for the Switch UI API  (default: http://localhost:3000)
  HERMES_SESSION  Auth session token for the API  (default: dev-token)
  PARITY_TIMEOUT  Seconds to wait for a run to complete (default: 120)

EXIT CODES
  0  PARITY: PASS
  1  PARITY: FAIL — diff output shown on stdout
  2  Setup error  — missing dependency or agent not reachable

NOTES
  Volatile fields stripped before diff:
    id, run_id, started_at, completed_at, created_at, updated_at, enqueued_at
  The script requires: curl, jq (>=1.6).
  Full run requires a running hermes-agent on port 8642 and the Switch UI
  server on SWITCHUI_BASE.
EOF
  exit 0
fi

# ─── Config ───────────────────────────────────────────────────────────────────
BASE="${SWITCHUI_BASE:-http://localhost:3000}"
SESSION="${HERMES_SESSION:-dev-token}"
TIMEOUT="${PARITY_TIMEOUT:-120}"
WORKFLOWS=(hello-world githubawesome-monitor tool-catalog-write)
VOLATILE_KEYS='id|run_id|started_at|completed_at|created_at|updated_at|enqueued_at'

TMPDIR_PARITY="$(mktemp -d /tmp/parity-suite.XXXXXX)"
trap 'rm -rf "$TMPDIR_PARITY"' EXIT

# ─── Helpers ──────────────────────────────────────────────────────────────────
require() {
  command -v "$1" >/dev/null 2>&1 || { echo "ERROR: '$1' not found in PATH"; exit 2; }
}
require curl
require jq

log()  { echo "[parity] $*" >&2; }
fail() { echo "PARITY: FAIL — $*"; exit 1; }

api() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-s -X "$method" -H "Content-Type: application/json" \
               -H "Cookie: hermes-session=$SESSION")
  [[ -n "$body" ]] && args+=(-d "$body")
  curl "${args[@]}" "${BASE}${path}"
}

# Strip volatile fields from JSON so diffs are stable.
strip_volatile() {
  jq --arg keys "$VOLATILE_KEYS" '
    def strip: walk(if type == "object"
      then with_entries(select(.key | test($keys) | not))
      else . end);
    strip
  '
}

# ─── Probe ────────────────────────────────────────────────────────────────────
log "Probing $BASE …"
STATUS=$(api GET /api/workflows/health 2>/dev/null | jq -r '.status // "unreachable"' 2>/dev/null || echo "unreachable")
if [[ "$STATUS" == "unreachable" ]]; then
  echo "ERROR: Switch UI not reachable at $BASE — is 'pnpm dev' running?"
  exit 2
fi
log "Agent reachable (status=$STATUS)"

# ─── Fetch definitions list ───────────────────────────────────────────────────
fetch_definitions() {
  local backend="$1"
  api GET "/api/workflows/definitions?backend=$backend" \
    | jq 'if type == "array" then . else .definitions // [] end
          | map({slug,name,description})
          | sort_by(.slug)' \
    | strip_volatile
}

# ─── Trigger a workflow run and wait for completion ───────────────────────────
trigger_run() {
  local backend="$1" workflow="$2"
  local payload
  payload=$(jq -n --arg wf "$workflow" --arg be "$backend" \
    '{workflow_id: $wf, backend: $be, inputs: {USER_MESSAGE: "parity-check"}}')
  api POST /api/workflows/runs "$payload" | jq -r '.run_id // .id // empty'
}

wait_run() {
  local run_id="$1" elapsed=0
  while (( elapsed < TIMEOUT )); do
    local status
    status=$(api GET "/api/workflows/runs/$run_id" | jq -r '.status // "unknown"')
    case "$status" in
      completed|failed|cancelled) echo "$status"; return 0 ;;
      *) sleep 3; (( elapsed += 3 )) ;;
    esac
  done
  echo "timeout"
}

fetch_run_row() {
  local run_id="$1"
  api GET "/api/workflows/runs/$run_id" \
    | jq '{workflow_id,status,node_count,trigger}' \
    | strip_volatile
}

fetch_node_rows() {
  local run_id="$1"
  api GET "/api/workflows/runs/$run_id/nodes" \
    | jq 'if type == "array" then . else .nodes // [] end
          | map({node_id,status,exit_code}) | sort_by(.node_id)' \
    | strip_volatile
}

# ─── Main comparison loop ─────────────────────────────────────────────────────
PASS=true

log "=== Comparing definitions lists ==="
fetch_definitions native > "$TMPDIR_PARITY/defs-native.json"
fetch_definitions plugin > "$TMPDIR_PARITY/defs-plugin.json"
if ! diff -u "$TMPDIR_PARITY/defs-native.json" "$TMPDIR_PARITY/defs-plugin.json" \
     > "$TMPDIR_PARITY/defs.diff"; then
  echo "MISMATCH: definitions list"
  cat "$TMPDIR_PARITY/defs.diff"
  PASS=false
else
  log "definitions: OK"
fi

for WF in "${WORKFLOWS[@]}"; do
  log "=== Workflow: $WF ==="

  # Native run
  RUN_NATIVE=$(trigger_run native "$WF")
  if [[ -z "$RUN_NATIVE" ]]; then
    log "WARN: could not trigger native run for $WF — skipping"
    continue
  fi
  STATUS_NATIVE=$(wait_run "$RUN_NATIVE")
  log "native run=$RUN_NATIVE status=$STATUS_NATIVE"

  # Plugin run
  RUN_PLUGIN=$(trigger_run plugin "$WF")
  if [[ -z "$RUN_PLUGIN" ]]; then
    log "WARN: could not trigger plugin run for $WF — skipping"
    continue
  fi
  STATUS_PLUGIN=$(wait_run "$RUN_PLUGIN")
  log "plugin run=$RUN_PLUGIN status=$STATUS_PLUGIN"

  # Compare run rows
  fetch_run_row "$RUN_NATIVE" > "$TMPDIR_PARITY/${WF}-run-native.json"
  fetch_run_row "$RUN_PLUGIN" > "$TMPDIR_PARITY/${WF}-run-plugin.json"
  if ! diff -u "$TMPDIR_PARITY/${WF}-run-native.json" "$TMPDIR_PARITY/${WF}-run-plugin.json" \
       > "$TMPDIR_PARITY/${WF}-run.diff"; then
    echo "MISMATCH: run row for $WF"
    cat "$TMPDIR_PARITY/${WF}-run.diff"
    PASS=false
  else
    log "$WF run row: OK"
  fi

  # Compare node rows
  fetch_node_rows "$RUN_NATIVE" > "$TMPDIR_PARITY/${WF}-nodes-native.json"
  fetch_node_rows "$RUN_PLUGIN" > "$TMPDIR_PARITY/${WF}-nodes-plugin.json"
  if ! diff -u "$TMPDIR_PARITY/${WF}-nodes-native.json" "$TMPDIR_PARITY/${WF}-nodes-plugin.json" \
       > "$TMPDIR_PARITY/${WF}-nodes.diff"; then
    echo "MISMATCH: node rows for $WF"
    cat "$TMPDIR_PARITY/${WF}-nodes.diff"
    PASS=false
  else
    log "$WF node rows: OK"
  fi
done

# ─── Result ───────────────────────────────────────────────────────────────────
if $PASS; then
  echo "PARITY: PASS"
  exit 0
else
  echo "PARITY: FAIL"
  exit 1
fi
