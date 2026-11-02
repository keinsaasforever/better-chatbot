#!/usr/bin/env bash
# Bring the latest better-chatbot into this copy, as one commit on a branch.
#
# A one-click Vercel deploy copies the repository's files without its history,
# so `git merge` has nothing to work from. Instead this finds which upstream
# version the copy is at, takes everything upstream changed since then, and
# applies it with a three-way merge: changes made in this copy are kept, and
# a clash with an upstream change is reported rather than overwritten.
#
# Run by .github/workflows/update-from-upstream.yml. Writes its outcome as
# key=value lines to $GITHUB_OUTPUT (or stdout):
#   status   up-to-date | ready | conflict | unknown-base | exists
#   branch, version, latest   for status=ready
#   notes    path of a file with the list of changes
#   skipped  workflow files that changed upstream but cannot be updated here
set -euo pipefail

UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/keinsaasforever/better-chatbot.git}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-main}"
REMOTE="${REMOTE:-origin}"
OUT="${GITHUB_OUTPUT:-/dev/stdout}"
TRAILER="Updated-To"

say() { echo "$1=$2" >> "$OUT"; }

git fetch --quiet --no-tags "$UPSTREAM_URL" \
  "+refs/heads/$UPSTREAM_BRANCH:refs/upstream/$UPSTREAM_BRANCH"
latest=$(git rev-parse "refs/upstream/$UPSTREAM_BRANCH")

# Which upstream version is this copy at? In order of confidence:
#   1. the trailer an earlier update left behind;
#   2. shared history, when the copy was made with it (a fork or clone);
#   3. an upstream commit whose files match this copy's first commit exactly,
#      which is what a one-click deploy creates.
base=$(git log --format=%B HEAD |
  sed -n "s/^$TRAILER: \([0-9a-f]\{40\}\)\$/\1/p" | head -n 1)
if [ -z "$base" ]; then
  base=$(git merge-base HEAD "$latest" 2>/dev/null || true)
fi
if [ -z "$base" ]; then
  root_tree=$(git rev-parse "$(git rev-list --max-parents=0 HEAD | tail -n 1)^{tree}")
  base=$(git log --format='%H %T' "$latest" |
    awk -v tree="$root_tree" '$2 == tree { print $1; exit }')
fi
if [ -z "$base" ]; then
  say status unknown-base
  exit 0
fi

if [ "$base" = "$latest" ] || git merge-base --is-ancestor "$latest" "$base"; then
  say status up-to-date
  exit 0
fi

short=$(git rev-parse --short "$latest")
branch="update/better-chatbot-$short"
if [ -n "$(git ls-remote --heads "$REMOTE" "$branch" 2>/dev/null)" ]; then
  say status exists
  say branch "$branch"
  exit 0
fi

# Several updates can share a package version between releases, so the
# commit is part of the label.
version=$(git show "$latest:package.json" | sed -n 's/^  "version": "\(.*\)",$/\1/p' | head -n 1)
version="${version:+$version }($short)"
notes=$(mktemp)
git log --first-parent --format='- %s' "$base..$latest" > "$notes"

# A workflow token may not change workflow files, so those are left out and
# listed for the owner to copy by hand. Everything else is applied.
skipped=$(git diff --name-only "$base" "$latest" -- .github/workflows | paste -sd, -)

git switch --quiet -c "$branch"
patch=$(mktemp)
git diff --binary --full-index "$base" "$latest" -- . ':(exclude).github/workflows' > "$patch"
if [ -s "$patch" ] && ! git apply --3way --index "$patch" 2>/dev/null; then
  git reset --quiet --hard
  git switch --quiet -
  git branch --quiet -D "$branch"
  say status conflict
  say version "$version"
  say latest "$latest"
  say notes "$notes"
  exit 0
fi

git commit --quiet --allow-empty -F - <<MSG
Update better-chatbot to $version

$TRAILER: $latest
MSG

say status ready
say branch "$branch"
say version "$version"
say latest "$latest"
say notes "$notes"
say skipped "$skipped"
