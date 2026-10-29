import { afterEach, describe, expect, it, vi } from "vitest";

// withAuth just needs to pass the handler through for these tests.
vi.mock("auth/route-guard", () => ({
  withAuth: (handler: any) => (request: Request) =>
    handler(request, { user: { id: "u1" }, session: {} }),
}));

const { GET } = await import("./route");

function makeRequest(q = "") {
  const params = q ? `?q=${encodeURIComponent(q)}` : "";
  // The handler only reads request.url; a plain Request suffices.
  return new Request(`http://localhost/api/skills/search${params}`) as any;
}

describe("skills search route", () => {
  afterEach(() => vi.restoreAllMocks());

  it("prefers the registry's skillId over the composite id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          skills: [
            {
              id: "vercel-labs/agent-skills/vercel-react-best-practices",
              skillId: "vercel-react-best-practices",
              name: "React Best Practices",
              source: "vercel-labs/agent-skills",
              installs: 100,
            },
          ],
        }),
      }),
    );

    const res = await GET(makeRequest("react"));
    const body = await res.json();
    expect(body.skills[0].id).toBe("vercel-react-best-practices");
  });

  it("falls back to the last segment of a composite id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          skills: [
            {
              id: "owner/repo/my-skill",
              name: "My Skill",
              source: "owner/repo",
              installs: 5,
            },
          ],
        }),
      }),
    );

    const res = await GET(makeRequest("my"));
    const body = await res.json();
    expect(body.skills[0].id).toBe("my-skill");
  });

  it("substitutes the leaderboard seed query when q is blank", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ skills: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await GET(makeRequest());
    expect(String(fetchMock.mock.calls[0][0])).toContain("q=vercel");
  });
});
