/**
 * Resolves a model-emitted tool name back to a bound tool.
 *
 * Models do not always echo the name we advertised. Observed on the Kimi line
 * (the Navigator base model at the time): the model emits its wire-format
 * namespace, which reaches us through the AI Gateway with the dot normalised —
 * `functions_COMPOSIO_SEARCH_TOOLS` for a tool bound as
 * `COMPOSIO_SEARCH_TOOLS`. Nothing resolves it, so the step returns a
 * `tool-error` instead of a result, the error is fed back, and the model spends
 * the `stepCountIs(10)` budget re-emitting the same name. Observed on staging
 * both ways: recovered on step 1 once, gave up once.
 *
 * This never invents a tool. It only ever returns a name that is already bound,
 * so stripping an aggressive prefix cannot reach anything the model was not
 * offered.
 */

/**
 * Namespaces models prepend to a tool name, longest first so `functions_` is
 * tried before a bare `tool_` could bite into it. The separator is matched
 * separately because the gateway rewrites `.` to `_`.
 */
const TOOL_NAMESPACES = ["functions", "tools", "tool", "namespace"];

/** Some models append a call index: `functions.web_search:0`. */
const CALL_INDEX = /:\d+$/;

const stripNamespace = (name: string): string | undefined => {
  const lower = name.toLowerCase();
  for (const namespace of TOOL_NAMESPACES) {
    for (const separator of [".", "_", ":"]) {
      const prefix = `${namespace}${separator}`;
      if (lower.startsWith(prefix) && name.length > prefix.length) {
        return name.slice(prefix.length);
      }
    }
  }
  return undefined;
};

/**
 * The bound name this call meant, or `null` when nothing plausible matches.
 *
 * Returns the name unchanged when it is already bound: the caller compares, so
 * "resolved to itself" and "no repair possible" stay distinguishable.
 */
export const repairToolName = (
  boundToolNames: Iterable<string>,
  rawName: string,
): string | null => {
  const bound = [...boundToolNames];
  const byLowerCase = new Map<string, string[]>();
  for (const name of bound) {
    const key = name.toLowerCase();
    byLowerCase.set(key, [...(byLowerCase.get(key) ?? []), name]);
  }

  const boundSet = new Set(bound);
  const exact = (candidate: string): string | null =>
    boundSet.has(candidate) ? candidate : null;

  // Case-insensitive only when it is unambiguous. Two tools differing by case
  // alone is pathological, but guessing between them would be worse.
  const insensitive = (candidate: string): string | null => {
    const matches = byLowerCase.get(candidate.toLowerCase());
    return matches?.length === 1 ? matches[0] : null;
  };

  const candidates = [rawName.trim()];
  const withoutIndex = candidates[0].replace(CALL_INDEX, "");
  if (withoutIndex !== candidates[0]) candidates.push(withoutIndex);
  for (const candidate of [...candidates]) {
    const stripped = stripNamespace(candidate);
    if (stripped) candidates.push(stripped);
  }

  for (const candidate of candidates) {
    const hit = exact(candidate);
    if (hit) return hit;
  }
  for (const candidate of candidates) {
    const hit = insensitive(candidate);
    if (hit) return hit;
  }

  return null;
};
