import { withAuth } from "auth/route-guard";
import { NextResponse } from "next/server";
import { sendPushToUser } from "@/lib/push/send-push-to-user";
import { isWebPushConfigured } from "@/lib/push/web-push-client";

export const POST = withAuth(async (_request, session) => {
  try {
    if (!isWebPushConfigured()) {
      return NextResponse.json(
        { error: "Web Push is not configured on this server" },
        { status: 503 },
      );
    }

    const result = await sendPushToUser(session.user.id, {
      title: "Keinsaas Navigator",
      body: "Test notification — you're all set.",
      url: "/",
      kind: "test",
      tag: "test-notification",
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Failed to send test push:", error);
    return NextResponse.json(
      { error: "Failed to send test push" },
      { status: 500 },
    );
  }
});
