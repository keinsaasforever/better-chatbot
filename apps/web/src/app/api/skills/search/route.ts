import { withAuth } from "auth/route-guard";
import type { SkillSearchResult } from "app-types/skill";

const SEARCH_API_BASE = process.env.SKILLS_API_URL || "https://skills.sh";

// The registry's /api/search requires a non-empty query (the official CLI
// enforces >= 2 chars; there is no trending/leaderboard endpoint). For the
// blank-query "leaderboard" view we search the seed term below — that returns
// the official Vercel skills ranked by installs.
const LEADERBOARD_QUERY = "vercel";

// Proxy the skills.sh registry search server-side (Vercel outbound + no CORS).
export const GET = withAuth(async (request) => {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const owner = url.searchParams.get("owner")?.trim();
  const isLeaderboard = query.length === 0;

  try {
    const params = new URLSearchParams({
      q: isLeaderboard ? LEADERBOARD_QUERY : query,
      limit: isLeaderboard ? "20" : "10",
    });
    if (owner) params.set("owner", owner);

    const res = await fetch(`${SEARCH_API_BASE}/api/search?${params}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return Response.json({ skills: [], unreachable: true });
    }

    const data = (await res.json()) as {
      skills?: Array<{
        id?: string;
        skillId?: string;
        name?: string;
        installs?: number;
        source?: string;
      }>;
    };

    // The registry's `id` is a composite key (owner/repo/skill-name); the short
    // slug used for install/download lives in `skillId`. Expose the clean slug
    // as our result id — it is what the save flow resolves SKILL.md with.
    const skills: SkillSearchResult[] = (data.skills ?? [])
      .map((s) => ({
        id: String(
          s.skillId ||
            String(s.id ?? "")
              .split("/")
              .pop() ||
            "",
        ),
        name: String(s.name ?? ""),
        source: String(s.source ?? ""),
        installs: Number(s.installs ?? 0),
      }))
      .filter((s) => s.id && s.name && s.source)
      .sort((a, b) => b.installs - a.installs);

    return Response.json({ skills });
  } catch (error) {
    console.error("Skill search failed:", error);
    // Fail soft so the UI can show "library unreachable" rather than error out.
    return Response.json({ skills: [], unreachable: true });
  }
});
