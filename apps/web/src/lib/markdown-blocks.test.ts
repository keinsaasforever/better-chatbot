import { describe, expect, test } from "vitest";
import { parseMarkdownIntoBlocks } from "./markdown-blocks";

describe("parseMarkdownIntoBlocks", () => {
  test("splits paragraphs on blank lines", () => {
    expect(parseMarkdownIntoBlocks("para1\n\npara2")).toEqual([
      "para1",
      "para2",
    ]);
  });

  test("keeps an unclosed streaming fence as a single tail block", () => {
    const blocks = parseMarkdownIntoBlocks(
      "intro\n\n```python\ndef foo():\n\n    return 1",
    );
    expect(blocks).toEqual(["intro", "```python\ndef foo():\n\n    return 1"]);
  });

  test("does not split on blank lines inside a closed fence", () => {
    const blocks = parseMarkdownIntoBlocks("```js\na\n\nb\n```\n\nafter");
    expect(blocks).toEqual(["```js\na\n\nb\n```", "after"]);
  });

  test("does not split a blank line inside a $$ display-math block", () => {
    const blocks = parseMarkdownIntoBlocks("$$\na = b\n\nc = d\n$$\n\nafter");
    expect(blocks).toEqual(["$$\na = b\n\nc = d\n$$", "after"]);
  });

  test("prefix blocks stay identical as the tail grows (streaming invariant)", () => {
    const prefix = parseMarkdownIntoBlocks("a\n\nb\n\nc");
    const grown = parseMarkdownIntoBlocks("a\n\nb\n\ncc more");
    expect(grown.slice(0, -1)).toEqual(prefix.slice(0, -1));
    expect(grown[grown.length - 1]).toBe("cc more");
  });

  test("empty input yields no blocks", () => {
    expect(parseMarkdownIntoBlocks("")).toEqual([]);
  });
});
