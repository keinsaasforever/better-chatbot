import { withAuth } from "auth/route-guard";
import globalLogger from "logger";
import { NextResponse } from "next/server";
import { VoiceSessionThreadRequestSchema } from "lib/voice/schemas";
import { persistVoiceSessionTurns } from "lib/voice/session-thread";

const logger = globalLogger.withDefaults({ message: "Voice Thread: " });

/**
 * File a batch of completed voice turns into the session's chat thread.
 *
 * Called repeatedly while the conversation runs, not once at the end: a web
 * search's source links are only useful if the user can open them while they
 * are still talking about them.
 */
export const POST = withAuth(async (request, session) => {
  let body: ReturnType<typeof VoiceSessionThreadRequestSchema.parse>;
  try {
    body = VoiceSessionThreadRequestSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const organizationId =
    (session.session as { activeOrganizationId?: string } | undefined)
      ?.activeOrganizationId ?? null;

  try {
    const result = await persistVoiceSessionTurns({
      actor: {
        userId: session.user.id,
        organizationId,
        source: "browser",
      },
      request: body,
      // Generic on purpose: this only names threads whose batch carried no
      // user speech, which in practice means the model spoke first.
      fallbackTitle: "Voice conversation",
    });

    if (!result.ok) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json(result);
  } catch (error) {
    // Generic body, detail server-side: this is a background write the user
    // never sees fail, and its message could carry thread content.
    logger.error(
      "Failed to persist voice session turns",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
});
