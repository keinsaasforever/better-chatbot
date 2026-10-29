import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  MCPRemoteConfigZodSchema,
  MCPStdioConfigZodSchema,
  type MCPServerConfig,
  isMaybeRemoteConfig,
  isMaybeStdioConfig,
} from "@keinsaas/mcp-types";
import { StdioTransportNotSupportedError } from "./transport-errors";

export type BuildStdioTransportOptions = {
  remoteOnly: boolean;
  cwd?: string;
  extraEnv?: Record<string, string | undefined>;
};

export type BuildRemoteTransportOptions = {
  authProvider?: OAuthClientProvider;
  signal?: AbortSignal;
};

/** Default connect timeout for ephemeral / serverless paths (ms). */
export const MCP_DEFAULT_CONNECT_TIMEOUT_MS = 30_000;

/** Default tool-call timeout for ephemeral paths (ms). */
export const MCP_DEFAULT_CALL_TIMEOUT_MS = 50_000;

/**
 * Connect timeout for tool introspection (list tools). Override with
 * MCP_INTROSPECT_TIMEOUT_MS.
 */
export const MCP_INTROSPECT_TIMEOUT = (() => {
  const n = Number(process.env.MCP_INTROSPECT_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 8000;
})();

export function assertStdioTransportAllowed(remoteOnly: boolean): void {
  if (remoteOnly) {
    throw new StdioTransportNotSupportedError(
      "VERCEL: Stdio transport is not supported",
    );
  }
}

export function buildStdioTransport(
  config: MCPServerConfig,
  options: BuildStdioTransportOptions,
): StdioClientTransport {
  assertStdioTransportAllowed(options.remoteOnly);

  const parsed = MCPStdioConfigZodSchema.parse(config);
  const env = Object.entries({
    ...process.env,
    ...parsed.env,
    ...options.extraEnv,
  }).reduce(
    (acc, [key, value]) => {
      if (value !== undefined) {
        acc[key] = value;
      }
      return acc;
    },
    {} as Record<string, string>,
  );

  return new StdioClientTransport({
    command: parsed.command,
    args: parsed.args,
    env,
    cwd: options.cwd ?? process.cwd(),
  });
}

export function buildStreamableHttpTransport(
  config: MCPServerConfig,
  options: BuildRemoteTransportOptions = {},
): StreamableHTTPClientTransport {
  const parsed = MCPRemoteConfigZodSchema.parse(config);
  const url = new URL(parsed.url);

  return new StreamableHTTPClientTransport(url, {
    requestInit: {
      headers: parsed.headers,
      signal: options.signal,
    },
    authProvider: options.authProvider,
  });
}

export function buildSseTransport(
  config: MCPServerConfig,
  options: BuildRemoteTransportOptions = {},
): SSEClientTransport {
  const parsed = MCPRemoteConfigZodSchema.parse(config);
  const url = new URL(parsed.url);

  return new SSEClientTransport(url, {
    requestInit: {
      headers: parsed.headers,
      signal: options.signal,
    },
    authProvider: options.authProvider,
  });
}

export type ConnectRemoteTransportResult = {
  transport: Transport;
  usedFallback: boolean;
};

/**
 * Try Streamable HTTP first, then SSE. Does not connect — callers invoke
 * `client.connect(transport)` themselves so they can handle OAuth retries.
 */
export function createRemoteTransportPair(
  config: MCPServerConfig,
  options: BuildRemoteTransportOptions = {},
): { primary: Transport; fallback: Transport } {
  if (!isMaybeRemoteConfig(config)) {
    throw new Error("Invalid remote MCP server config");
  }

  return {
    primary: buildStreamableHttpTransport(config, options),
    fallback: buildSseTransport(config, options),
  };
}

export function resolveTransportKind(
  config: MCPServerConfig,
): "stdio" | "remote" | "invalid" {
  if (isMaybeStdioConfig(config)) return "stdio";
  if (isMaybeRemoteConfig(config)) return "remote";
  return "invalid";
}
