import { withAuth } from "auth/route-guard";
import { NextResponse } from "next/server";
// import { saveMcpClientAction } from "./actions";
import {
  MCPRemoteConfigZodSchema,
  MCPStdioConfigZodSchema,
} from "app-types/mcp";
import { mcpRepository } from "lib/db/repository";
import { generateUUID } from "lib/utils";
import { z } from "zod";

const McpPostSchema = z.object({
  name: z.string().min(1),
  config: z.union([MCPRemoteConfigZodSchema, MCPStdioConfigZodSchema]),
  visibility: z.enum(["public", "private"]).optional(),
});

const McpPutSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  config: z.union([MCPRemoteConfigZodSchema, MCPStdioConfigZodSchema]),
  visibility: z.enum(["public", "private"]).optional(),
});

export const POST = withAuth(async (request, session) => {
  const parseResult = McpPostSchema.safeParse(await request.json());
  if (!parseResult.success) {
    return NextResponse.json(
      { error: parseResult.error.message },
      { status: 400 },
    );
  }

  const { name, config, visibility = "private" } = parseResult.data;
  const activeOrganizationId = (
    session.session as { activeOrganizationId?: string | null } | undefined
  )?.activeOrganizationId;

  // Check if name already exists for this user
  const existingServers = await mcpRepository.selectAllForUser(
    session.user.id,
    activeOrganizationId,
  );
  const existingServer = existingServers.find(
    (server) => server.name === name && server.userId === session.user.id,
  );
  if (existingServer) {
    return NextResponse.json(
      { error: "Name already exists", id: existingServer.id },
      { status: 400 },
    );
  }

  const id = generateUUID();

  try {
    await mcpRepository.insert({
      id,
      name,
      config,
      userId: session.user.id,
      organizationId: activeOrganizationId ?? null,
      visibility,
    });

    return NextResponse.json({ id });
  } catch (error) {
    console.error("Failed to save MCP server:", error);
    return NextResponse.json(
      { error: "Failed to save MCP server" },
      { status: 500 },
    );
  }
});

export const PUT = withAuth(async (request, session) => {
  const parseResult = McpPutSchema.safeParse(await request.json());
  if (!parseResult.success) {
    return NextResponse.json(
      { error: parseResult.error.message },
      { status: 400 },
    );
  }

  const { id, name, config, visibility = "private" } = parseResult.data;
  const activeOrganizationId = (
    session.session as { activeOrganizationId?: string | null } | undefined
  )?.activeOrganizationId;

  // Check if user has write access to this server
  const hasAccess = await mcpRepository.checkAccess(
    id,
    session.user.id,
    false,
    activeOrganizationId,
  );
  if (!hasAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // For updates, only check name conflicts with other servers (not the current one)
  const existingServers = await mcpRepository.selectAllForUser(
    session.user.id,
    activeOrganizationId,
  );
  if (
    existingServers.some(
      (server) =>
        server.name === name &&
        server.id !== id &&
        server.userId === session.user.id,
    )
  ) {
    return NextResponse.json({ error: "Name already exists" }, { status: 400 });
  }

  try {
    await mcpRepository.save({
      id,
      name,
      config,
      userId: session.user.id,
      visibility,
    });

    return NextResponse.json({ id });
  } catch (error) {
    console.error("Failed to update MCP server:", error);
    return NextResponse.json(
      { error: "Failed to update MCP server" },
      { status: 500 },
    );
  }
});
