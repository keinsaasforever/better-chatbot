import { composio } from "lib/composio/client";
import { withAuth } from "auth/route-guard";
import { NextResponse } from "next/server";

export const POST = withAuth(async (req, _session) => {
  try {
    const { connectedAccountId }: { connectedAccountId: string } =
      await req.json();
    await composio.connectedAccounts.delete(connectedAccountId);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to disconnect" },
      { status: 500 },
    );
  }
});
