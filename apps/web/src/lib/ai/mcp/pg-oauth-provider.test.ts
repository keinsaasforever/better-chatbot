import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { McpOAuthRepository, McpOAuthSession } from "app-types/mcp";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("lib/logger", () => ({
  default: {
    withDefaults: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));
vi.mock("consola/utils", () => ({
  colorize: (_style: string, text: string) => text,
}));
vi.mock("lib/utils", () => ({ generateUUID: () => "generated-state" }));

const { registerClient } = vi.hoisted(() => ({ registerClient: vi.fn() }));
vi.mock("@modelcontextprotocol/sdk/client/auth.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@modelcontextprotocol/sdk/client/auth.js")
  >()),
  registerClient,
}));

import type { OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import { MCP_OAUTH_FALLBACK_SCOPE, MCP_OAUTH_SCOPE } from "lib/const";
import { PgOAuthClientProvider } from "./pg-oauth-provider";

const expiredTokens = {
  access_token: "expired-access",
  token_type: "Bearer",
  refresh_token: "old-refresh",
  expires_at: 1,
} as OAuthTokens;

const freshTokens = {
  access_token: "fresh-access",
  token_type: "Bearer",
  refresh_token: "new-refresh",
  expires_at: 4_000_000_000,
} as OAuthTokens;

function session(tokens: OAuthTokens | null): McpOAuthSession {
  return {
    id: "session-id",
    mcpServerId: "server-id",
    serverUrl: "https://mcp.example.com/mcp",
    state: "oauth-state",
    tokens,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function createRepository(initialTokens: OAuthTokens | null) {
  let storedSession = session(initialTokens);
  let lockHeld = false;
  const waiters: Array<() => void> = [];

  const acquireRefreshLock = vi.fn(async () => {
    if (lockHeld) {
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
    lockHeld = true;
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      lockHeld = false;
      waiters.shift()?.();
    };
  });

  const repository: McpOAuthRepository = {
    getAuthenticatedSession: vi.fn(async () => storedSession),
    getSessionByState: vi.fn(async () => storedSession),
    createSession: vi.fn(async () => storedSession),
    updateSessionByState: vi.fn(async (_state, data) => {
      storedSession = { ...storedSession, ...data };
      return storedSession;
    }),
    saveTokensAndCleanup: vi.fn(async (_state, _serverId, data) => {
      storedSession = { ...storedSession, ...data };
      return storedSession;
    }),
    clearTokens: vi.fn(async () => {
      storedSession = { ...storedSession, tokens: null };
      return storedSession;
    }),
    acquireRefreshLock,
    deleteByState: vi.fn(async () => undefined),
  };

  return { repository, getStoredSession: () => storedSession };
}

function createProvider(repository: McpOAuthRepository, scope?: string) {
  return new PgOAuthClientProvider(
    {
      name: "test",
      mcpServerId: "server-id",
      serverUrl: "https://mcp.example.com/mcp",
      _clientMetadata: {
        client_name: "test",
        redirect_uris: ["https://navigator.example.com/oauth/callback"],
        scope,
      },
      onRedirectToAuthorization: vi.fn(),
    },
    repository,
  );
}

describe("PgOAuthClientProvider token recovery", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists SQL-null token invalidation through the explicit repository method", async () => {
    const { repository, getStoredSession } = createRepository(freshTokens);
    const provider = createProvider(repository);

    await provider.tokens();
    await provider.invalidateCredentials("tokens");

    expect(repository.clearTokens).toHaveBeenCalledWith("oauth-state");
    expect(getStoredSession().tokens).toBeNull();
  });

  it("atomically stores a rotated refresh token and releases the lock", async () => {
    const { repository, getStoredSession } = createRepository(expiredTokens);
    const provider = createProvider(repository);

    expect((await provider.tokens())?.access_token).toBe("expired-access");
    await provider.saveTokens(freshTokens);

    expect(getStoredSession().tokens?.refresh_token).toBe("new-refresh");
    expect(repository.saveTokensAndCleanup).toHaveBeenCalledTimes(1);
  });

  it("drops a token-bearing session whose registration points at a stale redirect URI", async () => {
    const { repository, getStoredSession } = createRepository(freshTokens);
    // Domain-move simulation: tokens are still present, but the stored dynamic
    // client registration points at the previous callback host.
    getStoredSession().clientInfo = {
      client_id: "stale-client",
      redirect_uris: ["https://old-domain.example.com/oauth/callback"],
    };

    const provider = createProvider(repository);
    const info = await provider.clientInformation();

    expect(info).toBeUndefined();
    expect(repository.deleteByState).toHaveBeenCalledWith("oauth-state");
  });

  it("serializes concurrent refreshes and reuses the token stored by the winner", async () => {
    const { repository } = createRepository(expiredTokens);
    const first = createProvider(repository);
    const second = createProvider(repository);

    const firstTokens = await first.tokens();
    const waitingTokens = second.tokens();
    await Promise.resolve();

    expect(firstTokens?.access_token).toBe("expired-access");
    await first.saveTokens(freshTokens);

    expect((await waitingTokens)?.access_token).toBe("fresh-access");
    expect(repository.acquireRefreshLock).toHaveBeenCalledTimes(2);
    expect(repository.saveTokensAndCleanup).toHaveBeenCalledTimes(1);
  });
});

describe("PgOAuthClientProvider scope fallback", () => {
  const redirectUris = ["https://navigator.example.com/oauth/callback"];

  function discovery(scopesSupported?: string[]): OAuthDiscoveryState {
    return {
      authorizationServerUrl: "https://auth.example.com",
      authorizationServerMetadata: {
        issuer: "https://auth.example.com",
        authorization_endpoint: "https://auth.example.com/authorize",
        token_endpoint: "https://auth.example.com/token",
        registration_endpoint: "https://auth.example.com/register",
        response_types_supported: ["code"],
        scopes_supported: scopesSupported,
      },
    };
  }

  function registeredScopes() {
    return registerClient.mock.calls.map(
      ([, options]) => options.clientMetadata.scope,
    );
  }

  beforeEach(() => {
    registerClient.mockReset();
  });

  it("registers with the full scope when the server accepts it", async () => {
    const { repository, getStoredSession } = createRepository(null);
    registerClient.mockResolvedValue({
      client_id: "client",
      redirect_uris: redirectUris,
    });
    const provider = createProvider(repository, MCP_OAUTH_SCOPE);

    await provider.saveDiscoveryState(discovery());

    expect(registeredScopes()).toEqual([MCP_OAUTH_SCOPE]);
    expect(getStoredSession().clientInfo?.scope).toBe(MCP_OAUTH_SCOPE);
    expect(provider.clientMetadata.scope).toBe(MCP_OAUTH_SCOPE);
  });

  it("retries without mcp:tools when registration is rejected", async () => {
    const { repository, getStoredSession } = createRepository(null);
    registerClient
      .mockRejectedValueOnce(new Error("HTTP 400: invalid scope mcp:tools"))
      .mockResolvedValueOnce({
        client_id: "client",
        redirect_uris: redirectUris,
      });
    const provider = createProvider(repository, MCP_OAUTH_SCOPE);

    await provider.saveDiscoveryState(discovery());

    expect(registeredScopes()).toEqual([
      MCP_OAUTH_SCOPE,
      MCP_OAUTH_FALLBACK_SCOPE,
    ]);
    expect(getStoredSession().clientInfo?.scope).toBe(MCP_OAUTH_FALLBACK_SCOPE);
    expect(provider.clientMetadata.scope).toBe(MCP_OAUTH_FALLBACK_SCOPE);
  });

  it("skips mcp:tools up front when the server does not list it", async () => {
    const { repository } = createRepository(null);
    registerClient.mockResolvedValue({
      client_id: "client",
      redirect_uris: redirectUris,
    });
    const provider = createProvider(repository, MCP_OAUTH_SCOPE);

    await provider.saveDiscoveryState(
      discovery(["openid", "profile", "email", "offline_access"]),
    );

    expect(registeredScopes()).toEqual([MCP_OAUTH_FALLBACK_SCOPE]);
  });

  it("rethrows the original error when the fallback also fails", async () => {
    const { repository } = createRepository(null);
    const original = new Error("registration disabled");
    registerClient
      .mockRejectedValueOnce(original)
      .mockRejectedValueOnce(new Error("still failing"));
    const provider = createProvider(repository, MCP_OAUTH_SCOPE);

    await expect(provider.saveDiscoveryState(discovery())).rejects.toBe(
      original,
    );
    expect(provider.clientMetadata.scope).toBe(MCP_OAUTH_SCOPE);
  });

  it("reuses a stored fallback registration and requests its scope", async () => {
    const { repository, getStoredSession } = createRepository(null);
    getStoredSession().clientInfo = {
      client_id: "client",
      redirect_uris: redirectUris,
      scope: MCP_OAUTH_FALLBACK_SCOPE,
    };
    const provider = createProvider(repository, MCP_OAUTH_SCOPE);

    await provider.saveDiscoveryState(discovery());

    expect(registerClient).not.toHaveBeenCalled();
    expect(provider.clientMetadata.scope).toBe(MCP_OAUTH_FALLBACK_SCOPE);
  });
});
