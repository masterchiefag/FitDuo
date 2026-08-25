#!/usr/bin/env bash
# Free port 5173 so `npm run dev` can start.
#
# The dev server is --strictPort on 5173 and has to stay there: localStorage is
# keyed per origin, so a silent fallback to :5174 is an app with no streak, no
# XP and an empty History, and sessions logged there are invisible from :5173
# (PR #18, docs/DECISIONS.md). CLAUDE.md's instruction when the port is taken is
# therefore "free the port", never "use another one".
#
# In practice the thing holding it is a walk server left running by a session
# that has finished — one per worktree, and they outlive their branch. Doing
# that by hand means an agent running a bare `kill <pid>`, which is a much
# larger permission to hand out than the job needs. This script is the narrow
# version: it kills a **vite** process listening on 5173 and refuses anything
# else, so `Bash(scripts/dev/free-dev-port.sh:*)` can sit in settings.json next
# to the other project commands without granting a general kill.
#
# No arguments, and the port is hardcoded on purpose — a `$1` would turn one
# allow-rule into permission to kill a vite server on any port.
set -euo pipefail

PORT=5173

pids_on_port() {
  lsof -t -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
}

PIDS=$(pids_on_port)
if [ -z "$PIDS" ]; then
  echo "port $PORT is already free"
  exit 0
fi

for pid in $PIDS; do
  CMD=$(ps -o command= -p "$pid" 2>/dev/null || true)
  case "$CMD" in
    *vite*)
      echo "killing vite on $PORT (pid $pid)"
      echo "  $CMD"
      kill "$pid"
      ;;
    *)
      # Anything that is not a dev server is out of scope: this exists to clear
      # a stale FitDuo preview, not to make room by ending someone's work.
      echo "refusing: pid $pid holds $PORT and is not a vite dev server" >&2
      echo "  $CMD" >&2
      exit 1
      ;;
  esac
done

# The socket outlives the process by a moment; reporting "free" before it is
# would just move the failure into the caller's `npm run dev`.
for _ in $(seq 1 40); do
  if [ -z "$(pids_on_port)" ]; then
    echo "port $PORT is free"
    exit 0
  fi
  sleep 0.25
done

echo "port $PORT is still held 10s after kill" >&2
exit 1
