import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";

export class StdioTransportNotSupportedError extends Error {
  constructor(message = "Stdio transport is not supported in this runtime") {
    super(message);
    this.name = "StdioTransportNotSupportedError";
  }
}

export class OAuthAuthorizationRequiredError extends Error {
  constructor(public authorizationUrl: URL) {
    super("OAuth user authorization required");
    this.name = "OAuthAuthorizationRequiredError";
  }
}

export function isUnauthorized(error: unknown): boolean {
  const err = error as {
    status?: number;
    code?: number;
    message?: string;
  };
  const message = err?.message ?? "";
  return (
    error instanceof UnauthorizedError ||
    err?.status === 401 ||
    err?.code === 401 ||
    message.includes("401") ||
    message.includes("Unauthorized") ||
    message.includes("invalid_token") ||
    message.includes("HTTP 401") ||
    message.includes("Authentication required")
  );
}

export function isOAuthAuthorizationRequired(
  error: unknown,
): error is OAuthAuthorizationRequiredError {
  return error instanceof OAuthAuthorizationRequiredError;
}

type HttpLikeError = {
  status?: number;
  code?: number;
  message?: string;
};

export function isMcpSessionNotFound(error: unknown): boolean {
  const err = error as HttpLikeError;
  const message = err?.message?.toLowerCase() ?? "";

  return message.includes("session not found");
}

/**
 * Legacy HTTP+SSE fallback is only appropriate when the initial Streamable
 * HTTP endpoint is unsupported. Authentication, network, and stale-session
 * errors should be surfaced or retried with a fresh Streamable HTTP client.
 */
export function shouldFallbackToSse(
  error: unknown,
  serverUrl?: string,
): boolean {
  if (isMcpSessionNotFound(error) || isUnauthorized(error)) return false;

  if (serverUrl) {
    try {
      const path = new URL(serverUrl).pathname.replace(/\/+$/, "");
      if (path.endsWith("/mcp")) return false;
    } catch {
      return false;
    }
  }

  const err = error as HttpLikeError;
  const status = err?.status ?? err?.code;
  const message = err?.message?.toLowerCase() ?? "";

  return (
    status === 404 ||
    status === 405 ||
    message.includes("method not allowed") ||
    message.includes("http 405")
  );
}

export async function retryMcpSessionOnce<T>(
  operation: () => Promise<T>,
  reset: () => Promise<void>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isMcpSessionNotFound(error)) throw error;
    await reset();
    return operation();
  }
}
