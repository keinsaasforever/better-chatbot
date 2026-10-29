import { describe, expect, it } from "vitest";
import {
  buildLegacyProjectAgentsetSlug,
  buildProjectAgentsetSlug,
  buildProjectAgentsetSlugCandidates,
  parseConflictSlugFromError,
} from "./project-slugs";

describe("buildProjectAgentsetSlug", () => {
  it("uses the full normalized project id", () => {
    const projectId = "6FEA39D3-4421-4ABC-9DEF-0123456789AB";
    expect(buildProjectAgentsetSlug(projectId)).toBe(
      "project-6fea39d3-4421-4abc-9def-0123456789ab",
    );
  });
});

describe("buildLegacyProjectAgentsetSlug", () => {
  it("matches the original slug format", () => {
    expect(
      buildLegacyProjectAgentsetSlug(
        "6fea39d3-4421-4abc-9def-0123456789ab",
        "test",
      ),
    ).toBe("project-test-6fea39d3");
  });
});

describe("buildProjectAgentsetSlugCandidates", () => {
  it("returns both current and legacy slugs", () => {
    expect(
      buildProjectAgentsetSlugCandidates({
        projectId: "6fea39d3-4421-4abc-9def-0123456789ab",
        projectName: "test",
      }),
    ).toEqual([
      "project-6fea39d3-4421-4abc-9def-0123456789ab",
      "project-test-6fea39d3",
    ]);
  });
});

describe("parseConflictSlugFromError", () => {
  it("extracts slug from Agentset conflict errors", () => {
    expect(
      parseConflictSlugFromError(
        new Error('The slug "project-test-6fea39d3" is already in use.'),
      ),
    ).toBe("project-test-6fea39d3");
  });
});
