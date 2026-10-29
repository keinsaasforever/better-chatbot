/** Default-deny write-capable FS tools until audit + consent (docs/monorepo.md §6). */
export const ALLOWED_DESKTOP_MCP_TOOLS = new Set([
  "read_file",
  "read_text_file",
  "read_media_file",
  "list_directory",
  "list_dir",
  "list_allowed_directories",
  "search_files",
  "get_file_info",
  "directory_tree",
  "list_tools",
]);

export function isDesktopMcpToolAllowed(toolName: string): boolean {
  return ALLOWED_DESKTOP_MCP_TOOLS.has(toolName);
}

export function assertDesktopMcpToolAllowed(toolName: string): void {
  if (!isDesktopMcpToolAllowed(toolName)) {
    throw new Error(
      `Tool "${toolName}" is not allowed in the desktop MCP policy gate`,
    );
  }
}

export function filterAllowedDesktopMcpTools<T extends { name: string }>(
  tools: T[],
): T[] {
  return tools.filter((tool) => isDesktopMcpToolAllowed(tool.name));
}
