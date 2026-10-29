import {
  MCP_DEVICE_EXECUTION_REQUIRED,
  MCP_INTROSPECT_TIMEOUT,
  McpDeviceExecutionRequiredError,
} from "@keinsaas/mcp-router";
import { SpanStatusCode } from "@opentelemetry/api";
import { colorize } from "consola/utils";
import { createEphemeralMCPClient } from "lib/ai/mcp/ephemeral-client";
import { appTracer, mcpToolListLookups } from "lib/observability/instruments";
import { withAuth } from "auth/route-guard";
import globalLogger from "logger";
import { NextResponse } from "next/server";

const logger = globalLogger.withDefaults({
  message: colorize("magenta", "[MCP RPC List Tools]: "),
});

export const GET = withAuth(async (request, session) => {
  let client: Awaited<ReturnType<typeof createEphemeralMCPClient>> = null;

  const span = appTracer.startSpan("mcp.tools.list");
  try {
    const searchParams = request.nextUrl.searchParams;
    const mcpServerId = searchParams.get("serverId");

    if (!mcpServerId) {
      mcpToolListLookups.add(1, { outcome: "invalid_request" });
      span.setStatus({ code: SpanStatusCode.ERROR });
      return NextResponse.json(
        { error: "serverId query parameter required" },
        { status: 400 },
      );
    }

    span.setAttribute("mcp.server.id", mcpServerId);
    logger.info(`Listing tools for server ${mcpServerId.slice(0, 8)}`);

    // Create ephemeral client
    client = await createEphemeralMCPClient(mcpServerId, session.user.id);

    if (!client) {
      mcpToolListLookups.add(1, { outcome: "server_unavailable" });
      span.setStatus({ code: SpanStatusCode.ERROR });
      return NextResponse.json(
        { tools: [], error: "Server not found" },
        { status: 404 },
      );
    }

    // Connect performs initialization and tool discovery for this ephemeral
    // client. Reading toolInfo before connecting always returns an empty list.
    // Use the short introspection timeout so an unreachable server fails fast
    // instead of holding the request for the 30s default.
    await client.connect(MCP_INTROSPECT_TIMEOUT);
    const tools = client.getToolInfo();
    span.setAttribute("mcp.tools.count", tools.length);
    mcpToolListLookups.add(1, { outcome: "success" });

    return NextResponse.json({ tools });
  } catch (error: any) {
    // This route degrades gracefully to a 200 with an empty tool list, so the
    // failure is invisible to the caller. The counter is the only signal that
    // an MCP server has silently stopped exposing its tools.
    mcpToolListLookups.add(1, {
      outcome: "error",
      errorName: error?.name ?? "ERROR",
    });
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR });
    logger.error("List tools failed:", error);
    if (error instanceof McpDeviceExecutionRequiredError) {
      return NextResponse.json(
        {
          tools: [],
          error: error.message,
          code: MCP_DEVICE_EXECUTION_REQUIRED,
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        tools: [],
        error: error.message || "Failed to list tools",
      },
      { status: 200 }, // Graceful degradation
    );
  } finally {
    span.end();
    await client?.disconnect();
  }
});

export const runtime = "nodejs";
export const maxDuration = 60; // 60s for Vercel Pro
