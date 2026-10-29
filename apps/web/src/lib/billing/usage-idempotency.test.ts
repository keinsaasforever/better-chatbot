import { describe, expect, test } from "vitest";
import { billingRunKey } from "./usage-idempotency";

const CUSTOMER = "f910a0a8-6e2f-454d-8ae8-ebacc062f7e6";
const MESSAGE = "3accaac1-1915-4afb-b687-9f41c8a152a7";

describe("billingRunKey", () => {
  // The production defect: a client-side tool ends the stream, the browser runs
  // the tool and posts back under the SAME user message id. Fourteen model runs
  // shared one key; Autumn billed one and rejected thirteen.
  test("gives two runs of one message distinct keys", () => {
    const first = billingRunKey({
      scope: "chat",
      subject: CUSTOMER,
      detail: MESSAGE,
      runId: "run-1",
    });
    const second = billingRunKey({
      scope: "chat",
      subject: CUSTOMER,
      detail: MESSAGE,
      runId: "run-2",
    });

    expect(first).not.toBe(second);
  });

  // The other half, and why the runId is not simply random per call: every
  // writer retries with identical params and must stay deduped.
  test("is stable for a retry of the same run", () => {
    const args = {
      scope: "chat",
      subject: CUSTOMER,
      detail: MESSAGE,
      runId: "run-1",
    };
    expect(billingRunKey(args)).toBe(billingRunKey(args));
  });

  test("keeps different scopes apart for the same subject and run", () => {
    expect(
      billingRunKey({ scope: "chat", subject: CUSTOMER, runId: "run-1" }),
    ).not.toBe(
      billingRunKey({ scope: "reserve", subject: CUSTOMER, runId: "run-1" }),
    );
  });

  // Temporary chat used to fall back to a literal "unknown" here, so every
  // id-less request across one customer collapsed onto a single key.
  test("stays unique without a detail", () => {
    expect(
      billingRunKey({ scope: "temp-chat", subject: CUSTOMER, runId: "run-1" }),
    ).not.toBe(
      billingRunKey({ scope: "temp-chat", subject: CUSTOMER, runId: "run-2" }),
    );
  });

  test("omits an absent detail rather than leaving a gap", () => {
    expect(
      billingRunKey({ scope: "chat", subject: CUSTOMER, runId: "run-1" }),
    ).toBe(`chat:${CUSTOMER}:run-1`);
  });
});
