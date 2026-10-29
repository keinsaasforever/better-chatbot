import { describe, expect, it } from "vitest";
import { isCreditsExhaustedError } from "./credits-exhausted";

describe("isCreditsExhaustedError", () => {
  it("recognises the /api/chat body shape", () => {
    // `{ code, message, retryable }` — what route.ts returns with its 402,
    // handed to the client verbatim as `error.message`.
    expect(
      isCreditsExhaustedError(
        new Error(
          JSON.stringify({
            code: "CREDITS_EXHAUSTED",
            message: "You have used all the credits included in your plan.",
            retryable: false,
          }),
        ),
      ),
    ).toBe(true);
  });

  it("recognises the /api/chat/temporary and /api/agent/ai body shape", () => {
    // `{ error, code }` — the other shape. Only `code` is common to both,
    // which is why it is the field that gets read.
    expect(
      isCreditsExhaustedError(
        new Error(
          JSON.stringify({
            error: "Credits exhausted",
            code: "CREDITS_EXHAUSTED",
          }),
        ),
      ),
    ).toBe(true);
  });

  it("falls back to a substring test for a non-JSON body", () => {
    // A proxy error page or a truncated stream never parses; the code is
    // still the only thing worth matching on.
    expect(
      isCreditsExhaustedError(
        new Error("402 Payment Required: CREDITS_EXHAUSTED"),
      ),
    ).toBe(true);
  });

  it("leaves genuine server errors alone", () => {
    // The failure mode that matters: a real error must keep its detail and
    // must not silently open the upgrade modal.
    expect(isCreditsExhaustedError(new Error("Rate limit exceeded"))).toBe(
      false,
    );
    expect(
      isCreditsExhaustedError(
        new Error(
          JSON.stringify({
            code: "INTERNAL_SERVER_ERROR",
            message: "Something went wrong",
            retryable: true,
          }),
        ),
      ),
    ).toBe(false);
    expect(
      isCreditsExhaustedError(
        new Error(JSON.stringify({ error: "Unauthorized" })),
      ),
    ).toBe(false);
  });

  it("does not throw on non-error values", () => {
    expect(isCreditsExhaustedError(undefined)).toBe(false);
    expect(isCreditsExhaustedError(null)).toBe(false);
    expect(isCreditsExhaustedError("CREDITS_EXHAUSTED")).toBe(false);
    expect(isCreditsExhaustedError({ code: "CREDITS_EXHAUSTED" })).toBe(false);
  });
});
