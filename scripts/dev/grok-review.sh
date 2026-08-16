#!/usr/bin/env bash
# Headless Grok second-opinion review for FitDuo.
# Reviews a commit range's diff, or a file (e.g. the plan).
# Pattern borrowed from ~/dev/sherlock/scripts/dev/grok-review-pr.sh, simplified.
#
# Grok posts its own review to the branch's open PR at the end of its run, so the
# reviewer speaks for itself and what lands is the review it composed — not this
# script's `tee` of its entire stdout, narration turns included, which is what
# the old manual `post` published. `post` survives as a fallback for a run that
# found no open PR, or whose own comment failed.
#
# Deliberately NOT the sherlock machinery
# (PENDING->COMMENT submission, review-id snapshots, head-sha polling): that
# exists because two agents ran in separate terminals with a human as the bus.
# Here Grok and Claude share a session, so posting buys no latency — only a
# durable trace next to `record-step.sh grok`, which otherwise records that a
# review happened and keeps nothing of what it said.
#
# The remote is PUBLIC. Personal data is kept out by the privacy paragraph in the
# prompt below — an instruction, not a sandbox (a scanner was written and
# deleted; docs/DECISIONS.md says why the half-working version was the more
# dangerous option). Accepted knowingly 2026-08-16: the owner's name is already
# in every commit, the review has never leaked anything here, and the same
# arrangement has run without incident on ~/dev/sherlock.
#
# Usage:
#   scripts/dev/grok-review.sh diff [range]     # default: origin/main..HEAD
#   scripts/dev/grok-review.sh file <path>      # e.g. the plan markdown
#
# There is no `post` command. It published the `tee` — the transcript this
# change exists to keep off a public PR — so the failure path was the leak.
# If no comment appears, write the findings into the PR yourself, citing $OUT.
#
# Env: GROK_BIN (default: grok on PATH), GROK_REVIEW_MAX_TURNS (default 30)
set -euo pipefail

GROK_BIN="${GROK_BIN:-grok}"
# 40, not 30: the self-post is the LAST turn, so a review that spends its budget
# reading src/ exits having posted nothing — and findings that never reach the
# PR survive only as the author's summary (2026-08-16). Headroom is the fix; a
# wrapper checking whether the comment exists is more shell in the directory
# that has produced this repo's worst bugs.
MAX_TURNS="${GROK_REVIEW_MAX_TURNS:-40}"
MODE="${1:-diff}"
OUT="${GROK_REVIEW_OUT:-.grok-review-latest.md}"

# Line 1 of the stamp is the reviewed sha, line 2 the range/target reviewed.
STAMP="$OUT.sha"

command -v "$GROK_BIN" >/dev/null || { echo "grok not on PATH" >&2; exit 2; }

case "$MODE" in
  diff)
    # Defaults to the whole branch: the only range the merge tail ever uses, and
    # `HEAD~1..HEAD` silently reviewed just the tip when the range was omitted.
    #
    # `origin/main`, not `main`. Work happens in worktrees, where local `main`
    # lives in the primary checkout and does not move — `git fetch` updates
    # `origin/main` and leaves `main` behind. Reviewing `main..HEAD` there
    # covers commits that already merged, while `gh pr merge` applies only what
    # is past `origin/main` (2026-08-15). Fetch first, or the ref is stale too.
    RANGE="${2:-origin/main..HEAD}"
    case "$RANGE" in
      *...*) echo "pass a two-dot range: diff uses three-dot internally" >&2; exit 2 ;;
    esac
    # `git log A..B` lists this branch's commits, but `git diff A..B` is a TREE
    # diff — once main moves, another PR's landed work shows up as deletions
    # mixed into yours. Three-dot diffs from the merge base, which is what the
    # PR shows. The pairing is deliberate: `git log A...B` would bring the
    # main-only commits back (2026-08-15).
    TARGET="the output of \`git diff ${RANGE/../...}\` and \`git log --oneline $RANGE\` in this repo"
    # Two-dot here on purpose: LABEL is what a reader copies out of the posted
    # comment to reproduce, and the three-dot form is rejected above. Only
    # TARGET converts.
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
Skip style nits and generic advice. If it looks sound, say so in one line. Do not modify any files.

When the review is finished, POST IT YOURSELF on this branch's open pull request, exactly once, as the last thing you do: find the number with \`gh pr view --json number --jq .number\` and comment with \`gh pr comment\`. Head it with the sha you reviewed (\`git rev-parse --short HEAD\`). Post the finished review you would hand a maintainer — not your working narration, and not a transcript of getting there. If no PR is open, say so and post nothing.

That comment is the only write you may make. You are the reviewer, not the workflow: never merge, never push, never close or edit a PR or its title, never run this script, and never execute CLAUDE.md's tail — read it for context only.

PRIVACY — this review is posted to a PUBLIC pull request. Do not open profiles.local.json or any .env file, and never quote a real person's name, weight, injury, pain area, or any credential. Refer to them by field name instead ('the pain-area list', 'the Supabase key'). Personal data lives outside the repo on purpose; a review does not need its values to make its point."

# Always keep the FULL review on disk — piping this script through `tail`
# silently truncated a 15-finding review down to 10 once. Never again.
# Stamp the sha BEFORE the review runs: it is the tree Grok is about to read,
# not whatever HEAD is after a long run. The trap is what makes "a crashed
# review leaves no stamp" true — without it, a run that dies at turn 4 leaves a
# valid-looking stamp beside a truncated transcript, and `post` publishes it.
rm -f "$STAMP"
trap 'rm -f "$STAMP"' EXIT
{ git rev-parse HEAD; printf '%s\n' "$LABEL"; } >"$STAMP"
"$GROK_BIN" -p "$PROMPT" --always-approve --max-turns "$MAX_TURNS" --disable-web-search | tee "$OUT"
trap - EXIT
echo "--- $LABEL: reviewed $(sed -n 1p "$STAMP" | cut -c1-7); Grok posts its own review ---" >&2
echo "--- transcript saved to $OUT — if no comment landed on the PR, write the findings in by hand ---" >&2
