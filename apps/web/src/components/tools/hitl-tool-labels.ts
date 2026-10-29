/**
 * Message keys for the HITL tools' display names.
 *
 * These tools are hidden from the tool selector and driven by the system
 * prompt, so a user has no prior context for `proposeEmail` when the raw
 * identifier shows up in the thread. Each one owns a dedicated card; this map
 * covers the states that fall through to the generic tool row.
 *
 * Keys rather than literal names: the cards render in the user's locale, and a
 * hardcoded English label here would be the one English word left in an
 * otherwise translated thread. Paths are relative to the `Chat` namespace.
 */
export const HITL_TOOL_LABEL_KEYS: Record<string, string> = {
  proposeEmail: "Hitl.email.title",
  askForPlanApproval: "Hitl.plan.title",
  requestInput: "Hitl.input.title",
  createAgent: "CreateAgent.title",
};
