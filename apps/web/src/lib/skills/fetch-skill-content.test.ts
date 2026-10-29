import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SkillContentNotFoundError,
  fetchSkillContent,
  parseFrontmatterDescription,
  slugVariants,
  stripFrontmatter,
  toSkillSlug,
} from "./fetch-skill-content";

describe("stripFrontmatter", () => {
  it("removes a leading YAML frontmatter block", () => {
    const md = `---\nname: foo\ndescription: bar\n---\n\n# Body\ncontent here`;
    expect(stripFrontmatter(md)).toBe("# Body\ncontent here");
  });

  it("leaves content without frontmatter unchanged (trimmed)", () => {
    expect(stripFrontmatter("\n# Just body\n")).toBe("# Just body");
  });

  it("does not strip a mid-document '---' rule", () => {
    const md = "# Title\n\nsome text\n\n---\n\nmore";
    expect(stripFrontmatter(md)).toBe(md.trim());
  });
});

describe("parseFrontmatterDescription", () => {
  it("extracts the description field", () => {
    const md = `---\nname: foo\ndescription: Does useful things\n---\nBody`;
    expect(parseFrontmatterDescription(md)).toBe("Does useful things");
  });

  it("strips surrounding quotes", () => {
    const md = `---\ndescription: "Quoted description"\n---\nBody`;
    expect(parseFrontmatterDescription(md)).toBe("Quoted description");
  });

  it("returns undefined without frontmatter", () => {
    expect(parseFrontmatterDescription("# Body only")).toBeUndefined();
  });
});

describe("toSkillSlug", () => {
  it("normalizes names the way the registry does", () => {
    expect(toSkillSlug("React Best Practices")).toBe("react-best-practices");
    expect(toSkillSlug("some_skill  name")).toBe("some-skill-name");
    expect(toSkillSlug("--Weird!!-Name--")).toBe("weird-name");
  });
});

describe("slugVariants", () => {
  it("generates progressively de-prefixed variants", () => {
    expect(slugVariants("vercel-react-best-practices")).toEqual([
      "vercel-react-best-practices",
      "react-best-practices",
      "best-practices",
    ]);
  });

  it("keeps a single-token slug as-is", () => {
    expect(slugVariants("workflow")).toEqual(["workflow"]);
  });
});

describe("fetchSkillContent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("uses the skills.sh download API as the primary source", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        files: [
          {
            path: "SKILL.md",
            contents: "---\ndescription: From api\n---\nHello",
          },
          { path: "references/extra.md", contents: "extra" },
        ],
        hash: "abc",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSkillContent("vercel-labs/agent-skills", "x");
    expect(result.content).toBe("Hello");
    expect(result.description).toBe("From api");
    expect(fetchMock.mock.calls[0][0]).toContain(
      "/api/download/vercel-labs/agent-skills/x",
    );
  });

  it("falls back to raw probing with de-prefixed slug variants", async () => {
    // Registry id "vercel-react-best-practices" lives in the repo at
    // skills/react-best-practices/SKILL.md — the real-world case.
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/download/")) {
        return { ok: false, json: async () => ({}) };
      }
      if (url.endsWith("/HEAD/skills/react-best-practices/SKILL.md")) {
        return {
          ok: true,
          text: async () =>
            "---\nname: React Best Practices\ndescription: React perf\n---\nBody",
        };
      }
      return { ok: false, text: async () => "" };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSkillContent(
      "vercel-labs/agent-skills",
      "vercel-react-best-practices",
    );
    expect(result.content).toBe("Body");
    expect(result.description).toBe("React perf");
    // Never touches api.github.com without a token.
    expect(
      fetchMock.mock.calls.some((c: any[]) =>
        String(c[0]).includes("api.github.com"),
      ),
    ).toBe(false);
  });

  it("rejects a raw hit whose frontmatter names a different skill", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/download/")) {
        return { ok: false, json: async () => ({}) };
      }
      if (url.endsWith("/SKILL.md")) {
        return {
          ok: true,
          text: async () => "---\nname: Entirely Different\n---\nWrong skill",
        };
      }
      return { ok: false, text: async () => "" };
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchSkillContent("owner/repo", "my-skill"),
    ).rejects.toBeInstanceOf(SkillContentNotFoundError);
  });

  it("uses the GitHub Trees API only when GITHUB_TOKEN is set", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/download/")) {
        return { ok: false, json: async () => ({}) };
      }
      if (url.includes("api.github.com")) {
        return {
          ok: true,
          json: async () => ({
            tree: [{ path: "deep/nested/my-skill/SKILL.md", type: "blob" }],
          }),
        };
      }
      if (url.endsWith("/HEAD/deep/nested/my-skill/SKILL.md")) {
        return { ok: true, text: async () => "---\nname: My Skill\n---\nBody" };
      }
      return { ok: false, text: async () => "" };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSkillContent("owner/repo", "my-skill");
    expect(result.content).toBe("Body");
    const treesCall = fetchMock.mock.calls.find((c: any[]) =>
      String(c[0]).includes("api.github.com"),
    );
    expect(treesCall?.[1]?.headers?.Authorization).toBe("Bearer test-token");
    expect(treesCall?.[1]?.headers?.["User-Agent"]).toBeTruthy();
  });

  it("throws SkillContentNotFoundError when nothing resolves", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
        text: async () => "",
      }),
    );
    await expect(
      fetchSkillContent("owner/repo", "missing"),
    ).rejects.toBeInstanceOf(SkillContentNotFoundError);
  });

  it("normalizes a composite registry id down to the skill slug", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/download/")) {
        // Correct: only the last segment reaches the download URL.
        expect(url).toContain(
          "/api/download/vercel-labs/agent-skills/vercel-react-best-practices",
        );
        return {
          ok: true,
          json: async () => ({
            files: [{ path: "SKILL.md", contents: "Hello" }],
          }),
        };
      }
      return { ok: false, text: async () => "" };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSkillContent(
      "vercel-labs/agent-skills",
      "vercel-labs/agent-skills/vercel-react-best-practices",
    );
    expect(result.content).toBe("Hello");
  });

  it("rejects a malformed source without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchSkillContent("not-a-repo", "x")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caps very large content", async () => {
    const huge = "a".repeat(20 * 1024);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          files: [{ path: "SKILL.md", contents: huge }],
        }),
      }),
    );
    const result = await fetchSkillContent("owner/repo", "x");
    expect(result.content.length).toBeLessThan(huge.length);
    expect(result.content).toContain("[…truncated]");
  });
});
