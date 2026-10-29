import { afterEach, describe, expect, test, vi } from "vitest";

// Shared create() spy, hoisted so the (hoisted) vi.mock factory can close over it.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

// Mock the SDK with real error subclasses (so `instanceof` works) and a
// controllable Sandbox.create. Classes are declared INSIDE the factory because
// vi.mock is hoisted above module-level declarations.
vi.mock("@e2b/code-interpreter", () => {
  class SandboxError extends Error {}
  class NotFoundError extends SandboxError {}
  class TemplateError extends SandboxError {}
  class AuthenticationError extends SandboxError {}
  class RateLimitError extends SandboxError {}
  class TimeoutError extends SandboxError {}
  class InvalidArgumentError extends SandboxError {}
  return {
    Sandbox: { create: (...args: unknown[]) => createMock(...args) },
    SandboxError,
    NotFoundError,
    TemplateError,
    AuthenticationError,
    RateLimitError,
    TimeoutError,
    InvalidArgumentError,
  };
});

vi.mock("lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Import the mocked error classes so assertions use the same identities the
// helper checks against.
import {
  AuthenticationError,
  NotFoundError,
  RateLimitError,
  TimeoutError,
} from "@e2b/code-interpreter";
import {
  PREVIEW_IDLE_TIMEOUT_MS,
  PREVIEW_SETUP_TIMEOUT_MS,
  createSandbox,
  isPreviewTemplate,
  secureForTemplate,
  toSandboxErrorResponse,
  waitForSandboxReady,
} from "./create-sandbox";

function fakeSandbox(host = "app-3000.e2b.dev") {
  return { sandboxId: "sbx_123", getHost: vi.fn().mockReturnValue(host) };
}

const billing = {
  userId: "user_123",
  customerId: "org_123",
  entityId: "user_123",
};

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("preview sandbox timeouts", () => {
  // The setup TTL has to outlast the whole create path — dependency install
  // (60s) plus readiness polling (30s) — or the sandbox pauses mid-setup and
  // the user gets a 504 instead of a preview. Both budgets live in
  // app/api/sandbox/route.ts; this is the guard rail against a future TTL cut
  // silently reintroducing that bug.
  const INSTALL_TIMEOUT_MS = 60_000;
  const READINESS_BUDGET_MS = 30_000;

  test("setup TTL leaves headroom over install plus readiness", () => {
    expect(PREVIEW_SETUP_TIMEOUT_MS).toBeGreaterThan(
      INSTALL_TIMEOUT_MS + READINESS_BUDGET_MS,
    );
  });

  test("the idle TTL is shorter than the setup TTL", () => {
    expect(PREVIEW_IDLE_TIMEOUT_MS).toBeLessThan(PREVIEW_SETUP_TIMEOUT_MS);
  });

  test("the idle TTL stays above the auto-resume minimum", () => {
    // An auto-resumed sandbox gets a 5-minute floor from E2B regardless, so
    // cutting below ~3min buys nothing and only risks killing a live preview
    // after a couple of dropped heartbeats.
    expect(PREVIEW_IDLE_TIMEOUT_MS).toBeGreaterThanOrEqual(3 * 60 * 1000);
  });
});

describe("isPreviewTemplate / secureForTemplate", () => {
  test("exec-only template is not a preview and is secured", () => {
    expect(isPreviewTemplate("code-interpreter-v1")).toBe(false);
    expect(secureForTemplate("code-interpreter-v1")).toBe(true);
  });

  test("dev-server templates are previews and run insecure for the iframe", () => {
    for (const t of [
      "nextjs-developer",
      "vue-developer",
      "navigator-remotion-nextjs",
    ]) {
      expect(isPreviewTemplate(t)).toBe(true);
      expect(secureForTemplate(t)).toBe(false);
    }
  });
});

describe("createSandbox", () => {
  test("returns the sandbox on first success", async () => {
    const sbx = fakeSandbox();
    createMock.mockResolvedValueOnce(sbx);
    await expect(createSandbox("nextjs-developer", { billing })).resolves.toBe(
      sbx,
    );
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  test("passes secure=false for preview templates, secure=true for exec", async () => {
    createMock.mockResolvedValue(fakeSandbox());
    await createSandbox("nextjs-developer", { billing });
    expect(createMock).toHaveBeenLastCalledWith(
      "nextjs-developer",
      expect.objectContaining({ secure: false }),
    );
    await createSandbox("code-interpreter-v1", { billing });
    expect(createMock).toHaveBeenLastCalledWith(
      "code-interpreter-v1",
      expect.objectContaining({ secure: true }),
    );
  });

  test("retries a retryable error then succeeds", async () => {
    const sbx = fakeSandbox();
    createMock
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValueOnce(sbx);
    await expect(
      createSandbox("nextjs-developer", { billing, backoffMs: 0 }),
    ).resolves.toBe(sbx);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  test("does NOT retry a rate-limit response", async () => {
    createMock.mockRejectedValue(new RateLimitError("rate limited"));
    await expect(
      createSandbox("nextjs-developer", {
        billing,
        backoffMs: 0,
        maxAttempts: 3,
      }),
    ).rejects.toBeInstanceOf(RateLimitError);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  test("does NOT retry NotFoundError (fails fast)", async () => {
    createMock.mockRejectedValue(new NotFoundError("no template"));
    await expect(
      createSandbox("nextjs-developer", {
        billing,
        backoffMs: 0,
        maxAttempts: 3,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  // The regression this file missed, and the mock above is why: it builds a
  // class hierarchy in which `instanceof` works. Production has no such
  // guarantee — a missing template arrives as an error class this module does
  // not recognise, carrying the status in its message, so every such call was
  // classified retryable and burned both attempts. Hence a plain Error here.
  test("does NOT retry an unrecognised 404 (the production shape)", async () => {
    createMock.mockRejectedValue(
      new Error("404: template 'navigator-python-docs' not found"),
    );
    await expect(
      createSandbox("navigator-python-docs", {
        billing,
        backoffMs: 0,
        maxAttempts: 3,
      }),
    ).rejects.toThrow("404");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  test("still retries an unrecognised 5xx", async () => {
    const sbx = fakeSandbox();
    createMock
      .mockRejectedValueOnce(new Error("503: service unavailable"))
      .mockResolvedValueOnce(sbx);
    await expect(
      createSandbox("nextjs-developer", { billing, backoffMs: 0 }),
    ).resolves.toBe(sbx);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  test("gives up after maxAttempts on persistent retryable error", async () => {
    createMock.mockRejectedValue(new TimeoutError("timeout"));
    await expect(
      createSandbox("nextjs-developer", {
        billing,
        backoffMs: 0,
        maxAttempts: 2,
      }),
    ).rejects.toBeInstanceOf(TimeoutError);
    expect(createMock).toHaveBeenCalledTimes(2);
  });
});

describe("toSandboxErrorResponse", () => {
  test("NotFound → 502 template_not_available with template name", () => {
    const r = toSandboxErrorResponse(new NotFoundError("nf"), "vue-developer");
    expect(r.status).toBe(502);
    expect(r.code).toBe("template_not_available");
    expect(r.message).toContain("vue-developer");
  });

  test("Authentication → 500 e2b_auth", () => {
    const r = toSandboxErrorResponse(new AuthenticationError("auth"));
    expect(r.status).toBe(500);
    expect(r.code).toBe("e2b_auth");
  });

  test("RateLimit → 429, Timeout → 504", () => {
    expect(toSandboxErrorResponse(new RateLimitError("rl")).status).toBe(429);
    expect(toSandboxErrorResponse(new TimeoutError("to")).status).toBe(504);
  });

  test("unrecognised 404 → 502 template_not_available, not a generic retry-me", () => {
    // What the user actually saw while this was broken: "Failed to start the
    // sandbox. Please try again." — advice that could never work.
    const r = toSandboxErrorResponse(
      new Error("404: template 'navigator-python-docs' not found"),
      "navigator-python-docs",
    );
    expect(r.status).toBe(502);
    expect(r.code).toBe("template_not_available");
    expect(r.retryable).toBe(false);
    expect(r.message).toContain("navigator-python-docs");
  });

  test("unknown error → 500 e2b_error", () => {
    const r = toSandboxErrorResponse(new Error("boom"));
    expect(r.status).toBe(500);
    expect(r.code).toBe("e2b_error");
  });
});

describe("waitForSandboxReady", () => {
  test("ready as soon as the host returns a non-502 status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
    const res = await waitForSandboxReady(fakeSandbox() as never, 3000, 5000);
    expect(res.ready).toBe(true);
    expect(res.lastStatus).toBe(200);
  });

  test("treats a redirect (3xx) as ready", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 307 }));
    const res = await waitForSandboxReady(fakeSandbox() as never, 3000, 5000);
    expect(res.ready).toBe(true);
  });

  test("not ready once the budget is exhausted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 502 }));
    // budget 0 → loop body never runs, returns not-ready immediately
    const res = await waitForSandboxReady(fakeSandbox() as never, 3000, 0);
    expect(res.ready).toBe(false);
    expect(res.detail).toBeTruthy();
  });
});
