import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "./middleware";

describe("middleware cookie redirect", () => {
  it("lets the Navigator MCP endpoint answer for itself without a cookie", async () => {
    const response = await middleware(
      new NextRequest("http://localhost/api/navigator-mcp", { method: "POST" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("still redirects other API routes without a cookie", async () => {
    const response = await middleware(
      new NextRequest("http://localhost/api/cockpit/api-keys"),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/sign-in");
  });

  it("does not exempt look-alike paths", async () => {
    const response = await middleware(
      new NextRequest("http://localhost/api/navigator-mcp-admin"),
    );
    expect(response.status).toBe(307);
  });
});
