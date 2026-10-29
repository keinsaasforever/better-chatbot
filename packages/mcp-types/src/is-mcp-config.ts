import type { MCPServerConfig, MCPRemoteConfig, MCPStdioConfig } from "./mcp";

/**
 * Type guard to check if an object is potentially a valid stdio config
 */
export function isMaybeStdioConfig(config: unknown): config is MCPStdioConfig {
  if (typeof config !== "object" || config === null) {
    return false;
  }
  return "command" in config && typeof config.command === "string";
}

/**
 * Type guard to check if an object is potentially a valid remote config (sse,streamable)
 */
export function isMaybeRemoteConfig(
  config: unknown,
): config is MCPRemoteConfig {
  if (typeof config !== "object" || config === null) {
    return false;
  }
  return "url" in config && typeof config.url === "string";
}

/**
 * Type guard for MCP server config (either stdio or remote)
 */
export function isMaybeMCPServerConfig(
  config: unknown,
): config is MCPServerConfig {
  return isMaybeStdioConfig(config) || isMaybeRemoteConfig(config);
}
