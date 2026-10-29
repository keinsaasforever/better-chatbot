/**
 * Deterministic "mentions" edges, gbrain-style: when a page's compiled truth
 * names another page of the same project (by any known alias, or through a
 * `[[Title]]` wikilink), link them. Zero LLM calls, runs on every page write.
 */

export type MentionAlias = {
  pageId: string;
  /** Lower-cased, whitespace-collapsed alias as stored in project_brain_alias. */
  normalizedAlias: string;
};

/** Aliases shorter than this are too ambiguous ("Max", "Q3", "PR"). */
const MIN_ALIAS_LENGTH = 4;

const WIKILINK = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Page ids mentioned in `text`, excluding `selfPageId`. Matching is
 * case-insensitive on word boundaries; a wikilink resolves by alias too.
 */
export function findMentions(input: {
  text: string;
  aliases: MentionAlias[];
  selfPageId?: string;
}): string[] {
  const text = input.text;
  if (!text.trim() || !input.aliases.length) return [];

  const lowered = normalize(text);
  const found = new Set<string>();

  const wikilinked = new Set<string>();
  for (const match of text.matchAll(WIKILINK)) {
    wikilinked.add(normalize(match[1] ?? ""));
  }

  for (const alias of input.aliases) {
    if (alias.pageId === input.selfPageId) continue;
    if (found.has(alias.pageId)) continue;
    const needle = alias.normalizedAlias;
    if (!needle) continue;

    if (wikilinked.has(needle)) {
      found.add(alias.pageId);
      continue;
    }

    if (needle.length < MIN_ALIAS_LENGTH) continue;
    // Unicode-aware word boundary: no letter/digit directly before or after.
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`,
      "u",
    );
    if (pattern.test(lowered)) found.add(alias.pageId);
  }

  return [...found];
}
