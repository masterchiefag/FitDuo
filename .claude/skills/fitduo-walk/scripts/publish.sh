#!/usr/bin/env bash
# Publish walk frames to an orphan branch and print raw URLs ready to paste
# into a PR body. `gh` cannot upload an image to a comment or PR body; GitHub
# does proxy and render raw.githubusercontent.com links, so the frames ride on
# a branch that never merges and keeps `main` free of binaries.
#
#   ./publish.sh <frames-dir> <branch-suffix>
set -euo pipefail

DIR=${1:?usage: publish.sh <frames-dir> <branch-suffix>}
SUFFIX=${2:?usage: publish.sh <frames-dir> <branch-suffix>}
BRANCH="walk-frames/$SUFFIX"

shopt -s nullglob
FRAMES=("$DIR"/*.png)
[ ${#FRAMES[@]} -gt 0 ] || { echo "publish: no .png files in $DIR" >&2; exit 1; }

SLUG=$(gh repo view --json nameWithOwner -q .nameWithOwner)
REMOTE=$(git remote get-url origin)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

git init -q "$TMP/frames"
cp "${FRAMES[@]}" "$TMP/frames/"
git -C "$TMP/frames" add -A
git -C "$TMP/frames" -c user.name="$(git config user.name)" -c user.email="$(git config user.email)" \
  commit -qm "Walk frames for $SUFFIX"
git -C "$TMP/frames" push -q --force "$REMOTE" "HEAD:refs/heads/$BRANCH"

echo "pushed $BRANCH (${#FRAMES[@]} frames) — paste into the PR body:"
echo
for f in "${FRAMES[@]}"; do
  name=$(basename "$f")
  echo "![${name%.png}](https://raw.githubusercontent.com/$SLUG/$BRANCH/$name)"
done
