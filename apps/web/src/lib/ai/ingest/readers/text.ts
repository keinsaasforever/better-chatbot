import { decodeTextFile, formatTextPreviewText } from "@/lib/file-ingest/text";
import type { Reader } from "./reader";

/**
 * .txt, .md and .json, read as-is.
 *
 * JSON is not reformatted: the model reads it better as the document the user
 * has than as a re-serialised one, and pretty-printing a minified file would
 * spend the whole budget on whitespace.
 */
export const readText: Reader = async ({ buffer, label, maxChars }) => {
  const extract = decodeTextFile(buffer, { maxChars });
  return {
    text: formatTextPreviewText(label, extract),
    truncated: extract.truncated,
  };
};
