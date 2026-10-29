/**
 * Shared access predicate for MCP servers, mirroring the repository
 * convention (see org-scope.test.ts): the owner always has access; a
 * non-owner only when the server is shared ("public") inside the caller's
 * active organization. No active org fails closed to owner-only.
 */
export function isMcpServerInScope(
  server: {
    userId: string;
    organizationId?: string | null;
    visibility?: string | null;
  },
  userId: string,
  organizationId?: string | null,
): boolean {
  if (server.userId === userId) {
    return true;
  }
  if (!organizationId) {
    return false;
  }
  return (
    server.visibility === "public" && server.organizationId === organizationId
  );
}
