import "server-only";
import { generateObject } from "ai";
import { z } from "zod";
import { getModelInstance } from "@/lib/ai/models";
import type { AuthenticatedVoiceDevice } from "./device-auth";
import { aiTelemetry } from "lib/ai/telemetry";

/** Navigator base model, by alias so a base-model swap carries here. */
const LONG_CAPTURE_MODEL = {
  provider: "Navigator",
  model: "Base model",
} as const;

export const LongVoiceCaptureAnalysisSchema = z.object({
  title: z.string().max(120),
  summary: z.string(),
  actionItems: z
    .array(
      z.object({
        text: z.string(),
        owner: z.string().nullable().default(null),
        dueDate: z.string().nullable().default(null),
      }),
    )
    .default([]),
  decisions: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
  suggestedTarget: z
    .enum(["project_note", "voice_inbox", "chat_thread", "workflow_draft"])
    .default("voice_inbox"),
  projectName: z.string().nullable().default(null),
});

export type LongVoiceCaptureAnalysis = z.infer<
  typeof LongVoiceCaptureAnalysisSchema
>;

export async function analyzeLongVoiceCapture(input: {
  actor: AuthenticatedVoiceDevice;
  voiceSessionId: string;
  transcriptText: string;
}): Promise<LongVoiceCaptureAnalysis> {
  const model = await getModelInstance(LONG_CAPTURE_MODEL, input.actor.userId);
  const { object } = await generateObject({
    model,
    experimental_telemetry: aiTelemetry("voice.capture.analyze"),
    schema: LongVoiceCaptureAnalysisSchema,
    system: `You analyze a long voice capture. Summarize faithfully, extract action items and decisions, and suggest where it should be stored. Do not execute external tools.`,
    messages: [
      {
        role: "user",
        content: `Voice session: ${input.voiceSessionId}\n\nTranscript:\n${input.transcriptText}`,
      },
    ],
  });

  return object;
}
