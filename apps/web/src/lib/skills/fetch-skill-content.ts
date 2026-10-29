import globalLogger from "logger";

// Resolves and fetches a skill's SKILL.md instruction body. Resolution order:
//   1. skills.sh's download API — a cached snapshot of the skill's files:
//      GET {base}/api/download/{owner}/{repo}/{slug} -> { files: [{path, contents}] }
//   2. Direct raw.githubusercontent probing on the default branch (HEAD ref).
//      No rate limits and no auth — the reliable path on shared-egress hosts
//      (unauthenticated api.github.com is rate-limited per IP on Vercel).
//      Registry ids often prefix context onto the directory name (e.g. id
//      "vercel-react-best-practices" -> dir "react-best-practices"), so we
//      probe progressively de-prefixed slug variants and verify ambiguous hits
//      against the SKILL.md frontmatter name.
//   3. GitHub Trees API discovery — only when GITHUB_TOKEN is set (it is
//      useless unauthenticated in production).
// Only a validated `owner/repo` + `slug` ever drive the URLs — never an
// arbitrary user-supplied URL.

const logger = globalLogger.withDefaults({ message: "Skills: " });

const MAX_CONTENT_BYTES = 16 * 1024; // Cap to protect the prompt budget.
const DOWNLOAD_API_BASE = process.env.SKILLS_API_URL || "https://skills.sh";
const FETCH_TIMEOUT_MS = 10_000;

export class SkillContentNotFoundError extends Error {
  constructor(source: string, slug: string) {
    super(`No SKILL.md found for ${source} (${slug})`);
    this.name = "SkillContentNotFoundError";
  }
}

export type SkillContent = {
  content: string;
  /** description parsed from the SKILL.md frontmatter, when present */
  description?: string;
};

/**
 * The registry's slug normalization (mirrors the official CLI's toSkillSlug):
 * lowercase, whitespace/underscores to hyphens, strip non-alphanumerics,
 * collapse and trim hyphens.
 */
export function toSkillSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Registry ids often prepend owner/brand context to the skill's directory name
 * ("vercel-react-best-practices" -> "react-best-practices"). Generate the full
 * slug plus progressively de-prefixed variants (dropping one leading token at a
 * time while at least one token remains).
 */
export function slugVariants(slug: string): string[] {
  const normalized = toSkillSlug(slug);
  const tokens = normalized.split("-").filter(Boolean);
  const variants: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const variant = tokens.slice(i).join("-");
    if (variant) variants.push(variant);
  }
  // Cap the tail: single-token variants ("practices") are too ambiguous.
  return variants.filter((v, idx) => idx === 0 || v.includes("-")).slice(0, 4);
}

/** Strip YAML frontmatter (a leading `---` … `---` block) and trim. */
export function stripFrontmatter(markdown: string): string {
  const match = markdown.match(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  const body = match ? markdown.slice(match[0].length) : markdown;
  return body.trim();
}

function frontmatterField(markdown: string, field: string): string | undefined {
  const fm = markdown.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return undefined;
  const line = fm[1].match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
  if (!line) return undefined;
  const value = line[1].trim().replace(/^["']|["']$/g, "");
  return value.length ? value : undefined;
}

/** Pull the `description:` value out of a SKILL.md frontmatter block. */
export function parseFrontmatterDescription(
  markdown: string,
): string | undefined {
  return frontmatterField(markdown, "description");
}

function capContent(content: string): string {
  if (content.length <= MAX_CONTENT_BYTES) return content;
  return `${content.slice(0, MAX_CONTENT_BYTES)}\n\n[…truncated]`;
}

function toResult(rawSkillMd: string): SkillContent | null {
  const body = stripFrontmatter(rawSkillMd);
  if (!body.length) return null;
  return {
    content: capContent(body),
    description: parseFrontmatterDescription(rawSkillMd),
  };
}

/**
 * A probed SKILL.md matches the requested skill when the registry slug equals
 * or ends with the slugified frontmatter name (the registry id may carry an
 * owner/brand prefix the file's own name lacks).
 */
function matchesWantedSkill(rawSkillMd: string, wanted: string): boolean {
  const name = frontmatterField(rawSkillMd, "name");
  if (!name) return true; // No frontmatter name to verify against.
  const nameSlug = toSkillSlug(name);
  if (!nameSlug) return true;
  return wanted === nameSlug || wanted.endsWith(nameSlug);
}

async function fetchJson(
  url: string,
  signal?: AbortSignal,
  headers?: Record<string, string>,
): Promise<any> {
  const res = await fetch(url, {
    signal: signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: "application/json", ...headers },
  });
  if (!res.ok) return null;
  return res.json();
}

async function fetchText(
  url: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: "text/plain" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Step 1: the skills.sh cached snapshot of the skill's files. */
async function fetchFromDownloadApi(
  owner: string,
  repo: string,
  slug: string,
  signal?: AbortSignal,
): Promise<SkillContent | null> {
  try {
    const url = `${DOWNLOAD_API_BASE}/api/download/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(slug)}`;
    const data = (await fetchJson(url, signal)) as {
      files?: Array<{ path?: string; contents?: string }>;
    } | null;
    if (!data?.files?.length) return null;

    // The snapshot contains every file in the skill directory; the SKILL.md at
    // the shallowest path is the skill's manifest.
    const skillMd = data.files
      .filter(
        (f) =>
          typeof f.path === "string" &&
          typeof f.contents === "string" &&
          (f.path === "SKILL.md" || f.path.endsWith("/SKILL.md")),
      )
      .sort((a, b) => a.path!.length - b.path!.length)[0];
    if (!skillMd) return null;

    return toResult(skillMd.contents!);
  } catch {
    return null;
  }
}

/**
 * Step 2: probe the common repository layouts directly on
 * raw.githubusercontent.com (HEAD = default branch). No rate limits, no auth.
 */
async function fetchFromRawProbing(
  owner: string,
  repo: string,
  slug: string,
  signal?: AbortSignal,
): Promise<SkillContent | null> {
  const wanted = toSkillSlug(slug);
  const base = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD`;

  const candidates: string[] = [];
  for (const variant of slugVariants(slug)) {
    candidates.push(
      `skills/${variant}/SKILL.md`,
      `${variant}/SKILL.md`,
      `.claude/skills/${variant}/SKILL.md`,
      `.agents/skills/${variant}/SKILL.md`,
    );
  }
  candidates.push("SKILL.md"); // Single-skill repo root, last.

  for (const path of candidates) {
    const raw = await fetchText(`${base}/${path}`, signal);
    if (raw == null) continue;
    if (!matchesWantedSkill(raw, wanted)) continue;
    const result = toResult(raw);
    if (result) return result;
  }
  return null;
}

/**
 * Step 3: discover the SKILL.md path via the GitHub Trees API. Only useful
 * with a token — unauthenticated api.github.com is rate-limited per egress IP,
 * which on shared serverless IPs means it effectively always fails.
 */
async function fetchFromGitHubTrees(
  owner: string,
  repo: string,
  slug: string,
  signal?: AbortSignal,
): Promise<SkillContent | null> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;

  const wanted = toSkillSlug(slug);
  let tree: { tree?: Array<{ path?: string; type?: string }> } | null = null;
  try {
    tree = await fetchJson(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`,
      signal,
      {
        Authorization: `Bearer ${token}`,
        "User-Agent": "keinsaas-navigator",
      },
    );
  } catch {
    return null;
  }
  if (!tree?.tree?.length) return null;

  const skillMdPaths = tree.tree
    .filter(
      (e) =>
        e.type === "blob" &&
        typeof e.path === "string" &&
        (e.path === "SKILL.md" || e.path.endsWith("/SKILL.md")),
    )
    .map((e) => e.path!);

  // Prefer directory-name matches (exact, then registry-prefixed), then fall
  // back to frontmatter-name verification across all discovered files.
  const scored = skillMdPaths
    .map((p) => {
      const parts = p.split("/");
      const dir = parts.length > 1 ? toSkillSlug(parts[parts.length - 2]) : "";
      const score =
        dir && dir === wanted
          ? 0
          : dir && wanted.endsWith(dir)
            ? 1
            : skillMdPaths.length === 1
              ? 2
              : 3;
      return { path: p, score };
    })
    .sort((a, b) => a.score - b.score);

  for (const { path, score } of scored) {
    if (score === 3 && scored[0].score < 3) break;
    const raw = await fetchText(
      `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${path}`,
      signal,
    );
    if (raw == null) continue;
    if (score >= 2 && !matchesWantedSkill(raw, wanted)) continue;
    const result = toResult(raw);
    if (result) return result;
  }
  return null;
}

/**
 * Fetch the SKILL.md body (and frontmatter description) for a skill. Throws
 * `SkillContentNotFoundError` when no resolution path succeeds.
 */
export async function fetchSkillContent(
  source: string,
  rawSlug: string,
  signal?: AbortSignal,
): Promise<SkillContent> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(source)) {
    throw new Error(`Invalid skill source: ${source}`);
  }
  const [owner, repo] = source.split("/");
  // The registry's composite id is owner/repo/skill-name; only the last
  // segment is the skill slug. Normalize so a composite can never poison the
  // download URL or the probing variants.
  const slug = rawSlug.split("/").filter(Boolean).pop() ?? rawSlug;

  const fromApi = await fetchFromDownloadApi(owner, repo, slug, signal);
  if (fromApi) return fromApi;
  logger.warn(`download API miss for ${source}/${slug}, probing GitHub raw`);

  const fromRaw = await fetchFromRawProbing(owner, repo, slug, signal);
  if (fromRaw) return fromRaw;
  logger.warn(`raw probing miss for ${source}/${slug}`);

  const fromTrees = await fetchFromGitHubTrees(owner, repo, slug, signal);
  if (fromTrees) return fromTrees;
  logger.warn(`all resolution paths failed for ${source}/${slug}`);

  throw new SkillContentNotFoundError(source, slug);
}
