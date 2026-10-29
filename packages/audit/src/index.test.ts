import { describe, expect, it } from "vitest";
import { createAuditEvent, hashPayload } from "./index";

describe("audit", () => {
  it("hashes payloads deterministically", async () => {
    const first = await hashPayload({ a: 1 });
    const second = await hashPayload({ a: 1 });
    expect(first).toBe(second);
    expect(first).toHaveLength(64);
  });

  it("creates validated audit events", () => {
    const event = createAuditEvent({
      surface: "desktop",
      action: "mcp.tool.call",
      resourceType: "mcp_tool",
      toolName: "read_file",
      outcome: "success",
    });
    expect(event.surface).toBe("desktop");
    expect(event.timestamp).toBeTruthy();
  });
});
