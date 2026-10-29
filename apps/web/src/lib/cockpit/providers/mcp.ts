import "server-only";

import {
  OAuthAuthorizationRequiredError,
  buildStreamableHttpTransport,
} from "@keinsaas/mcp-router";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { createEphemeralMCPClient } from "lib/ai/mcp/ephemeral-client";
import { serverCache } from "lib/cache";
import { mcpOAuthRepository } from "lib/db/repository";
import { httpReason, reason } from "../reasons";
import { toReason } from "./http";

/**
 * Minimal MCP client for cockpit feeds (Superlog, SEO). Remote Streamable
 * HTTP only, static auth headers, one short-lived session per refresh; or a
 * session over an MCP server connected in Navigator, for servers that only
 * sign in with OAuth (`withServerSession`).
 *
 * Tool argument shapes of third-party servers are not guaranteed, so tools
 * are introspected (`tools/list`, cached per connection version) and every
 * call only passes arguments the tool's input schema declares.
 */

export type McpToolInfo = {
  name: string;
  properties: Record<
    string,
    { type?: string; default?: unknown; enum?: unknown[] }
  >;
  required: string[];
};

export class McpToolMissingError extends Error {
  constructor(public readonly tool: string) {
    super(`MCP tool missing: ${tool}`);
    this.name = "McpToolMissingError";
  }
  get reason() {
    return reason("toolMissing", this.tool);
  }
}

/** The picked Navigator MCP server is gone, disabled or out of scope. */
export class McpServerMissingError extends Error {
  constructor() {
    super("MCP server not available");
    this.name = "McpServerMissingError";
  }
}

export type McpSession = {
  tools: McpToolInfo[];
  /** First tool whose name matches, in pattern order. */
  find(...patterns: Array<string | RegExp>): McpToolInfo | null;
  /** Calls a tool with only the arguments its schema accepts. */
  call(tool: McpToolInfo, args: Record<string, unknown>): Promise<unknown>;
};

const TOOLS_TTL_MS = 10 * 60_000;

export function pickArgs(
  tool: McpToolInfo,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined && key in tool.properties) out[key] = value;
  }
  return out;
}

/** Parses a tool result: structured content first, then JSON text parts. */
export function parseToolResult(result: unknown): unknown {
  const r = result as {
    isError?: boolean;
    structuredContent?: unknown;
    content?: Array<{ type: string; text?: string }>;
  };
  if (r?.isError) throw new Error("mcp tool returned an error");
  if (r?.structuredContent !== undefined) return r.structuredContent;
  const texts = (r?.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string);
  if (!texts.length) return null;
  try {
    return JSON.parse(texts.join(""));
  } catch {
    return texts.join("\n");
  }
}

/** Rejects once the signal fires, for racing calls that ignore it. */
function abortion(signal: AbortSignal): Promise<never> {
  const aborted = new Promise<never>((_, reject) => {
    const fail = () => reject(new Error("cockpit-deadline"));
    if (signal.aborted) fail();
    signal.addEventListener("abort", fail, { once: true });
  });
  // Keep the race's losing side from surfacing as an unhandled rejection.
  aborted.catch(() => null);
  return aborted;
}

function toToolInfo(tool: {
  name: string;
  inputSchema?: { properties?: unknown; required?: unknown };
}): McpToolInfo {
  return {
    name: tool.name,
    properties: (tool.inputSchema?.properties ??
      {}) as McpToolInfo["properties"],
    required: (tool.inputSchema?.required ?? []) as string[],
  };
}

function sessionOver(
  list: McpToolInfo[],
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
): McpSession {
  return {
    tools: list,
    find(...patterns) {
      for (const p of patterns) {
        const hit = list.find((t) =>
          typeof p === "string" ? t.name === p : p.test(t.name),
        );
        if (hit) return hit;
      }
      return null;
    },
    async call(tool, args) {
      return parseToolResult(await callTool(tool.name, pickArgs(tool, args)));
    },
  };
}

export async function withMcpSession<T>(
  opts: {
    url: string;
    headers: Record<string, string>;
    signal: AbortSignal;
    /** Cache key for the tool list; omit to always introspect. */
    toolsCacheKey?: string;
  },
  run: (session: McpSession) => Promise<T>,
): Promise<T> {
  const client = new Client({
    name: "keinsaas-navigator-cockpit",
    version: "1.0.0",
  });
  const transport = buildStreamableHttpTransport(
    { url: opts.url, headers: opts.headers },
    { signal: opts.signal },
  );
  const aborted = abortion(opts.signal);

  try {
    await Promise.race([client.connect(transport), aborted]);

    let tools = opts.toolsCacheKey
      ? await serverCache.get<McpToolInfo[]>(opts.toolsCacheKey)
      : undefined;
    if (!tools) {
      const listed = await Promise.race([client.listTools(), aborted]);
      tools = listed.tools.map(toToolInfo);
      if (opts.toolsCacheKey) {
        await serverCache.set(opts.toolsCacheKey, tools, TOOLS_TTL_MS);
      }
    }
    return await run(
      sessionOver(tools, (name, args) =>
        Promise.race([client.callTool({ name, arguments: args }), aborted]),
      ),
    );
  } finally {
    await client.close().catch(() => null);
  }
}

/**
 * A session over an MCP server connected in Navigator. Navigator's client
 * owns the server's OAuth session (stored tokens, refresh under a lock), so
 * a server that only signs in with OAuth works here. Access follows the MCP
 * server rule for the connection's owner: their own server, or one shared
 * in the connection's workspace.
 */
export async function withServerSession<T>(
  opts: {
    mcpServerId: string;
    scope: { userId: string; organizationId: string | null } | undefined;
    signal: AbortSignal;
  },
  run: (session: McpSession) => Promise<T>,
): Promise<T> {
  if (!opts.scope) throw new McpServerMissingError();
  const client = await createEphemeralMCPClient(
    opts.mcpServerId,
    opts.scope.userId,
    { organizationId: opts.scope.organizationId },
  );
  if (!client) throw new McpServerMissingError();
  // Same rule as /api/mcp/list: no connect before the server is authorized.
  // Connecting an unauthorized server opens a new pending OAuth session row,
  // one per refresh while the cockpit is open.
  const authorized = await mcpOAuthRepository.getAuthenticatedSession(
    opts.mcpServerId,
  );
  if (!authorized?.tokens) {
    throw new OAuthAuthorizationRequiredError(new URL("about:blank"));
  }
  const aborted = abortion(opts.signal);
  try {
    await Promise.race([client.connect(), aborted]);
    return await run(
      sessionOver(client.getToolInfo().map(toToolInfo), (name, args) =>
        Promise.race([client.callTool(name, args, opts.signal), aborted]),
      ),
    );
  } finally {
    await client.disconnect();
  }
}

/**
 * Reason for a failed MCP session, built from the error's type and status
 * only (never its message text, which can echo the server's response body).
 *
 * The SDK's StreamableHTTPError keeps the HTTP status on `code` and puts the
 * response body in the message, so the status must be read from `code`:
 * matching the message alone turned a rejected key (401) or a wrong URL (404)
 * into a generic "unreachable".
 */
export function mcpReason(error: unknown): string {
  if (error instanceof McpToolMissingError) return error.reason;
  if (error instanceof McpServerMissingError) return reason("mcpServerMissing");
  // Navigator's OAuth client found no usable token and needs a person to
  // authorize the server again.
  if (error instanceof OAuthAuthorizationRequiredError) {
    return reason("mcpAuthorize");
  }
  // JSON-RPC level: the server answered, but refused or failed the request.
  if (error instanceof McpError) {
    return error.code === ErrorCode.RequestTimeout
      ? reason("timeout")
      : reason("queryFailed");
  }
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "number") {
    if (code >= 400 && code < 600) return httpReason(code);
    // StreamableHTTPError(-1): the endpoint answered with something that is
    // not MCP (an HTML page, a redirect target), usually a wrong URL.
    if (code === -1) return reason("invalidResponse");
  }
  const message = error instanceof Error ? error.message : "";
  const status = /\b(401|403|404|429|5\d\d)\b/.exec(message)?.[1];
  if (status) return httpReason(Number(status));
  return toReason(error);
}

// --- Defensive readers for loosely shaped JSON ------------------------------

export function asArray(value: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    for (const key of keys) {
      const v = (value as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

export function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

export function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    value.trim() &&
    Number.isFinite(Number(value))
  )
    return Number(value);
  return null;
}

/** Depth-first search for the first numeric value under any of `keys`. */
export function findNumber(
  value: unknown,
  keys: string[],
  depth = 0,
): number | null {
  if (!value || typeof value !== "object" || depth > 8) return null;
  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  for (const [k, v] of entries) {
    if (keys.includes(k)) {
      const n = num(v);
      if (n !== null) return n;
    }
  }
  for (const [, v] of entries) {
    const n = findNumber(v, keys, depth + 1);
    if (n !== null) return n;
  }
  return null;
}

/** Depth-first search for the first array whose items satisfy `test`. */
export function findArray(
  value: unknown,
  test: (item: Record<string, unknown>) => boolean,
  depth = 0,
): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object" || depth > 8) return [];
  if (Array.isArray(value)) {
    const objects = value.filter(
      (v): v is Record<string, unknown> => !!v && typeof v === "object",
    );
    if (objects.length && objects.some(test)) return objects;
    for (const v of value) {
      const hit = findArray(v, test, depth + 1);
      if (hit.length) return hit;
    }
    return [];
  }
  for (const v of Object.values(value as Record<string, unknown>)) {
    const hit = findArray(v, test, depth + 1);
    if (hit.length) return hit;
  }
  return [];
}
