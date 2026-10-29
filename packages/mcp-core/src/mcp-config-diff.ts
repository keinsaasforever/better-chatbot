import equal from "./equal";
import {
  isMaybeMCPServerConfig,
  type MCPServerConfig,
} from "@keinsaas/mcp-types";

// Types of changes that can occur in configuration
export type ConfigChangeType = "add" | "remove" | "update";

/**
 * Represents a change in MCP server configuration
 */
export interface ConfigChange {
  type: ConfigChangeType;
  key: string;
  value: MCPServerConfig;
}

/**
 * Validates that a config is a valid MCP server config
 */
const validate = (config: unknown) => {
  if (!isMaybeMCPServerConfig(config)) {
    throw new Error("Invalid MCP server configuration");
  }
  return config;
};

/**
 * Detects changes between two MCP server configuration objects
 * Identifies added, removed, and updated configurations
 */
export function detectConfigChanges(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): ConfigChange[] {
  const changes: ConfigChange[] = [];
  const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);

  for (const key of allKeys) {
    const prevValue = prev[key];
    const nextValue = next[key];

    if (!(key in prev)) {
      // New configuration added
      changes.push({
        type: "add",
        key,
        value: validate(nextValue),
      });
    } else if (!(key in next)) {
      // Configuration removed
      changes.push({
        type: "remove",
        key,
        value: validate(prevValue),
      });
    } else if (!equal(prevValue, nextValue)) {
      // Configuration updated
      changes.push({
        type: "update",
        key,
        value: validate(nextValue),
      });
    }
  }

  return changes;
}
