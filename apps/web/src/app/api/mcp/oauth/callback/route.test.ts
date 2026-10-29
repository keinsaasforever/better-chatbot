import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionByState: vi.fn(),
  selectById: vi.fn(),
  getMCPClientsManager: vi.fn(),
  getClient: vi.fn(),
  refreshClient: vi.fn(),
  ensureOAuthState: vi.fn(),
  finishAuth: vi.fn(),
}));

vi.mock("@/lib/db/repository", () => ({
  mcpOAuthRepository: {
    getSessionByState: mocks.getSessionByState,
  },
  mcpRepository: {
    selectById: mocks.selectById,
  },
}));

vi.mock("lib/ai/mcp/mcp-manager", () => ({
  getMCPClientsManager: mocks.getMCPClientsManager,
}));

vi.mock("logger", () => ({
  default: {
    withDefaults: () => ({ info: vi.fn(), error: vi.fn() }),
  },
}));

import { GET } from "./route";

function callbackRequest(query: string): NextRequest {
  return new Request(
    `https://app.keinsaas.com/api/mcp/oauth/callback?${query}`,
  ) as NextRequest;
}

describe("GET /api/mcp/oauth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionByState.mockResolvedValue({
      state: "oauth-state",
      mcpServerId: "server-1",
    });
    mocks.selectById.mockResolvedValue({
      id: "server-1",
      userId: "owner-1",
    });
    mocks.getMCPClientsManager.mockReturnValue({
      getClient: mocks.getClient,
      refreshClient: mocks.refreshClient,
    });
    mocks.getClient.mockResolvedValue({
      client: {
        ensureOAuthState: mocks.ensureOAuthState,
        finishAuth: mocks.finishAuth,
      },
    });
    mocks.refreshClient.mockResolvedValue(undefined);
  });

  it("finishes the code exchange through the MCP owner's scoped manager", async () => {
    const response = await GET(
      callbackRequest("code=authorization-code&state=oauth-state"),
    );

    expect(response.status).toBe(200);
    expect(mocks.getMCPClientsManager).toHaveBeenCalledWith("owner-1");
    expect(mocks.ensureOAuthState).toHaveBeenCalledWith("oauth-state");
    expect(mocks.finishAuth).toHaveBeenCalledWith(
      "authorization-code",
      "oauth-state",
    );
    expect(mocks.refreshClient).toHaveBeenCalledWith("server-1");

    const html = await response.text();
    expect(html).toContain("MCP_OAUTH_SUCCESS");
    expect(html).toContain("setTimeout(() => window.close(), 1000)");
  });

  it("keeps callback failures visible instead of immediately closing", async () => {
    mocks.finishAuth.mockRejectedValue(
      new Error("token exchange <script>alert(1)</script> failed"),
    );

    const response = await GET(
      callbackRequest("code=authorization-code&state=oauth-state"),
    );

    expect(response.status).toBe(500);
    const html = await response.text();
    expect(html).toContain("This window will remain open");
    expect(html).not.toContain("setTimeout(() => window.close(), 1000)");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("does not close an OAuth-provider error response", async () => {
    const response = await GET(
      callbackRequest(
        "error=invalid_request&error_description=requested%20resource%20invalid",
      ),
    );

    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain("requested resource invalid");
    expect(html).toContain("This window will remain open");
    expect(html).not.toContain("setTimeout(() => window.close(), 1000)");
    expect(mocks.getSessionByState).not.toHaveBeenCalled();
  });
});
