#!/usr/bin/env bash
# Record that a review-tail step completed AT THE CURRENT COMMIT.
#
# Records live in .git/ (never committed, never pushed) and are keyed by sha,
# so pushing another commit silently invalidates every prior step — which is
# exactly what stops "I reviewed it" from meaning "I reviewed an older version".
#
# Usage: scripts/dev/record-step.sh <grok|self-review|suite>
set -euo pipefail

STEP="${1:-}"
case "$STEP" in
  grok | self-review | suite) ;;
  *)
    echo "usage: $0 <grok|self-review|suite>" >&2
    exit 2
    ;;
esac

SHA="$(git rev-parse HEAD)"
DIR="$(git rev-parse --git-dir)/fitduo-review"
mkdir -p "$DIR"
touch "$DIR/$SHA"
if ! grep -qx "$STEP" "$DIR/$SHA" 2>/dev/null; then
  echo "$STEP" >>"$DIR/$SHA"
fi
echo "recorded '$STEP' for ${SHA:0:7}"
