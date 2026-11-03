#!/usr/bin/env bash
# Publish what update-from-upstream.sh prepared: push the update branch and
# open a pull request with step-by-step instructions (GitHub emails the
# owner), or an issue when the update needs a hand.
#
#   bash scripts/publish-update.sh <outcome-file>
#
# Needs GH_TOKEN, GITHUB_REPOSITORY and GITHUB_REPOSITORY_OWNER (set in
# GitHub Actions) and BASE, the branch Vercel deploys from.
set -euo pipefail

# The outcome file holds key=value lines; read them into STATUS, BRANCH, ...
while IFS='=' read -r key value; do
  [ -n "$key" ] && printf -v "$(echo "$key" | tr '[:lower:]' '[:upper:]')" '%s' "$value"
done < "$1"
STATUS="${STATUS:-}"
BRANCH="${BRANCH:-}"
VERSION="${VERSION:-}"
NOTES="${NOTES:-/dev/null}"
SKIPPED="${SKIPPED:-}"
OWNER="$GITHUB_REPOSITORY_OWNER"
REPO="$GITHUB_REPOSITORY"
BASE="${BASE:-main}"

case "$STATUS" in
  ready) ;;
  conflict | unknown-base)
    title="A better-chatbot update needs a hand"
    # One open issue is enough; do not add another every week.
    if [ -n "$(gh issue list --state open --search "in:title \"$title\"" --json number --jq '.[0].number')" ]; then
      exit 0
    fi
    if [ "$STATUS" = conflict ]; then
      reason="This copy has its own changes in places the new version also changed, so the update could not be applied automatically."
    else
      reason="This copy has changed too much to tell which version of better-chatbot it started from."
    fi
    {
      echo "@$OWNER, a new version of better-chatbot is available, but it could not be prepared automatically."
      echo
      echo "$reason Your live app is not affected."
      echo
      echo "Ask in [Discord](https://discord.gg/9dwdAYKBPp) and we will help you update."
    } > help.md
    gh issue create --title "$title" --body-file help.md
    exit 0
    ;;
  *)
    echo "Nothing to publish ($STATUS)."
    exit 0
    ;;
esac

git push origin "$BRANCH"
title="Update better-chatbot to $VERSION"

{
  echo "## A new version of better-chatbot is ready ($VERSION)"
  echo
  echo "@$OWNER, here is how to install it. It takes about five minutes. Until you click **Merge**, your live app keeps running the version it has now."
  echo
  echo "1. **Try it first (optional).** Vercel is building a preview of the new version. In a few minutes a comment from Vercel appears below this text with a **Visit Preview** link. Open it and look around."
  echo "2. **Install it.** Scroll to the bottom of this page, click the green **Merge pull request** button, then **Confirm merge**."
  echo "3. **Done.** Vercel puts the new version live automatically, usually within five minutes. You can follow it in your Vercel dashboard under **Deployments**."
  echo
  echo "If something looks wrong, don't merge. Ask in [Discord](https://discord.gg/9dwdAYKBPp) and we will help."
  echo
  echo "### What's new"
  cat "$NOTES"
  if [ -n "$SKIPPED" ]; then
    echo
    echo "<details><summary>For developers: workflow files not included</summary>"
    echo
    echo "GitHub does not let an automated update change workflow files. These changed upstream; copy them from keinsaasforever/better-chatbot if you want them:"
    echo
    echo "$SKIPPED" | tr ',' '\n' | sed 's/^/- /'
    echo
    echo "</details>"
  fi
} > body.md

if gh pr create --base "$BASE" --head "$BRANCH" --title "$title" --body-file body.md; then
  exit 0
fi

# Some accounts do not let workflows open pull requests. An issue
# with a one-click link gets the same email to the owner.
compare="https://github.com/$REPO/compare/$BASE...$BRANCH?expand=1"
{
  echo "## A new version of better-chatbot is ready ($VERSION)"
  echo
  echo "@$OWNER, here is how to install it:"
  echo
  echo "1. Open this link: $compare"
  echo "2. Click the green **Create pull request** button."
  echo "3. Follow the steps in that pull request: try the preview, then click **Merge pull request**."
  echo
  echo "_Tip: to skip step 1 and 2 next time, open Settings → Actions → General in this repository and tick **Allow GitHub Actions to create and approve pull requests**._"
  echo
  echo "### What's new"
  cat "$NOTES"
} > issue.md
gh issue create --title "$title" --body-file issue.md