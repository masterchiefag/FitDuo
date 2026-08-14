#!/usr/bin/env bash
# Headless Grok second-opinion review for FitDuo.
# Reviews a commit range's diff, or a file (e.g. the plan).
# Pattern borrowed from ~/dev/sherlock/scripts/dev/grok-review-pr.sh, simplified.
#
# Posting: the finished review is posted to the branch's open PR as a plain
# comment, anchored to the sha it reviewed. Deliberately NOT the sherlock
# machinery (PENDING->COMMENT submission, review-id snapshots, head-sha polling):
# that exists because two agents ran in separate terminals with a human as the
# bus. Here Grok and Claude share a session, so posting buys no latency — only
# a durable trace next to `record-step.sh grok`, which otherwise records that a
# review happened and keeps nothing of what it said.
#
# NOTE: the remote is public, so posted review text is public. Grok runs with
# --always-approve and can read gitignored files, so posting is checked against
# profiles.local.json / .env and fails CLOSED on a match. That check is not
# GROK_REVIEW_POST: an opt-out flag does not get set under the same velocity
# that skipped the review tail (docs/DECISIONS.md), and this repo has already
# shipped personal data once by reading "gitignored" as "unpublished".
#
# Usage:
#   scripts/dev/grok-review.sh diff [range]     # default: HEAD~1..HEAD
#   scripts/dev/grok-review.sh file <path>      # e.g. the plan markdown
#
# Env: GROK_BIN (default: grok on PATH), GROK_REVIEW_MAX_TURNS (default 30),
#      GROK_REVIEW_POST (default 1; 0 = never post to the PR)
set -euo pipefail

GROK_BIN="${GROK_BIN:-grok}"
MAX_TURNS="${GROK_REVIEW_MAX_TURNS:-30}"
MODE="${1:-diff}"
command -v "$GROK_BIN" >/dev/null || { echo "grok not on PATH" >&2; exit 2; }

case "$MODE" in
  diff)
    RANGE="${2:-HEAD~1..HEAD}"
    TARGET="the output of \`git diff $RANGE\` and \`git log --oneline $RANGE\` in this repo"
    LABEL="diff $RANGE"
    ;;
  file)
    [ $# -ge 2 ] || { echo "usage: $0 file <path>" >&2; exit 2; }
    TARGET="the file at $2"
    LABEL="file $2"
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

# Post to the branch's open PR. Best-effort — the review is already on disk, so
# a posting failure must not fail the review — but loud, because a trace that
# fails silently is worse than no trace: it reads as "reviewed and recorded".
[ "${GROK_REVIEW_POST:-1}" = "1" ] || exit 0
command -v gh >/dev/null 2>&1 || { echo "grok-review: gh not on PATH — not posted" >&2; exit 0; }
PR="$(gh pr view --json number --jq .number 2>/dev/null || true)"
[ -n "$PR" ] || { echo "grok-review: no open PR for this branch — not posted" >&2; exit 0; }

# Refuse to publish anything that quotes local personal data (tests/leak-check.test.ts
# is this guard's proof-of-bite — a guard that stops matching is a silent leak).
LEAK="$(node scripts/dev/lib/leak-check.mjs "$OUT")"
if [ -n "$LEAK" ]; then
  echo "grok-review: NOT posted — the review quotes local personal data ($(printf '%.20s' "$LEAK")...)." >&2
  echo "grok-review: review is at $OUT. Read it, then post by hand if it is a false positive." >&2
  exit 0
fi

SHA="$(git rev-parse HEAD)"
if {
  printf '## Grok review — `%s`\n\nReviewed at `%s`. Any new commit invalidates this review; see `scripts/dev/merge-ready.sh`.\n\n---\n\n' \
    "$LABEL" "${SHA:0:12}"
  cat "$OUT"
} | gh pr comment "$PR" --body-file - >/dev/null; then
  echo "grok-review: posted to PR #$PR at ${SHA:0:7}" >&2
else
  echo "grok-review: FAILED to post to PR #$PR — review is still at $OUT" >&2
fi
