import { join } from "path";

export const MCP_CONFIG_PATH =
  process.env.MCP_CONFIG_PATH || join(process.cwd(), ".mcp-config.json");
