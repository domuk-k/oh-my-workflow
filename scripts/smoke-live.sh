#!/usr/bin/env bash
# Smoke harness — run a tiny workflow against each adapter and assert a green,
# schema-valid result. The free `fake` path always runs; live adapters
# (claude/codex/hermes) run only with OMW_LIVE=1 (they spend tokens) and only when
# the CLI is on PATH.
#
#   ./scripts/smoke-live.sh                 # fake only (free)
#   OMW_LIVE=1 ./scripts/smoke-live.sh      # + claude/codex/hermes (real tokens)
#   OMW_CMD="bunx oh-my-workflow@0.4.0 run" OMW_LIVE=1 ./scripts/smoke-live.sh  # test the published build
#
# Run from the repo root. Exit 0 = all attempted adapters green; 1 = any failure.
set -uo pipefail

OMW_CMD="${OMW_CMD:-bun src/cli/omw.ts run}"
WF="${OMW_SMOKE_WF:-scripts/smoke.ts}"
fail=0

run_one() {
  local agent="$1" out rc
  out=$($OMW_CMD "$WF" --agent "$agent" 2>/dev/null); rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "  ✗ $agent — exit $rc"
    fail=1
  elif printf '%s' "$out" | grep -q '"ok":true'; then
    echo "  ✓ $agent — $out"
  else
    echo "  ✗ $agent — unexpected result: $out"
    fail=1
  fi
}

echo "== free (no key) =="
run_one fake

if [ "${OMW_LIVE:-0}" = "1" ]; then
  echo "== live adapters (OMW_LIVE=1, real tokens) =="
  for a in claude codex hermes; do
    if command -v "$a" >/dev/null 2>&1; then
      run_one "$a"
    else
      echo "  − $a — not on PATH, skipped"
    fi
  done
else
  echo "(set OMW_LIVE=1 to also smoke claude/codex/hermes — they spend real tokens)"
fi

if [ "$fail" -eq 0 ]; then echo "ALL GREEN"; else echo "FAILURES"; exit 1; fi
