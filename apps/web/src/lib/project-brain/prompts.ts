import { buildCurrentDateTimePrompt } from "@/lib/ai/prompts";
import { EDGE_TYPE_DESCRIPTIONS, PROJECT_EDGE_TYPES } from "./edge-types";

export function buildGatherSystemPrompt(input: {
  projectName: string;
  projectGoal?: string | null;
  projectDescription?: string | null;
  projectSystemPrompt?: string | null;
}) {
  return [
    buildCurrentDateTimePrompt(),
    `Read current data for project "${input.projectName}".`,
    input.projectGoal
      ? `Project goal: ${input.projectGoal}`
      : "No explicit project goal is set.",
    input.projectDescription
      ? `Project description: ${input.projectDescription}`
      : "",
    input.projectSystemPrompt
      ? `Project instructions: ${input.projectSystemPrompt}`
      : "",
    "Derive the project's key topics, entities and names from its name, goal and description.",
    "Call read actions WITH project-scoped parameters — search queries, filters, labels, repo/board/project names and recent time ranges — so you only fetch information relevant to THIS project (e.g. search mail by the project's topics, filter tasks by the project's name). Prefer recent data. Interpret 'recent' relative to the current date above — never assume a year.",
    "Use only the supplied read-only actions.",
    "Return a concise factual summary after retrieving current state.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * System prompt for the project-level consolidation: one status and one to-do
 * list for the whole project, merged from every source's signals and judged
 * strictly against the project's goal.
 */
export function buildConsolidationSystemPrompt() {
  return [
    buildCurrentDateTimePrompt(),
    "You maintain the single status board of a project. Input contains the project's name, goal, description and instructions, the most connected entities of its knowledge graph with their relations (graphContext), the latest signals from every connected source (tools, documents, chats), the to-dos that already exist, the keys of to-dos the user closed, and the previous status.",
    "Use graphContext to name the right people, organizations and meetings in to-dos and the summary; do not invent relations it does not contain.",
    "Return exactly one health, one short summary, a short list of blockers and one merged list of to-dos for the whole project.",
    "Judge importance strictly against the project goal, description and instructions. Drop anything a project member would not act on. Never mirror a source: a calendar is not a to-do list and an inbox is not a status.",
    "A meeting becomes a to-do only when it needs preparation or a decision. Routine recurring events are not to-dos.",
    "Keep at most 8 open to-dos. Prefer items with a deadline, a blocker, an explicit request to the team, or a decision that is due.",
    "Set `notify: true` only for items worth interrupting a project member for right now: a deadline within days, a blocker, an explicit request, or a decision that is due. Everything else is `notify: false`.",
    "Reuse the exact `key` of an existing to-do when the item is the same task, even if the wording changed. Create new keys only for genuinely new tasks. Keys are short lowercase slugs.",
    "Put keys of existing to-dos that the sources show as finished into `resolvedKeys`. Never emit a to-do whose key appears in `closedKeys`.",
    "Include `sourceScope` (from the signal that carried the item) and `sourceUrl` / `dueAt` when a source provides them. Do not invent URLs or dates.",
    "`health` reflects progress toward the goal: green on track, yellow at risk, red blocked or behind, unknown only when there is no signal at all. `summary` states the health reason in one or two sentences about the project itself.",
    "Connector failures, authorization errors and sync problems are never blockers, to-dos or health reasons. The application reports them separately.",
    "Judge dates (overdue, at risk, recency) against the current date above — never assume a year.",
  ].join("\n");
}

/** Nightly contradiction judge: do two fact values genuinely conflict? */
export function buildContradictionJudgePrompt() {
  return [
    buildCurrentDateTimePrompt(),
    "You review the facts of a project knowledge graph. Each pair holds two current values for the same fact key on the same page, observed in different sources.",
    "Return `contradiction` only when both values cannot be true at the same time and neither simply supersedes the other by date (a newer status replacing an older one is `compatible`). Different wording for the same thing, partial versus complete information, and dated changes are `compatible`. Use `unknown` when the values are too vague to judge.",
    "Return every pair you were given with `a`, `b` (the ids you received), `verdict` and a one-sentence `explanation`.",
  ].join("\n");
}

/** Nightly dedupe: decide whether two pages describe the same real-world entity. */
export function buildDedupeSystemPrompt() {
  return [
    "You maintain the entity pages of a project knowledge graph.",
    "For each pair decide whether page a and page b describe the SAME real-world person, organization, meeting, task, decision or topic.",
    "Say `same: true` only when the evidence supports it: matching full names, the same email or domain, the same meeting date and participants, or facts that clearly refer to one thing. A shared first name or a similar word alone is not enough.",
    "Return every pair you were given, each with `a`, `b` (the ids you received), `same` and a short `reason`.",
  ].join("\n");
}

export function buildExtractionSystemPrompt() {
  return [
    buildCurrentDateTimePrompt(),
    "You maintain factual project memory.",
    "Return only supported entities and relations grounded in the source.",
    "Do not include credentials, secrets, authorization URLs, or passwords.",
    "Tool failures, HTTP errors, authorization problems and error payloads are not project facts, tasks or status. Ignore them entirely.",
    "Use stable ids and fact keys. A task status belongs on a task entity.",
    `Relation types must be one of: ${PROJECT_EDGE_TYPES.map((type) => `${type} (${EDGE_TYPE_DESCRIPTIONS[type]})`).join("; ")}. Prefer the most specific type; use related_to only when nothing else fits. Link people to organizations, meetings and tasks whenever the source supports it.`,
    "todos: only concrete, actionable items that a project member would act on and that matter for the project's goal. A calendar entry is not a todo unless it needs preparation. Include `sourceUrl` when the source carries a link to the item and `dueAt` (ISO 8601) when a date is explicit. Never emit more than 15.",
    "status: health reflects the project's goal, not the health of the connector. shortSummary is one or two sentences about the project itself.",
    "When sourcePayload.toolCatalog is present it lists the connected tool's read actions with descriptions — use it to judge which categories of information this tool provides.",
    "Focus on information relevant to the project's goal and description; ignore unrelated items that leaked into the source. When projectSystemPrompt is set, let it steer which facts, todos and status signals matter.",
    "Judge dates (overdue, at risk, recency) against the current date above — never assume a year.",
  ].join("\n");
}
