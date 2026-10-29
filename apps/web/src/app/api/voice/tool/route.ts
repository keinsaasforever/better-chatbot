import { withAuth } from "auth/route-guard";
import { colorize } from "consola/utils";
import { executeVoiceTool } from "lib/voice/execute-voice-tool";
import { VoiceToolRequestSchema } from "lib/voice/schemas";
import globalLogger from "logger";
import { NextResponse } from "next/server";

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", "Voice Tool: "),
});

export const POST = withAuth(async (request, session) => {
  try {
    const json = await request.json();
    const body = VoiceToolRequestSchema.parse(json);
    const organizationId =
      (session.session as { activeOrganizationId?: string } | undefined)
        ?.activeOrganizationId ?? null;

    logger.info(`Executing ${body.toolName}`);

    const result = await executeVoiceTool({
      actor: {
        userId: session.user.id,
        organizationId,
        source: "browser",
      },
      toolName: body.toolName,
      kind: body.kind,
      mcpServerId: body.mcpServerId,
      mcpToolName: body.mcpToolName,
      arguments: body.arguments,
      callId: body.callId,
    });

    logger.info(`${body.toolName} ${result.ok ? "completed" : "failed"}`);

    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error: any) {
    logger.error("Execution failed", error);
    return NextResponse.json(
      { error: error.message || "Failed to execute voice tool" },
      { status: 400 },
    );
  }
});
