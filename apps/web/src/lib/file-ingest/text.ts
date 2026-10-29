import type { Buffer } from "node:buffer";

/**
 * Plain-text formats (.txt, .md, .json) as characters the model can read.
 *
 * UTF-8 only, and deliberately so. Guessing an encoding is a heuristic that
 * fails silently in both directions, and every source that reaches this — a
 * browser upload, a tool that wrote the file — writes UTF-8 unless the user
 * exported from a legacy Windows tool. Detection for Latin-1/Windows-1252 is a
 * tracked follow-up rather than a guess made here.
 *
 * An invalid byte sequence becomes U+FFFD rather than an error. The alternative
 * was rejecting the file: a Latin-1 CSV with one umlaut in it would then read as
 * nothing at all, when 99.9% of it is perfectly good text. The caller is told
 * that substitution happened (`replacedInvalidBytes`) so it can say so instead
 * of pretending the text is exact.
 */

export type TextExtract = {
  text: string;
  /** The file held more text than `maxChars` allowed. */
  truncated: boolean;
  /** At least one byte sequence was not valid UTF-8 and became U+FFFD. */
  replacedInvalidBytes: boolean;
};

/**
 * Bytes that can encode `chars` characters of UTF-8, plus room for one more
 * sequence. Decoding only this prefix keeps a 5 MB file from becoming a 5 MB
 * string on a shared instance when 50k characters are all that will be kept.
 */
const byteBudgetFor = (chars: number) => chars * 4 + 8;

/**
 * Bytes to characters, reporting whether anything had to be substituted.
 *
 * `stream: true` on both decoders holds back an incomplete trailing sequence
 * rather than replacing it, so a caller that deliberately cut the buffer at a
 * byte boundary is not told the file is corrupt.
 */
export function decodeUtf8(bytes: Buffer): {
  text: string;
  replacedInvalidBytes: boolean;
} {
  let replacedInvalidBytes = false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: true });
  } catch {
    replacedInvalidBytes = true;
  }

  let text = new TextDecoder("utf-8").decode(bytes, { stream: true });

  // A BOM is an encoding marker, not content; left in place it shows up as a
  // stray character at the start of the first line the model reads.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  return { text, replacedInvalidBytes };
}

export function decodeTextFile(
  content: Buffer,
  opts: { maxChars: number },
): TextExtract {
  const maxChars = Math.max(1, opts.maxChars);
  const budget = byteBudgetFor(maxChars);
  const cut = content.byteLength > budget;
  const { text, replacedInvalidBytes } = decodeUtf8(
    cut ? content.subarray(0, budget) : content,
  );

  const truncated = cut || text.length > maxChars;
  return {
    text: truncated ? text.slice(0, maxChars) : text,
    truncated,
    replacedInvalidBytes,
  };
}

/** The text of a plain-text attachment, with what was left out stated. */
export function formatTextPreviewText(
  name: string,
  extract: TextExtract,
): string {
  const notes = [
    extract.truncated
      ? `truncated to the first ${extract.text.length} characters`
      : null,
    extract.replacedInvalidBytes
      ? "some bytes were not valid UTF-8 and were replaced"
      : null,
  ].filter(Boolean);

  const header = notes.length
    ? `Contents of ${name} (${notes.join("; ")}):`
    : `Contents of ${name}:`;
  return `${header}\n\n${extract.text}`;
}
