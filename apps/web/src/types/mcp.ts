// Compatibility shim: the MCP types/schemas were extracted to
// @keinsaas/mcp-types (docs/monorepo.md Phase 3). Import from the package in new
// code; this re-export keeps existing `app-types/mcp` imports working until
// consumers migrate (§8 strategy — no alias removed before its consumers).
export * from "@keinsaas/mcp-types";
