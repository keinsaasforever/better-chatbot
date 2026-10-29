/**
 * Slugs are the entire access control for a published page — anyone holding
 * one can read it — so the random suffix has to carry real entropy. The
 * readable prefix is cosmetic only; never treat it as a namespace.
 */
const RANDOM_SUFFIX_BYTES = 12;

function readablePrefix(title: string): string {
  const cleaned = title
    .toLowerCase()
    .normalize("NFKD")
    // Strip combining marks so "Störyboard" degrades to "storyboard" rather
    // than dropping the letter entirely.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return cleaned || "page";
}

export function buildPageSlug(title: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(RANDOM_SUFFIX_BYTES));
  const suffix = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${readablePrefix(title)}-${suffix}`;
}

/** Rejects anything that could not have come from buildPageSlug. */
export function isValidPageSlug(slug: string): boolean {
  return /^[a-z0-9-]{1,64}-[0-9a-f]{24}$/.test(slug);
}
