import { McpToolCustomizationZodSchema } from "app-types/mcp";
import { withAuth } from "auth/route-guard";
import { serverCache } from "lib/cache";
import { CacheKeys } from "lib/cache/cache-keys";
import { mcpMcpToolCustomizationRepository } from "lib/db/repository";

export const GET = withAuth(
  async (
    _request,
    session,
    { params }: { params: Promise<{ server: string; tool: string }> },
  ) => {
    const { server, tool } = await params;

    const result = await mcpMcpToolCustomizationRepository.select({
      mcpServerId: server,
      userId: session.user.id,
      toolName: tool,
    });
    return Response.json(result ?? {});
  },
);

export const POST = withAuth(
  async (
    request,
    session,
    { params }: { params: Promise<{ server: string; tool: string }> },
  ) => {
    const { server, tool } = await params;

    const body = await request.json();

    const { mcpServerId, toolName, prompt } =
      McpToolCustomizationZodSchema.parse({
        ...body,
        mcpServerId: server,
        toolName: tool,
      });

    const result =
      await mcpMcpToolCustomizationRepository.upsertToolCustomization({
        userId: session.user.id,
        mcpServerId,
        toolName,
        prompt,
      });
    const key = CacheKeys.mcpServerCustomizations(session.user.id);
    void serverCache.delete(key);

    return Response.json(result);
  },
);

export const DELETE = withAuth(
  async (
    _request,
    session,
    { params }: { params: Promise<{ server: string; tool: string }> },
  ) => {
    const { server, tool } = await params;

    await mcpMcpToolCustomizationRepository.deleteToolCustomization({
      mcpServerId: server,
      userId: session.user.id,
      toolName: tool,
    });
    const key = CacheKeys.mcpServerCustomizations(session.user.id);
    void serverCache.delete(key);

    return Response.json({ success: true });
  },
);
