import { describe, expect, it } from "vitest";
import { isSignedJobExpired, parseSignedJobPayload } from "./index";

describe("auth-contracts", () => {
  it("parses signed job payloads", () => {
    const payload = parseSignedJobPayload({
      jti: "550e8400-e29b-41d4-a716-446655440000",
      sub: "user-1",
      channel: "telegram",
      intent: "chat.reply",
      payload: { text: "hello" },
      exp: 4102444800,
      iat: 1700000000,
      nonce: "abc",
    });
    expect(payload.channel).toBe("telegram");
    expect(isSignedJobExpired(payload)).toBe(false);
  });
});
