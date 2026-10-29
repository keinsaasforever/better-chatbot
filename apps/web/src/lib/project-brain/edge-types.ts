/**
 * Typed edge vocabulary for the project knowledge graph (gbrain-style schema
 * pack, kept deliberately small). The extraction model must pick from this
 * list; anything else collapses to `related_to` so the graph stays queryable
 * ("who works at X", "what is blocked by Y") instead of accumulating
 * free-text edge names.
 */
export const PROJECT_EDGE_TYPES = [
  "works_at",
  "reports_to",
  "client_of",
  "attended",
  "organizes",
  "responsible_for",
  "owns",
  "blocked_by",
  "depends_on",
  "decided_in",
  "discussed_in",
  "part_of",
  "mentions",
  "related_to",
] as const;

export type ProjectEdgeType = (typeof PROJECT_EDGE_TYPES)[number];

export const EDGE_TYPE_DESCRIPTIONS: Record<ProjectEdgeType, string> = {
  works_at: "person works at / belongs to an organization",
  reports_to: "person reports to another person",
  client_of: "organization or person is a client of another",
  attended: "person attended a meeting",
  organizes: "person or organization organizes a meeting or event",
  responsible_for: "person is responsible for a task, decision or topic",
  owns: "person or organization owns a document, tool or topic",
  blocked_by: "task or decision is blocked by another item",
  depends_on: "item depends on another item",
  decided_in: "decision was made in a meeting or document",
  discussed_in: "topic or task was discussed in a meeting, document or chat",
  part_of: "item is part of a larger item",
  mentions: "source or page mentions another page",
  related_to: "generic relation when nothing more specific applies",
};

const ALIASES: Record<string, ProjectEdgeType> = {
  employed_by: "works_at",
  member_of: "works_at",
  employee_of: "works_at",
  works_for: "works_at",
  manager_of: "reports_to",
  managed_by: "reports_to",
  customer_of: "client_of",
  client: "client_of",
  attended_by: "attended",
  participant: "attended",
  participated_in: "attended",
  organized_by: "organizes",
  organizer: "organizes",
  hosts: "organizes",
  owner_of: "owns",
  owned_by: "owns",
  assigned_to: "responsible_for",
  assignee: "responsible_for",
  leads: "responsible_for",
  blocks: "blocked_by",
  blocker: "blocked_by",
  requires: "depends_on",
  dependency: "depends_on",
  decided_at: "decided_in",
  discussed_at: "discussed_in",
  mentioned_in: "discussed_in",
  belongs_to: "part_of",
  child_of: "part_of",
  contains: "part_of",
  references: "mentions",
  refers_to: "mentions",
  cites: "mentions",
  relates_to: "related_to",
  associated_with: "related_to",
};

const KNOWN = new Set<string>(PROJECT_EDGE_TYPES);

/** Map any model-emitted relation type onto the vocabulary. */
export function normalizeEdgeType(
  raw: string | null | undefined,
): ProjectEdgeType {
  const key = (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
  if (KNOWN.has(key)) return key as ProjectEdgeType;
  return ALIASES[key] ?? "related_to";
}

export function isProjectEdgeType(value: string): value is ProjectEdgeType {
  return KNOWN.has(value);
}
