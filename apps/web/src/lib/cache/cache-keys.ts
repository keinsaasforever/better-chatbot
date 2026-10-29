export const CacheKeys = {
  thread: (threadId: string) => `thread-${threadId}`,
  user: (userId: string) => `user-${userId}`,
  mcpServerCustomizations: (userId: string) =>
    `mcp-server-customizations-${userId}`,
};
