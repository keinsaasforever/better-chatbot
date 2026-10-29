import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { describe, expect, it } from "vitest";
import { isAccessTokenExpired, mergeOAuthTokens } from "./oauth-token-utils";

function jwtWithExpiry(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString(
    "base64url",
  );
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `${header}.${payload}.signature`;
}

describe("mergeOAuthTokens", () => {
  it("stores a rotated refresh token", () => {
    const merged = mergeOAuthTokens(
      {
        access_token: "old-access",
        token_type: "Bearer",
        refresh_token: "old-refresh",
      },
      {
        access_token: "new-access",
        token_type: "Bearer",
        refresh_token: "new-refresh",
      },
    );

    expect(merged.access_token).toBe("new-access");
    expect(merged.refresh_token).toBe("new-refresh");
  });

  it("preserves the existing refresh token when a provider omits it", () => {
    const merged = mergeOAuthTokens(
      {
        access_token: "old-access",
        token_type: "Bearer",
        refresh_token: "keep-refresh",
      },
      { access_token: "new-access", token_type: "Bearer" },
    );

    expect(merged.refresh_token).toBe("keep-refresh");
  });
});

describe("isAccessTokenExpired", () => {
  const nowMs = 2_000_000;

  it("uses the provider expires_at value when present", () => {
    const tokens = {
      access_token: "opaque",
      token_type: "Bearer",
      expires_at: 1_900,
    } as OAuthTokens;

    expect(isAccessTokenExpired(tokens, nowMs, 0)).toBe(true);
  });

  it("reads the JWT exp claim", () => {
    const tokens: OAuthTokens = {
      access_token: jwtWithExpiry(1_900),
      token_type: "Bearer",
    };

    expect(isAccessTokenExpired(tokens, nowMs, 0)).toBe(true);
  });

  it("does not guess an expiry for opaque tokens without expires_at", () => {
    const tokens: OAuthTokens = {
      access_token: "opaque",
      token_type: "Bearer",
    };

    expect(isAccessTokenExpired(tokens, nowMs, 0)).toBe(false);
  });
});
