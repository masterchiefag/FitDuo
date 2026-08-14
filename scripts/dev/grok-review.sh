#!/usr/bin/env bash
# Headless Grok second-opinion review for FitDuo.
# Reviews a commit range's diff, or a file (e.g. the plan).
# Pattern borrowed from ~/dev/sherlock/scripts/dev/grok-review-pr.sh, simplified.
#
# Posting (`post`) puts the saved review on the branch's open PR as a plain
# comment, anchored to the sha. Deliberately NOT the sherlock machinery
# (PENDING->COMMENT submission, review-id snapshots, head-sha polling): that
# exists because two agents ran in separate terminals with a human as the bus.
# Here Grok and Claude share a session, so posting buys no latency — only a
# durable trace next to `record-step.sh grok`, which otherwise records that a
# review happened and keeps nothing of what it said.
#
# Posting is a separate command and never automatic. The remote is PUBLIC, and
# what lands in $OUT is Grok's whole stdout transcript — narration turns and
# all — not a curated review. Personal data is kept out by the privacy paragraph
# in the prompt below, an instruction rather than a sandbox (a scanner was
# written and deleted; docs/DECISIONS.md says why the half-working version was
# the more dangerous option). An instruction can be missed, so the backstop is
# that a human reads $OUT before running `post`.
#
# Usage:
#   scripts/dev/grok-review.sh diff [range]     # default: HEAD~1..HEAD
#   scripts/dev/grok-review.sh file <path>      # e.g. the plan markdown
#   scripts/dev/grok-review.sh post             # put the saved review on the PR
#
# Env: GROK_BIN (default: grok on PATH), GROK_REVIEW_MAX_TURNS (default 30)
set -euo pipefail

GROK_BIN="${GROK_BIN:-grok}"
MAX_TURNS="${GROK_REVIEW_MAX_TURNS:-30}"
MODE="${1:-diff}"
OUT="${GROK_REVIEW_OUT:-.grok-review-latest.md}"

# Posting is a SEPARATE command, deliberately. As a side effect of `diff` it
# published a review to a public PR in the same breath as generating it, with
# nobody having read it — and what `tee` captures is the whole stdout
# transcript, narration turns included, not a finished review. Now the person
# who posts is by definition someone who has read it.
STAMP="$OUT.sha"

if [ "$MODE" = "post" ]; then
  [ -s "$OUT" ] || { echo "no review at $OUT — run a review first" >&2; exit 2; }
  command -v gh >/dev/null 2>&1 || { echo "gh not on PATH" >&2; exit 2; }

  # The reviewed sha comes from the review run, never from HEAD. Stamping HEAD
  # here would let: review A -> fix -> commit B -> post ("reviewed at B") ->
  # record-step grok at B -> merge-ready passes, with B never reviewed. That is
  # the gate certifying an unreviewed tree, in a comment whose own text says a
  # new commit invalidates the review.
  REVIEWED="$(cat "$STAMP" 2>/dev/null || true)"
  HEAD_SHA="$(git rev-parse HEAD)"
  if [ -z "$REVIEWED" ]; then
    echo "no reviewed-sha stamp at $STAMP — re-run the review" >&2
    exit 2
  fi
  if [ "$REVIEWED" != "$HEAD_SHA" ]; then
    echo "refusing to post: $OUT reviewed ${REVIEWED:0:7}, HEAD is ${HEAD_SHA:0:7}." >&2
    echo "Re-run the review against HEAD — posting the old one would attest a tree nobody reviewed." >&2
    exit 2
  fi

  # GitHub caps a comment at 65536 bytes. $OUT is a raw agent transcript, so a
  # big milestone review will exceed it; failing here beats a 422 mid-tail.
  BYTES="$(wc -c <"$OUT" | tr -d ' ')"
  if [ "$BYTES" -gt 60000 ]; then
    echo "refusing to post: $OUT is ${BYTES}B, over GitHub's comment cap." >&2
    echo "Post the findings by hand, or trim $OUT to the review itself." >&2
    exit 2
  fi

  PR="$(gh pr view --json number --jq .number 2>/dev/null || true)"
  [ -n "$PR" ] || { echo "no open PR for this branch" >&2; exit 2; }
  {
    printf '## Grok review\n\nReviewed at `%s`. Any new commit invalidates this review; see `scripts/dev/merge-ready.sh`.\n\n---\n\n' \
      "${REVIEWED:0:12}"
    cat "$OUT"
  } | gh pr comment "$PR" --body-file -
  echo "posted $OUT to PR #$PR at ${REVIEWED:0:7}" >&2
  exit 0
fi

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
    echo "usage: $0 diff [range] | file <path> | post" >&2
    exit 2
    ;;
esac

PROMPT="You are giving a second-opinion review on FitDuo, a Duolingo-style guided duo workout PWA for exactly two users (a couple sharing one laptop). Read CLAUDE.md first for context, then review $TARGET.

Report ONLY findings a maintainer would act on, ranked by severity:
- correctness bugs (name the concrete failure scenario)
- design risks (something that will bite within weeks, not hypotheticals)
- scope traps (work that should be cut or deferred for a 2-user v1)
Skip style nits and generic advice. If it looks sound, say so in one line. Do not modify any files.

PRIVACY — this review is posted to a PUBLIC pull request. Do not open profiles.local.json or any .env file, and never quote a real person's name, weight, injury, pain area, or any credential. Refer to them by field name instead ('the pain-area list', 'the Supabase key'). Personal data lives outside the repo on purpose; a review does not need its values to make its point."

# Always keep the FULL review on disk — piping this script through `tail`
# silently truncated a 15-finding review down to 10 once. Never again.
# Stamp the sha BEFORE the review runs: it is the tree Grok is about to read.
# Written first so a crashed review leaves no stamp rather than a stale one.
rm -f "$STAMP"
git rev-parse HEAD >"$STAMP"
"$GROK_BIN" -p "$PROMPT" --always-approve --max-turns "$MAX_TURNS" --disable-web-search | tee "$OUT"
echo "--- $LABEL: full review saved to $OUT (reviewed $(cut -c1-7 "$STAMP")) ---" >&2
echo "--- read it, then: $0 post ---" >&2
