/**
 * Matching an agent from whatever a speech model said.
 *
 * Client-safe and pure, because both halves need it: `askAgent` resolves on
 * the server, while `activateAgent` is handled inline in the voice hook and
 * resolves in the browser. One implementation keeps the two from disagreeing
 * about which agent "the sales one" means.
 */

export type AgentChoice = { id: string; name: string };

/**
 * Find the agent a reference points at, or `null`.
 *
 * A speech model does not say UUIDs. Even with the roster in its instructions
 * it paraphrases — "the sales agent", "Sales", "unser Vertriebsagent" — so an
 * id-only lookup fails on the common case. Tried in order:
 *
 * 1. exact id, so a model that DID quote the roster is never second-guessed
 * 2. exact name, case-insensitive
 * 3. name contains the reference, or the reference contains the name — the
 *    latter catches "use the Sales agent" against an agent called "Sales"
 *
 * A contains match is only accepted when exactly ONE agent matches: with two
 * candidates the model should be told to pick, not silently handed the first.
 */
export function matchAgentByReference<T extends AgentChoice>(
  agents: readonly T[],
  reference: string,
): T | null {
  const needle = reference.trim().toLowerCase();
  if (!needle) return null;

  const byId = agents.find((agent) => agent.id === reference.trim());
  if (byId) return byId;

  const byName = agents.find((agent) => agent.name.toLowerCase() === needle);
  if (byName) return byName;

  const partial = agents.filter((agent) => {
    const name = agent.name.toLowerCase();
    return name.includes(needle) || needle.includes(name);
  });
  return partial.length === 1 ? partial[0] : null;
}
