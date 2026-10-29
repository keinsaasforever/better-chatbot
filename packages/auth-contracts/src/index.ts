import { z } from "zod";

export const SignedJobPayloadSchema = z.object({
  jti: z.string().uuid(),
  sub: z.string(),
  channel: z.enum(["whatsapp", "telegram", "web", "desktop"]),
  intent: z.string(),
  payload: z.record(z.string(), z.unknown()),
  exp: z.number().int(),
  iat: z.number().int(),
  nonce: z.string(),
});

export type SignedJobPayload = z.infer<typeof SignedJobPayloadSchema>;

export const DeviceIdentitySchema = z.object({
  deviceId: z.string().uuid(),
  userId: z.string(),
  platform: z.enum(["win32", "darwin", "linux"]),
  publicKey: z.string().optional(),
  rotatedAt: z.string().datetime().optional(),
});

export type DeviceIdentity = z.infer<typeof DeviceIdentitySchema>;

export function parseSignedJobPayload(input: unknown): SignedJobPayload {
  return SignedJobPayloadSchema.parse(input);
}

export function isSignedJobExpired(
  payload: SignedJobPayload,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  return payload.exp <= nowSeconds;
}
