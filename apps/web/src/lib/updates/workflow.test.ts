import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  UPDATE_WORKFLOW_PATH,
  UPDATE_WORKFLOW_YAML,
  updateSetupUrlForDeployment,
} from "./workflow";

describe("update workflow setup", () => {
  it("embeds exactly the workflow file the repository ships", () => {
    const shipped = readFileSync(
      path.resolve(__dirname, "../../../../../", UPDATE_WORKFLOW_PATH),
      "utf8",
    );
    expect(UPDATE_WORKFLOW_YAML).toBe(shipped);
  });

  it("links to GitHub's pre-filled new-file page for this deployment", () => {
    const url = new URL(
      updateSetupUrlForDeployment({
        VERCEL_GIT_PROVIDER: "github",
        VERCEL_GIT_REPO_OWNER: "hagen",
        VERCEL_GIT_REPO_SLUG: "better-chatbot",
        VERCEL_GIT_COMMIT_REF: "main",
      }) as string,
    );
    expect(url.origin + url.pathname).toBe(
      "https://github.com/hagen/better-chatbot/new/main",
    );
    expect(url.searchParams.get("filename")).toBe(UPDATE_WORKFLOW_PATH);
    expect(url.searchParams.get("value")).toBe(UPDATE_WORKFLOW_YAML);
  });

  it("has no link off Vercel, off GitHub, or for the upstream repository", () => {
    expect(updateSetupUrlForDeployment({})).toBeNull();
    expect(
      updateSetupUrlForDeployment({
        VERCEL_GIT_PROVIDER: "gitlab",
        VERCEL_GIT_REPO_OWNER: "a",
        VERCEL_GIT_REPO_SLUG: "b",
      }),
    ).toBeNull();
    expect(
      updateSetupUrlForDeployment({
        VERCEL_GIT_PROVIDER: "github",
        VERCEL_GIT_REPO_OWNER: "keinsaasforever",
        VERCEL_GIT_REPO_SLUG: "better-chatbot",
      }),
    ).toBeNull();
  });
});
