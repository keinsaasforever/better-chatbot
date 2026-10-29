/**
 * Email bodies are not markdown.
 *
 * Models write `**bold**` and `- item` out of habit, but an email body is
 * delivered as RFC 2822 MIME: either `text/plain` (shown verbatim — the
 * asterisks stay on screen) or `text/html` (markdown is still not parsed).
 * Neither renders markdown, so the syntax has to be resolved before the body
 * leaves the approval UI.
 *
 * Both directions are produced from the same draft:
 * - `markdownToPlainTextEmail` — drops the syntax, keeps the structure. Safe
 *   for any email tool, which is why it backs the primary body fields.
 * - `markdownToHtmlEmail` — renders the syntax as inline-styled HTML for tools
 *   that accept an HTML body (Gmail `text/html`, Composio `is_html: true`).
 */

/** `**bold**` / `__bold__` — never spanning a line break. */
const BOLD_RE = /(\*\*|__)(?=\S)([^\n]*?\S)\1/g;
/** `*italic*` / `_italic_`, only at word boundaries so `a_b` and `2 * 3` survive. */
const ITALIC_RE = /(^|[\s(["'])([*_])(?=\S)([^\n]*?\S)\2(?=[\s).,;:!?\]"']|$)/g;
/** `` `code` `` */
const CODE_RE = /`([^`\n]+)`/g;
/** `[label](https://example.com)` with an optional `"title"`. */
const LINK_RE = /\[([^\]\n]+)\]\(\s*([^\s)]+)(?:\s+"[^"]*")?\s*\)/g;
/** `# Heading` */
const HEADING_RE = /^ {0,3}#{1,6}[ \t]+/gm;
/** `> quote` */
const QUOTE_RE = /^ {0,3}> ?/gm;
/** `---`, `***`, `___` on their own line. */
const RULE_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm;
/** `- item`, `* item`, `+ item`, `• item` */
const BULLET_RE = /^([ \t]*)(?:[-*+]|•)[ \t]+/;
/** `1. item`, `2) item` */
const ORDERED_RE = /^([ \t]*)\d+[.)][ \t]+/;

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/** Normalise CRLF and strip markdown constructs that only mark up a block. */
function stripBlockMarkers(body: string): string {
  return body
    .replace(/\r\n?/g, "\n")
    .replace(RULE_RE, "")
    .replace(HEADING_RE, "")
    .replace(QUOTE_RE, "");
}

/** `.test()` on a `/g` regex advances `lastIndex`, so probe on a fresh copy. */
function matches(pattern: RegExp, body: string): boolean {
  return new RegExp(pattern.source, pattern.flags.replace("g", "")).test(body);
}

/**
 * True when the draft carries markdown that would leak into a plain-text mail.
 * Bullet markers are deliberately excluded — `- item` reads fine as-is.
 */
export function hasMarkdownSyntax(body: string): boolean {
  if (!body) return false;
  return [BOLD_RE, ITALIC_RE, CODE_RE, LINK_RE, HEADING_RE].some((pattern) =>
    matches(pattern, body),
  );
}

/**
 * Resolve markdown into text that reads correctly in any mail client:
 * emphasis markers disappear, links keep their URL, list markers become `•`.
 */
export function markdownToPlainTextEmail(body: string): string {
  if (!body) return "";

  const text = stripBlockMarkers(body)
    .replace(LINK_RE, (_match, label: string, url: string) =>
      label.trim() === url.trim() ? url : `${label} (${url})`,
    )
    .replace(BOLD_RE, "$2")
    .replace(ITALIC_RE, "$1$3")
    .replace(CODE_RE, "$1");

  return text
    .split("\n")
    .map((line) => line.replace(BULLET_RE, "$1• ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The fragment is rendered in-app as well as sent, so a draft must not be able
 * to smuggle a `javascript:` handler into an anchor. Anything outside the
 * schemes an email would legitimately link to degrades to text.
 */
const SAFE_URL_RE = /^(https?:|mailto:|tel:|#|\/|[\w./-]+$)/i;

/** Inline markdown → HTML. Input must already be HTML-escaped. */
function inlineToHtml(escaped: string): string {
  return escaped
    .replace(LINK_RE, (_match, label: string, url: string) =>
      SAFE_URL_RE.test(url)
        ? `<a href="${url}">${label.trim()}</a>`
        : `${label.trim()} (${url})`,
    )
    .replace(BOLD_RE, "<strong>$2</strong>")
    .replace(ITALIC_RE, "$1<em>$3</em>")
    .replace(CODE_RE, "<code>$1</code>");
}

type Block =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "ul" | "ol"; lines: string[] };

/** Group lines into paragraphs and lists; a blank line always closes a block. */
function toBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];

  for (const line of lines) {
    if (!line.trim()) {
      blocks.push({ kind: "paragraph", lines: [] });
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    const ordered = bullet ? null : ORDERED_RE.exec(line);
    const kind = bullet ? "ul" : ordered ? "ol" : "paragraph";
    const content = bullet
      ? line.replace(BULLET_RE, "")
      : ordered
        ? line.replace(ORDERED_RE, "")
        : line.trim();

    const current = blocks.at(-1);
    if (current && current.kind === kind && current.lines.length > 0) {
      current.lines.push(content);
    } else {
      blocks.push({ kind, lines: [content] } as Block);
    }
  }

  return blocks.filter((block) => block.lines.length > 0);
}

/**
 * Render the draft as an HTML fragment for tools that send `text/html`.
 * Styles are inline because Gmail strips `<style>` blocks.
 */
export function markdownToHtmlEmail(body: string): string {
  if (!body) return "";

  const lines = escapeHtml(stripBlockMarkers(body)).split("\n");

  return toBlocks(lines)
    .map((block) => {
      const items = block.lines.map(inlineToHtml);
      if (block.kind === "paragraph") {
        return `<p style="margin:0 0 16px 0;">${items.join("<br />")}</p>`;
      }
      const tag = block.kind;
      const listItems = items
        .map((item) => `<li style="margin:0 0 4px 0;">${item}</li>`)
        .join("");
      return `<${tag} style="margin:0 0 16px 0; padding-left:20px;">${listItems}</${tag}>`;
    })
    .join("\n");
}
