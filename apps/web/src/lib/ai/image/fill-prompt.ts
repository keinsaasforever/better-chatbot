import type { ModelMessage } from "ai";
import { extractLatestUserText, sanitizeImagePrompt } from "./image-inputs";

/**
 * Longest prompt sent to the inpainting model.
 *
 * FLUX Fill paints the masked region from the prompt alone, so every extra
 * clause is another thing it tries to fit into that region. Half the cap of a
 * full-frame prompt is already generous for "what this patch should look
 * like".
 */
export const MAX_FILL_PROMPT_CHARS = 300;

/**
 * Quoted literals, in the quote styles a model writes across our locales.
 *
 * Single quotes are deliberately absent: an apostrophe ("don't", "l'image")
 * would open a span that swallows the rest of the prompt.
 */
const QUOTED_SPANS: RegExp[] = [
  /"[^"\n]*"/g,
  /“[^”\n]*”/g, // “ ... ”
  /„[^“”\n]*[“”]/g, // „ ... “ (de) and „ ... ”
  /«[^»\n]*»/g, // « ... » (fr)
  /‚[^‘’\n]*[‘’]/g, // ‚ ... ’
];

/** True once nothing but punctuation and spaces is left. */
const isBlank = (text: string): boolean => !/[\p{L}\p{N}]/u.test(text);

/**
 * Turn what the chat model wrote into a prompt an inpainting model can use.
 *
 * FLUX Fill is not instruction-following: it regenerates the masked region to
 * match the prompt, so "remove the text \"3x RESEARCH OUTPUT\"" makes it paint
 * that text back, in whatever font it picks — which is exactly what users saw.
 * The schema now asks the model to describe the finished region instead, and
 * this is the backstop for when it does not.
 *
 * On a removal the region is meant to end up empty, so any quoted literal in
 * the prompt is something the user wants *gone* — dropping it is what stops it
 * being rendered. On a replacement the quoted words are the ones to paint
 * (`replace this with "SALE"`), so the text is left exactly as written.
 */
export function toFillPrompt(
  text: string,
  action: "remove" | "replace" | null,
): string {
  let out = sanitizeImagePrompt(text);
  if (action === "remove") {
    for (const pattern of QUOTED_SPANS) out = out.replace(pattern, " ");
  }
  out = out
    // Stripping a span leaves the punctuation that framed it behind.
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:]\s*){2,}/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,.;:!?\-\s]+/, "")
    .trim();
  if (isBlank(out)) return "";
  return out.slice(0, MAX_FILL_PROMPT_CHARS).trim();
}

/**
 * The text handed to a dedicated image API for one call.
 *
 * Without a mask an empty prompt is worth replacing with the user's own last
 * message — it is the only description there is. With one it is not: that
 * message is the instruction ("delete the writing up there"), and feeding an
 * instruction to a fill model is the bug this guards. The image API's `text`
 * is optional, so an empty string means "fill this region from its
 * surroundings", which is the right answer for a removal with nothing to say.
 */
export function resolveImageApiText(input: {
  prompt?: string;
  messages?: ModelMessage[];
  hasMask?: boolean;
}): string {
  if (input.prompt) return input.prompt;
  if (input.hasMask) return "";
  return extractLatestUserText(input.messages ?? []);
}
