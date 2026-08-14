#!/usr/bin/env bash
# The merge gate. Refuses unless the full review tail ran against THIS sha.
#
# Why this exists: the tail was documented in CLAUDE.md and skipped anyway,
# within an hour, under delivery pressure (docs/DECISIONS.md, 2026-08-14).
# Prose preventions fail under velocity; mechanical ones hold. This is the
# mechanical one.
#
# Usage: scripts/dev/merge-ready.sh          # check, exit 1 if not ready
#        scripts/dev/merge-ready.sh --quiet  # same, no output on success
set -euo pipefail

QUIET="${1:-}"
SHA="$(git rev-parse HEAD)"
SHORT="${SHA:0:7}"
DIR="$(git rev-parse --git-dir)/fitduo-review"
RECORD="$DIR/$SHA"
REQUIRED=(grok self-review suite)
FAIL=0

note() { [ "$QUIET" = "--quiet" ] || echo "$@"; }
fail() {
  echo "  ✗ $1" >&2
  FAIL=1
}

note "merge-ready: checking $SHORT"

# 1. Every tail step recorded against this exact sha.
for step in "${REQUIRED[@]}"; do
  if grep -qx "$step" "$RECORD" 2>/dev/null; then
    note "  ✓ $step"
  else
    fail "$step not recorded for $SHORT — run it, then: scripts/dev/record-step.sh $step"
  fi
done

# 2. The framing section of the PR body is filled in (the step most worth
#    forcing: deciding whether we are solving the right problem at all).
if command -v gh >/dev/null 2>&1; then
  BODY="$(gh pr view --json body --jq .body 2>/dev/null || true)"
  if [ -z "$BODY" ]; then
    note "  • no PR found for this branch (skipping framing check)"
  else
    # Strip HTML comments (the template's guidance) before judging emptiness.
    FRAMING="$(printf '%s' "$BODY" |
      sed -n '/## Are we solving the right problem?/,/^## /p' |
      sed 's/<!--/\n&/g; s/-->/&\n/g' | sed '/<!--/,/-->/d' |
      grep -v '^## ' | tr -d '[:space:]')"
    if [ ${#FRAMING} -lt 40 ]; then
      fail "PR body: '## Are we solving the right problem?' is empty or too thin"
    else
      note "  ✓ framing"
    fi
  fi
fi

if [ "$FAIL" -ne 0 ]; then
  echo "" >&2
  echo "NOT MERGE-READY at $SHORT." >&2
  exit 1
fi
note "merge-ready: OK at $SHORT"
