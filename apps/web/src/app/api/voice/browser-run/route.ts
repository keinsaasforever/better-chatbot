import { withAuth } from "auth/route-guard";
import { colorize } from "consola/utils";
import { assertCreditsAvailable, requireBillingContext } from "@/lib/gate";
import globalLogger from "logger";
import {
  encodeVoiceBrowserFrame,
  VOICE_BROWSER_STREAM_CONTENT_TYPE,
  type VoiceBrowserFrame,
} from "lib/voice/browser-run-contract";
import { resolveVoiceBrowserSuppression } from "lib/voice/browser-gate";
import { runVoiceBrowserTask } from "lib/voice/browser-run";
import { VoiceBrowserRunRequestSchema } from "lib/voice/schemas";

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", "Voice Browser: "),
});

/**
 * Long enough for a real browsing run plus teardown. The run itself is capped
 * at `VOICE_BROWSER_MAX_RUN_MS` (3 min) from inside, so this is the backstop,
 * not the budget. If the platform kills the function anyway the stream ends
 * without a terminal frame, which the client already treats as a failure.
 */
export const maxDuration = 300;

/**
 * Stream a browser run to the voice client.
 *
 * Unlike `/api/voice/tool` this streams, because the FIRST thing the browser
 * tool produces is the live-view URL and the run then takes a minute or more.
 * The voice hook reads one frame, answers the model's function call so it can
 * speak, and keeps consuming in the background. See `browser-run-contract.ts`.
 */
export const POST = withAuth(async (request, session) => {
  const organizationId =
    (session.session as { activeOrganizationId?: string } | undefined)
      ?.activeOrganizationId ?? null;
  const actor = { userId: session.user.id, organizationId };

  let body: { task: string; callId: string; credentialAlias?: string };
  try {
    body = VoiceBrowserRunRequestSchema.parse(await request.json());
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  // Checked before the stream opens so a refusal is an ordinary JSON error the
  // hook can hand straight to the model, not a stream whose only frame is a
  // failure.
  const suppressedBy = await resolveVoiceBrowserSuppression(actor);
  if (suppressedBy) {
    logger.info(`browser run refused: ${suppressedBy}`);
    return Response.json(
      { error: "Browser automation is not available for this workspace." },
      { status: 403 },
    );
  }

  const billing = await requireBillingContext().catch(() => ({
    customerId: session.user.id as string | null,
    entityId: undefined as string | undefined,
  }));
  // `BillingContext.customerId` is nullable; the metering helpers take an
  // optional string and no-op without one. Same coercion the chat route does
  // before handing it to `createBrowserAutomationTool`.
  const customerId = billing.customerId ?? undefined;
  const entityId = billing.entityId;

  try {
    await assertCreditsAvailable({ customerId: billing.customerId, entityId });
  } catch {
    return Response.json(
      { error: "Not enough credits to start a browser." },
      { status: 402 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const write = (frame: VoiceBrowserFrame) =>
        controller.enqueue(encoder.encode(encodeVoiceBrowserFrame(frame)));
      try {
        for await (const frame of runVoiceBrowserTask({
          actor,
          task: body.task,
          callId: body.callId,
          credentialAlias: body.credentialAlias,
          customerId,
          entityId,
          // The user closing the voice drawer or hanging up aborts the request,
          // which has to reach the inner agent: its `finally` is what deletes
          // the browser and frees the concurrency slot.
          abortSignal: request.signal,
        })) {
          write(frame);
        }
      } catch (error) {
        // Never surface `error.message`: it can carry provider or page detail.
        logger.error(
          "browser run stream failed",
          error instanceof Error ? error.message : error,
        );
        try {
          write({ status: "failed", error: "The browser run stopped." });
        } catch {
          // The consumer is already gone; nothing to report to.
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": VOICE_BROWSER_STREAM_CONTENT_TYPE,
      "Cache-Control": "no-store",
      // Proxies that buffer would defeat the whole point: the live-view URL
      // has to reach the panel while the run is still going.
      "X-Accel-Buffering": "no",
    },
  });
});
