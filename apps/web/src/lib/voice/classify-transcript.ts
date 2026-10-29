import "server-only";
import { generateObject } from "ai";
import { z } from "zod";
import { getModelInstance } from "@/lib/ai/models";
import type { ProjectRef } from "./project-resolver";
import { aiTelemetry } from "lib/ai/telemetry";

/** Navigator base model, by alias so a base-model swap carries here. */
const VOICE_CLASSIFY_MODEL = {
  provider: "Navigator",
  model: "Base model",
} as const;

export const TranscriptIntentSchema = z.enum([
  "task",
  "workflow",
  "agent",
  "scheduled_agent",
  "note",
  "question",
]);
export type TranscriptIntent = z.infer<typeof TranscriptIntentSchema>;

export const TranscriptClassificationSchema = z.object({
  intent: TranscriptIntentSchema,
  /** Best-matching project name from the supplied list, or null. */
  projectName: z.string().nullable().default(null),
  /** Short human title for the chat/draft/note (<= 8 words). */
  title: z.string().default(""),
  rationale: z.string().optional(),
  agent: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      role: z.string().optional(),
      systemPrompt: z.string().optional(),
      suggestedTools: z.array(z.string()).optional().default([]),
    })
    .nullish(),
  schedule: z
    .object({
      cronExpression: z.string().optional(),
      timezone: z.string().optional(),
      inputPrompt: z.string().optional(),
      humanDescription: z.string().optional(),
    })
    .nullish(),
});
export type TranscriptClassification = z.infer<
  typeof TranscriptClassificationSchema
>;

const SYSTEM_PROMPT = `You classify a short spoken transcript captured from a voice device into exactly one intent:

- "task": an actionable request to do right now (e.g. "research company XYZ", "send an email to Anna", "what's the weather"). Tasks run in a normal chat with ALL of the user's tools and are NOT bound to a project.
- "workflow": the user is describing a deterministic multi-step automation or process they want built, usually workflow-builder/n8n style.
- "agent": the user wants an autonomous assistant with role, instructions, tools, monitoring, research, follow-up, or natural-language decision making.
- "scheduled_agent": the user wants an agent that runs on a schedule or recurring cadence (e.g. every morning, weekly, daily at 9, monitor leads).
- "note": information to remember or save for later that belongs to a project (e.g. "remember that the client prefers email over calls").
- "question": a direct question to answer now.

A request that says "create a workflow" is not necessarily a workflow. If the user describes an assistant that monitors, decides, researches, follows up, or runs repeatedly, classify as "agent" or "scheduled_agent".
If scheduled_agent, produce a cron expression only when the schedule is explicit. If the schedule is ambiguous, set schedule.humanDescription and leave cronExpression empty.
Also choose the single best-matching project NAME from the list ONLY if the transcript clearly refers to one; otherwise return null. Never invent a project name that is not in the list.

Provide a concise title (max 8 words) describing the transcript.`;

export async function classifyTranscript(input: {
  userId: string;
  text: string;
  projects: ProjectRef[];
}): Promise<TranscriptClassification> {
  const model = await getModelInstance(VOICE_CLASSIFY_MODEL, input.userId);

  const projectList =
    input.projects.length > 0
      ? input.projects
          .map(
            (p) =>
              `- ${p.name}${p.description ? `: ${p.description.slice(0, 120)}` : ""}`,
          )
          .join("\n")
      : "(the user has no projects yet)";

  const { object } = await generateObject({
    model,
    experimental_telemetry: aiTelemetry("voice.transcript.classify"),
    schema: TranscriptClassificationSchema,
    system: `${SYSTEM_PROMPT}\n\nProjects:\n${projectList}`,
    messages: [{ role: "user", content: input.text }],
  });

  return object;
}
