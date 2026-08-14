#!/usr/bin/env bash
# Headless Grok second-opinion review for FitDuo.
# No PRs in this repo — reviews a commit range's diff, or a file (e.g. the plan).
# Pattern borrowed from ~/dev/sherlock/scripts/dev/grok-review-pr.sh, simplified.
#
# Usage:
#   scripts/dev/grok-review.sh diff [range]     # default: HEAD~1..HEAD
#   scripts/dev/grok-review.sh file <path>      # e.g. the plan markdown
#
# Env: GROK_BIN (default: grok on PATH), GROK_REVIEW_MAX_TURNS (default 30)
set -euo pipefail

GROK_BIN="${GROK_BIN:-grok}"
MAX_TURNS="${GROK_REVIEW_MAX_TURNS:-30}"
MODE="${1:-diff}"
command -v "$GROK_BIN" >/dev/null || { echo "grok not on PATH" >&2; exit 2; }

case "$MODE" in
  diff)
    RANGE="${2:-HEAD~1..HEAD}"
    TARGET="the output of \`git diff $RANGE\` and \`git log --oneline $RANGE\` in this repo"
    ;;
  file)
    [ $# -ge 2 ] || { echo "usage: $0 file <path>" >&2; exit 2; }
    TARGET="the file at $2"
    ;;
  *)
    echo "usage: $0 diff [range] | file <path>" >&2
    exit 2
    ;;
esac

PROMPT="You are giving a second-opinion review on FitDuo, a Duolingo-style guided duo workout PWA for exactly two users (a couple sharing one laptop). Read CLAUDE.md first for context, then review $TARGET.

Report ONLY findings a maintainer would act on, ranked by severity:
- correctness bugs (name the concrete failure scenario)
- design risks (something that will bite within weeks, not hypotheticals)
- scope traps (work that should be cut or deferred for a 2-user v1)
Skip style nits and generic advice. If it looks sound, say so in one line. Do not modify any files."

# Always keep the FULL review on disk — piping this script through `tail`
# silently truncated a 15-finding review down to 10 once. Never again.
OUT="${GROK_REVIEW_OUT:-.grok-review-latest.md}"
"$GROK_BIN" -p "$PROMPT" --always-approve --max-turns "$MAX_TURNS" --disable-web-search | tee "$OUT"
echo "--- full review saved to $OUT ---" >&2
