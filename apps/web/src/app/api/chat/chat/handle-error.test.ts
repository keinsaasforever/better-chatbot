import { GatewayForbiddenError } from "@ai-sdk/gateway";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("logger", () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { handleError } = await import("./message");

describe("handleError", () => {
  it("explains a gateway refusal, even when wrapped", () => {
    const refusal = new GatewayForbiddenError({
      message: "AI Gateway requires a valid credit card on file",
    });
    const wrapped = new Error("stream failed", { cause: refusal });

    expect(handleError(wrapped)).toMatch(/AI Gateway refused the request/);
  });

  it("names the free-tier restriction instead of failing generically", () => {
    const refusal = new Error(
      "Free tier users do not have access to this model. Upgrade to paid credits for unrestricted access.",
    );
    expect(handleError(new Error("stream", { cause: refusal }))).toMatch(
      /needs paid AI Gateway credits/,
    );
  });

  it("keeps the generic message for anything else", () => {
    expect(handleError(new Error("boom"))).toMatch(/could not be completed/);
  });
});
