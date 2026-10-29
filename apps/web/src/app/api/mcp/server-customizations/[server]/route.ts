import { McpServerCustomizationZodSchema } from "app-types/mcp";
import { withAuth } from "auth/route-guard";
import { serverCache } from "lib/cache";
import { CacheKeys } from "lib/cache/cache-keys";
import { mcpServerCustomizationRepository } from "lib/db/repository";

import { NextResponse } from "next/server";

export const GET = withAuth(
  async (
    _request,
    session,
    { params }: { params: Promise<{ server: string }> },
  ) => {
    const { server } = await params;
    const mcpServerCustomization =
      await mcpServerCustomizationRepository.selectByUserIdAndMcpServerId({
        mcpServerId: server,
        userId: session.user.id,
      });

    return NextResponse.json(mcpServerCustomization ?? {});
  },
);

export const POST = withAuth(
  async (
    request,
    session,
    { params }: { params: Promise<{ server: string }> },
  ) => {
    const { server } = await params;

    const body = await request.json();
    const { mcpServerId, prompt } = McpServerCustomizationZodSchema.parse({
      ...body,
      mcpServerId: server,
    });

    const result =
      await mcpServerCustomizationRepository.upsertMcpServerCustomization({
        userId: session.user.id,
        mcpServerId,
        prompt,
      });
    const key = CacheKeys.mcpServerCustomizations(session.user.id);
    void serverCache.delete(key);

    return NextResponse.json(result);
  },
);

export const DELETE = withAuth(
  async (
    _request,
    session,
    { params }: { params: Promise<{ server: string }> },
  ) => {
    const { server } = await params;

    await mcpServerCustomizationRepository.deleteMcpServerCustomizationByMcpServerIdAndUserId(
      {
        mcpServerId: server,
        userId: session.user.id,
      },
    );
    const key = CacheKeys.mcpServerCustomizations(session.user.id);
    void serverCache.delete(key);

    return NextResponse.json({ success: true });
  },
);
