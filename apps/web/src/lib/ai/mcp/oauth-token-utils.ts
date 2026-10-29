import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

type OAuthTokensWithExpiry = OAuthTokens & { expires_at?: number };

export function mergeOAuthTokens(
  current: OAuthTokens | null | undefined,
  next: OAuthTokens,
): OAuthTokens {
  return {
    ...current,
    ...next,
    refresh_token: next.refresh_token ?? current?.refresh_token,
  };
}

export function isAccessTokenExpired(
  tokens: OAuthTokens,
  nowMs = Date.now(),
  clockSkewSeconds = 30,
): boolean {
  const explicitExpiry = (tokens as OAuthTokensWithExpiry).expires_at;
  if (typeof explicitExpiry === "number") {
    return explicitExpiry <= Math.floor(nowMs / 1000) + clockSkewSeconds;
  }

  const segments = tokens.access_token.split(".");
  if (segments.length !== 3) return false;

  try {
    const payload = JSON.parse(
      Buffer.from(segments[1], "base64url").toString("utf8"),
    ) as { exp?: unknown };
    return (
      typeof payload.exp === "number" &&
      payload.exp <= Math.floor(nowMs / 1000) + clockSkewSeconds
    );
  } catch {
    return false;
  }
}
