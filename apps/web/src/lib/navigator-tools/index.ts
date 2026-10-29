/**
 * Navigator tools: one typed registry of Navigator capabilities, served over
 * MCP (`/api/navigator-mcp`) and in-process to the realtime voice session.
 *
 * Server-only through `registry`. Client code that only needs names,
 * descriptions or schemas imports `lib/navigator-tools/definitions` directly.
 */
export { getTool, listTools, NAVIGATOR_TOOLS, runTool } from "./registry";
export {
  getNavigatorToolSpec,
  isNavigatorToolName,
  listNavigatorToolSpecs,
  NAVIGATOR_TOOL_SPECS,
} from "./definitions";
export type {
  NavigatorTool,
  NavigatorToolSpec,
  ToolActor,
  ToolResult,
} from "./types";
export { NavigatorToolError } from "./types";
