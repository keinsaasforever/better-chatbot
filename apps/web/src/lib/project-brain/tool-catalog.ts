/**
 * Compact catalog of a connector's read actions (slug + provider-supplied
 * description). Persisted with each tool-sync raw source so the extraction
 * step knows which categories of information the tool provides when deciding
 * which widgets to populate — no hardcoded per-toolkit registry.
 */
export function buildToolCatalog(
  // AI SDK tools may carry a dynamic description function; only static
  // string descriptions are useful for the catalog.
  tools: Record<string, { description?: unknown }>,
) {
  return Object.entries(tools)
    .slice(0, 40)
    .map(([slug, tool]) => ({
      slug,
      description:
        typeof tool.description === "string"
          ? tool.description.replace(/\s+/g, " ").slice(0, 200)
          : "",
    }));
}
