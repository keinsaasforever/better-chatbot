import {
  MCP_DEVICE_EXECUTION_REQUIRED,
  McpDeviceExecutionRequiredError,
} from "@keinsaas/mcp-router";
import { SpanStatusCode } from "@opentelemetry/api";
import { colorize } from "consola/utils";
import { createEphemeralMCPClient } from "lib/ai/mcp/ephemeral-client";
import {
  appTracer,
  mcpToolCallDuration,
  mcpToolCalls,
} from "lib/observability/instruments";
import { withAuth } from "auth/route-guard";
import globalLogger from "logger";
import { NextResponse } from "next/server";
import { z } from "zod";

const logger = globalLogger.withDefaults({
  message: colorize("magenta", "[MCP RPC Tool Call]: "),
});

const RequestSchema = z.object({
  mcpServerId: z.string().uuid(),
  toolName: z.string().min(1),
  params: z.any().optional(),
});

export const POST = withAuth(async (request, session) => {
  const startTime = Date.now();
  let client: Awaited<ReturnType<typeof createEphemeralMCPClient>> = null;
  // Tool name is a bounded, code-defined set per server; the server id is not,
  // so it goes on the span rather than the metric.
  let toolNameForMetrics = "unknown";

  const span = appTracer.startSpan("mcp.tool.call");
  try {
    // 2. Parse & Validate
    const body = await request.json();
    const parseResult = RequestSchema.safeParse(body);

    if (!parseResult.success) {
      mcpToolCalls.add(1, { outcome: "invalid_request" });
      span.setStatus({ code: SpanStatusCode.ERROR });
      return NextResponse.json(
        { error: "Invalid request body", details: parseResult.error.issues },
        { status: 400 },
      );
    }

    const { mcpServerId, toolName, params } = parseResult.data;
    toolNameForMetrics = toolName;
    span.setAttributes({
      "mcp.server.id": mcpServerId,
      "mcp.tool.name": toolName,
    });

    logger.info(`Tool call: ${toolName} on server ${mcpServerId.slice(0, 8)}`);

    // 3. Create ephemeral client (loads config from DB)
    client = await createEphemeralMCPClient(mcpServerId, session.user.id);

    if (!client) {
      mcpToolCalls.add(1, {
        outcome: "server_unavailable",
        tool: toolNameForMetrics,
      });
      span.setStatus({ code: SpanStatusCode.ERROR });
      return NextResponse.json(
        { error: "MCP server not found or disabled" },
        { status: 404 },
      );
    }

    // 4. Execute tool call
    const result = await client.callTool(toolName, params || {});

    const duration = Date.now() - startTime;
    mcpToolCalls.add(1, { outcome: "success", tool: toolNameForMetrics });
    mcpToolCallDuration.record(duration, { tool: toolNameForMetrics });
    logger.info(`Tool call completed in ${duration}ms`);

    return NextResponse.json(result);
  } catch (error: any) {
    const duration = Date.now() - startTime;
    mcpToolCalls.add(1, {
      outcome: "error",
      tool: toolNameForMetrics,
      errorName: error?.name ?? "ERROR",
    });
    mcpToolCallDuration.record(duration, { tool: toolNameForMetrics });
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR });
    logger.error(`Tool call failed after ${duration}ms:`, error);

    // Handle Zod validation errors
    if (error.name === "ZodError") {
      return NextResponse.json(
        { error: "Validation error", details: error.issues },
        { status: 400 },
      );
    }

    if (error instanceof McpDeviceExecutionRequiredError) {
      return NextResponse.json(
        {
          error: error.message,
          code: MCP_DEVICE_EXECUTION_REQUIRED,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        isError: true,
        error: {
          message: error.message || "Tool call failed",
          name: error.name || "ERROR",
        },
        content: [],
      },
      { status: 500 },
    );
  } finally {
    span.end();
    await client?.disconnect();
  }
});

// Runtime configuration (Vercel-specific)
export const runtime = "nodejs"; // Required for MCP SDK (uses Node.js APIs)
export const maxDuration = 60; // 60s max (Vercel Pro/Enterprise)
// Note: Free tier is limited to 10s, Hobby to 10s, Pro to 60s, Enterprise to 900s
