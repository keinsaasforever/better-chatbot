/**
 * Pure access predicate for knowledge bases — same fail-closed shape as the
 * agent sharing model: owners always pass; org-shared (public) rows pass only
 * when the viewer's active org matches the row's org. A null active org or a
 * null row org never matches.
 */
export function canAccessKnowledgeBase(
  kb: {
    userId: string;
    organizationId: string | null;
    visibility: "public" | "private";
  },
  viewer: { userId: string; activeOrganizationId?: string | null },
): boolean {
  if (kb.userId === viewer.userId) return true;
  return (
    kb.visibility === "public" &&
    !!viewer.activeOrganizationId &&
    kb.organizationId === viewer.activeOrganizationId
  );
}
