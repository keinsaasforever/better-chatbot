/**
 * Turning on update checks in a copy of better-chatbot.
 *
 * Vercel's Deploy button copies the repository without `.github/workflows`
 * (its GitHub app may not create workflow files), so a copy cannot check for
 * updates until its owner adds the workflow. GitHub opens a new-file page
 * pre-filled from `filename` and `value`; the owner only clicks "Commit
 * changes". The text below must stay identical to
 * `.github/workflows/update-from-upstream.yml` (a test checks it).
 */
export const UPDATE_WORKFLOW_PATH =
  ".github/workflows/update-from-upstream.yml";

export const UPDATE_WORKFLOW_YAML = `# Checks once a week for a new better-chatbot and opens a pull request with
# step-by-step instructions (GitHub emails you). Nothing changes in your live
# app until you merge. Run it any time: Actions → this workflow → Run workflow.
name: Check for better-chatbot updates
on:
  schedule:
    - cron: '23 7 * * 1'
  workflow_dispatch:
permissions:
  contents: write
  pull-requests: write
  issues: write
jobs:
  update:
    if: github.repository != 'keinsaasforever/better-chatbot'
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - env:
          GH_TOKEN: \${{ github.token }}
          BASE: \${{ github.event.repository.default_branch }}
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          # The update scripts come from the latest better-chatbot, so a fix
          # to them reaches every copy, however old.
          git fetch --quiet --no-tags https://github.com/keinsaasforever/better-chatbot.git main
          for s in update-from-upstream publish-update; do
            git show "FETCH_HEAD:scripts/$s.sh" > "$RUNNER_TEMP/$s.sh"
          done
          OUT="$RUNNER_TEMP/update.env" bash "$RUNNER_TEMP/update-from-upstream.sh"
          bash "$RUNNER_TEMP/publish-update.sh" "$RUNNER_TEMP/update.env"
`;

/** The GitHub page that creates the workflow in the given repository. */
export function updateSetupUrl(input: {
  owner: string;
  repo: string;
  branch: string;
}): string {
  const params = new URLSearchParams({
    filename: UPDATE_WORKFLOW_PATH,
    value: UPDATE_WORKFLOW_YAML,
  });
  return `https://github.com/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/new/${encodeURIComponent(input.branch)}?${params}`;
}

/**
 * The setup link for this deployment, from the Git details Vercel exposes, or
 * null where it cannot be built (not on Vercel, or not a GitHub repository).
 */
export function updateSetupUrlForDeployment(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const owner = env.VERCEL_GIT_REPO_OWNER;
  const repo = env.VERCEL_GIT_REPO_SLUG;
  if (env.VERCEL_GIT_PROVIDER !== "github" || !owner || !repo) return null;
  // The upstream repository has nothing to update from.
  if (owner === "keinsaasforever" && repo === "better-chatbot") return null;
  return updateSetupUrl({
    owner,
    repo,
    branch: env.VERCEL_GIT_COMMIT_REF || "main",
  });
}
