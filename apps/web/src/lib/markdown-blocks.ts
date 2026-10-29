// Leading fence marker (``` or ~~~) with up to 3 spaces of indent, per CommonMark.
const FENCE_RE = /^(\s{0,3})(`{3,}|~{3,})(.*)$/;

/**
 * Split streamed markdown into top-level blocks separated by blank lines,
 * without ever splitting inside a fenced code block (even an unclosed one that
 * is still streaming).
 *
 * Fence state at any position depends only on the text before it, so appending
 * tokens never changes an earlier block boundary. Every block except the last
 * is therefore byte-stable across streaming updates, which lets the renderer
 * memoize settled blocks and re-parse only the growing tail block.
 */
export function parseMarkdownIntoBlocks(markdown: string): string[] {
  if (!markdown) return [];

  const lines = markdown.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null; // the opening run, e.g. "```" or "````"
  let inMath = false; // inside a $$ ... $$ display-math block

  for (const line of lines) {
    // A lone `$$` opens/closes display math; guard it like a fence so a blank
    // line inside a multi-line equation never splits the expression.
    if (fence === null && line.trim() === "$$") {
      inMath = !inMath;
      current.push(line);
      continue;
    }

    const match = FENCE_RE.exec(line);
    if (match && !inMath) {
      const run = match[2];
      const info = match[3];
      if (fence === null) {
        fence = run; // opening fence
      } else if (
        run[0] === fence[0] &&
        run.length >= fence.length &&
        info.trim() === "" // a closing fence carries no info string
      ) {
        fence = null; // closing fence
      }
      current.push(line);
      continue;
    }

    if (fence === null && !inMath && line.trim() === "") {
      if (current.length) {
        blocks.push(current.join("\n"));
        current = [];
      }
      continue; // drop the blank separator itself
    }

    current.push(line);
  }

  if (current.length) blocks.push(current.join("\n"));
  return blocks;
}
