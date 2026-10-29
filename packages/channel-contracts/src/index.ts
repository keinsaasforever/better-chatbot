import { z } from "zod";

export const ChannelTypeSchema = z.enum(["whatsapp", "telegram"]);

export type ChannelType = z.infer<typeof ChannelTypeSchema>;

export const NormalizedChannelMessageSchema = z.object({
  id: z.string(),
  channel: ChannelTypeSchema,
  direction: z.enum(["inbound", "outbound"]),
  senderId: z.string(),
  recipientId: z.string().optional(),
  text: z.string().optional(),
  mediaUrl: z.string().url().optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
  receivedAt: z.string().datetime(),
});

export type NormalizedChannelMessage = z.infer<
  typeof NormalizedChannelMessageSchema
>;

export const ChannelExecutionJobSchema = z.object({
  id: z.string().uuid(),
  userId: z.string(),
  channel: ChannelTypeSchema,
  messageId: z.string(),
  intent: z.string(),
  input: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});

export type ChannelExecutionJob = z.infer<typeof ChannelExecutionJobSchema>;

export function normalizeTelegramUpdate(update: {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number };
    chat?: { id: number };
    text?: string;
    date: number;
  };
}): NormalizedChannelMessage | null {
  const message = update.message;
  if (!message?.from || !message.chat) return null;

  return NormalizedChannelMessageSchema.parse({
    id: String(message.message_id),
    channel: "telegram",
    direction: "inbound",
    senderId: String(message.from.id),
    recipientId: String(message.chat.id),
    text: message.text,
    raw: update as Record<string, unknown>,
    receivedAt: new Date(message.date * 1000).toISOString(),
  });
}

export function normalizeWhatsAppWebhookEntry(entry: {
  id: string;
  from: string;
  timestamp: string;
  text?: { body?: string };
}): NormalizedChannelMessage {
  return NormalizedChannelMessageSchema.parse({
    id: entry.id,
    channel: "whatsapp",
    direction: "inbound",
    senderId: entry.from,
    text: entry.text?.body,
    raw: entry as Record<string, unknown>,
    receivedAt: new Date(Number(entry.timestamp) * 1000).toISOString(),
  });
}
