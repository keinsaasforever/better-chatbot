import { describe, expect, it } from "vitest";
import { normalizeTelegramUpdate } from "./index";

describe("channel-contracts", () => {
  it("normalizes telegram updates", () => {
    const message = normalizeTelegramUpdate({
      update_id: 1,
      message: {
        message_id: 42,
        from: { id: 99 },
        chat: { id: 100 },
        text: "hello",
        date: 1700000000,
      },
    });
    expect(message?.channel).toBe("telegram");
    expect(message?.text).toBe("hello");
  });
});
