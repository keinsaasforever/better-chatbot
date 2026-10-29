import { withAuth } from "auth/route-guard";
import { mcpMcpToolCustomizationRepository } from "lib/db/repository";

import { NextResponse } from "next/server";

export const GET = withAuth(
  async (
    _request,
    session,
    { params }: { params: Promise<{ server: string }> },
  ) => {
    const { server } = await params;
    const mcpServerCustomization =
      await mcpMcpToolCustomizationRepository.selectByUserIdAndMcpServerId({
        mcpServerId: server,
        userId: session.user.id,
      });

    return NextResponse.json(mcpServerCustomization);
  },
);
