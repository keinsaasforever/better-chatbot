import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSandbox: vi.fn(),
  connect: vi.fn(),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  pause: vi.fn(),
  sanitize: vi.fn(),
  setTimeout: vi.fn(),
  waitForReady: vi.fn(),
  findReusable: vi.fn(),
  listSuperseded: vi.fn(),
  markState: vi.fn(),
  upsert: vi.fn(),
}));

// Keep the real error classes — create-sandbox.ts narrows on them with
// `instanceof`, so replacing the whole module breaks its error mapping.
vi.mock("@e2b/code-interpreter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@e2b/code-interpreter")>();
  return {
    ...actual,
    Sandbox: {
      setTimeout: mocks.setTimeout,
      connect: mocks.connect,
      pause: mocks.pause,
    },
  };
});

vi.mock("lib/db/pg/repositories/sandbox-session-repository.pg", () => ({
  pgSandboxSessionRepository: {
    findReusable: mocks.findReusable,
    listSuperseded: mocks.listSuperseded,
    markState: mocks.markState,
    upsert: mocks.upsert,
  },
}));

vi.mock("auth/route-guard", () => ({
  withAuth:
    (
      handler: (
        request: Request,
        session: { user: { id: string } },
      ) => Promise<Response>,
    ) =>
    (request: Request) =>
      handler(request, { user: { id: "user_123" } }),
}));

vi.mock("@/lib/gate", () => ({
  requireBillingContext: vi.fn().mockResolvedValue({
    customerId: "org_123",
    userId: "user_123",
    entityId: "user_123",
  }),
}));

vi.mock("lib/logger", () => ({
  default: {
    error: mocks.loggerError,
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
  },
}));

vi.mock("lib/e2b/nextjs-route-sanitizer", () => ({
  collectSandboxFilePaths: vi.fn().mockReturnValue(["pages/index.tsx"]),
  sanitizeNextJsRouteConflicts: mocks.sanitize,
}));

vi.mock("lib/e2b/create-sandbox", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("lib/e2b/create-sandbox")>();
  return {
    ...actual,
    createSandbox: mocks.createSandbox,
    waitForSandboxReady: mocks.waitForReady,
  };
});

import {
  PREVIEW_IDLE_TIMEOUT_MS,
  PREVIEW_SETUP_TIMEOUT_MS,
} from "lib/e2b/create-sandbox";
import { POST } from "./route";

function sandbox() {
  return {
    sandboxId: "sbx_123",
    commands: { run: vi.fn().mockResolvedValue({}) },
    files: { write: vi.fn().mockResolvedValue(undefined) },
    getHost: vi.fn().mockReturnValue("preview.e2b.app"),
    kill: vi.fn().mockResolvedValue(undefined),
  };
}

function request(
  fragment: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  return new Request("http://localhost/api/sandbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fragment: {
        template: "nextjs-developer",
        file_path: "pages/index.tsx",
        code: "export default function Home(){return <main>ok</main>}",
        ...fragment,
      },
      toolCallId: "tool_123",
      requestId: "6d6fb39f-94af-48f7-b888-5d13ec3a5f0d",
      ...overrides,
    }),
  });
}

const THREAD_ID = "0a2c8d1e-5b3f-4a7c-9e1d-2f4b6a8c0e13";

beforeEach(() => {
  process.env.E2B_API_KEY = "test-key";
  mocks.sanitize.mockResolvedValue(undefined);
  mocks.setTimeout.mockResolvedValue(undefined);
  mocks.pause.mockResolvedValue(true);
  mocks.waitForReady.mockResolvedValue({ ready: true, lastStatus: 200 });
  mocks.findReusable.mockResolvedValue(undefined);
  mocks.listSuperseded.mockResolvedValue([]);
  mocks.markState.mockResolvedValue(undefined);
  mocks.upsert.mockResolvedValue({});
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.E2B_API_KEY;
});

describe("POST /api/sandbox", () => {
  test.each([
    ["unknown-template", "unknown_template"],
    ["code-interpreter-v1", "execution_template_not_allowed"],
    ["navigator-remotion-nextjs", "template_disabled"],
  ])("rejects template %s with %s", async (template, code) => {
    const response = await POST(request({ template }) as never);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      requestId: "6d6fb39f-94af-48f7-b888-5d13ec3a5f0d",
      phase: "failed",
      failedPhase: "starting_sandbox",
      code,
      retryable: false,
    });
    expect(mocks.createSandbox).not.toHaveBeenCalled();
  });

  test("returns a structured invalid-payload error", async () => {
    const response = await POST(
      new Request("http://localhost/api/sandbox", {
        method: "POST",
        body: "{not-json",
      }) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      phase: "failed",
      failedPhase: "generating_code",
      code: "invalid_payload",
      retryable: false,
    });
    expect(body.requestId).toEqual(expect.any(String));
  });

  test("bounds creation separately from sandbox lifetime", async () => {
    const sbx = sandbox();
    mocks.createSandbox.mockResolvedValue(sbx);

    await POST(request({}) as never);

    expect(mocks.createSandbox).toHaveBeenCalledWith(
      "nextjs-developer",
      expect.objectContaining({
        billing: {
          userId: "user_123",
          customerId: "org_123",
          entityId: "user_123",
        },
        maxAttempts: 2,
        requestTimeoutMs: 30_000,
        // Generous enough to survive install + readiness; shortened below as
        // soon as the preview is live.
        timeoutMs: PREVIEW_SETUP_TIMEOUT_MS,
      }),
    );
  });

  test("shortens the TTL to the idle window once the preview is ready", async () => {
    // The sandbox is created with a setup-sized TTL, but from here the client
    // heartbeat keeps it alive — so drop it to the short idle TTL rather than
    // letting an abandoned preview run out the full setup window.
    const sbx = sandbox();
    mocks.createSandbox.mockResolvedValue(sbx);

    await POST(request({}) as never);

    expect(mocks.setTimeout).toHaveBeenCalledWith(
      "sbx_123",
      PREVIEW_IDLE_TIMEOUT_MS,
      expect.anything(),
    );
  });

  test("a failure to shorten the TTL does not fail the ready response", async () => {
    const sbx = sandbox();
    mocks.createSandbox.mockResolvedValue(sbx);
    mocks.setTimeout.mockRejectedValue(new Error("e2b unavailable"));

    const response = await POST(request({}) as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ phase: "ready" });
    expect(sbx.kill).not.toHaveBeenCalled();
  });

  describe("per-thread reuse", () => {
    test("reuses the thread's sandbox instead of creating another", async () => {
      // Without this, every tool call in a thread started its own sandbox and
      // they all billed concurrently until their TTLs expired.
      mocks.findReusable.mockResolvedValue({
        sandboxId: "sbx_existing",
        installCommandHash: null,
      });
      mocks.connect.mockResolvedValue(sandbox());

      const response = await POST(
        request({}, { threadId: THREAD_ID }) as never,
      );

      expect(response.status).toBe(200);
      expect(mocks.connect).toHaveBeenCalledWith(
        "sbx_existing",
        expect.anything(),
      );
      expect(mocks.createSandbox).not.toHaveBeenCalled();
    });

    test("creates a new sandbox when the thread has none", async () => {
      mocks.createSandbox.mockResolvedValue(sandbox());

      await POST(request({}, { threadId: THREAD_ID }) as never);

      expect(mocks.connect).not.toHaveBeenCalled();
      expect(mocks.createSandbox).toHaveBeenCalledOnce();
    });

    test("falls back to creating when the old sandbox is unreachable", async () => {
      mocks.findReusable.mockResolvedValue({ sandboxId: "sbx_dead" });
      mocks.connect.mockRejectedValue(new Error("sandbox not found"));
      mocks.createSandbox.mockResolvedValue(sandbox());

      const response = await POST(
        request({}, { threadId: THREAD_ID }) as never,
      );

      expect(response.status).toBe(200);
      expect(mocks.markState).toHaveBeenCalledWith("sbx_dead", "killed");
      expect(mocks.createSandbox).toHaveBeenCalledOnce();
    });

    test("skips the install when the command is unchanged", async () => {
      // sha256("npm install left-pad"), the same value the route derives.
      const sbx = sandbox();
      mocks.createSandbox.mockResolvedValue(sbx);

      // First deploy records the hash.
      await POST(
        request(
          {
            has_additional_dependencies: true,
            install_dependencies_command: "npm install left-pad",
          },
          { threadId: THREAD_ID },
        ) as never,
      );
      const recordedHash = mocks.upsert.mock.calls[0][0].installCommandHash;
      expect(recordedHash).toEqual(expect.any(String));

      // Second deploy reuses it and must not reinstall.
      vi.clearAllMocks();
      mocks.sanitize.mockResolvedValue(undefined);
      mocks.setTimeout.mockResolvedValue(undefined);
      mocks.waitForReady.mockResolvedValue({ ready: true, lastStatus: 200 });
      mocks.listSuperseded.mockResolvedValue([]);
      mocks.upsert.mockResolvedValue({});
      const reusedSbx = sandbox();
      mocks.findReusable.mockResolvedValue({
        sandboxId: "sbx_existing",
        installCommandHash: recordedHash,
      });
      mocks.connect.mockResolvedValue(reusedSbx);

      await POST(
        request(
          {
            has_additional_dependencies: true,
            install_dependencies_command: "npm install left-pad",
          },
          { threadId: THREAD_ID },
        ) as never,
      );

      expect(reusedSbx.commands.run).not.toHaveBeenCalled();
    });

    test("reinstalls when the command changed", async () => {
      const reusedSbx = sandbox();
      mocks.findReusable.mockResolvedValue({
        sandboxId: "sbx_existing",
        installCommandHash: "a-hash-of-something-else",
      });
      mocks.connect.mockResolvedValue(reusedSbx);

      await POST(
        request(
          {
            has_additional_dependencies: true,
            install_dependencies_command: "npm install right-pad",
          },
          { threadId: THREAD_ID },
        ) as never,
      );

      expect(reusedSbx.commands.run).toHaveBeenCalledOnce();
    });

    test("pauses a reused sandbox on failure — never kills it", async () => {
      // A reused sandbox holds the user's last working preview. Killing it on
      // a transient failure is unrecoverable; pausing costs nothing.
      const reusedSbx = sandbox();
      mocks.findReusable.mockResolvedValue({ sandboxId: "sbx_existing" });
      mocks.connect.mockResolvedValue(reusedSbx);
      mocks.waitForReady.mockResolvedValue({ ready: false, lastStatus: 502 });

      const response = await POST(
        request({}, { threadId: THREAD_ID }) as never,
      );

      expect(response.status).toBe(504);
      expect(reusedSbx.kill).not.toHaveBeenCalled();
      expect(mocks.pause).toHaveBeenCalledWith("sbx_123", expect.anything());
    });

    test("pauses sandboxes the new deploy supersedes", async () => {
      mocks.createSandbox.mockResolvedValue(sandbox());
      mocks.listSuperseded.mockResolvedValue([{ sandboxId: "sbx_old" }]);

      await POST(request({}, { threadId: THREAD_ID }) as never);

      expect(mocks.pause).toHaveBeenCalledWith("sbx_old", expect.anything());
      expect(mocks.markState).toHaveBeenCalledWith("sbx_old", "paused");
    });

    test("a bookkeeping failure does not fail a working preview", async () => {
      mocks.createSandbox.mockResolvedValue(sandbox());
      mocks.upsert.mockRejectedValue(new Error("db down"));

      const response = await POST(
        request({}, { threadId: THREAD_ID }) as never,
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ phase: "ready" });
    });
  });

  test("returns install_failed and cleans up", async () => {
    const sbx = sandbox();
    sbx.commands.run.mockRejectedValue(new Error("npm exited 1"));
    mocks.createSandbox.mockResolvedValue(sbx);

    const response = await POST(
      request({
        has_additional_dependencies: true,
        install_dependencies_command: "npm install broken-package",
      }) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      phase: "failed",
      failedPhase: "installing",
      code: "install_failed",
      retryable: true,
    });
    expect(sbx.commands.run).toHaveBeenCalledWith(
      "npm install broken-package",
      { timeoutMs: 60_000 },
    );
    expect(sbx.kill).toHaveBeenCalledOnce();
  });

  test("returns startup_not_ready and kills the unusable sandbox", async () => {
    const sbx = sandbox();
    mocks.createSandbox.mockResolvedValue(sbx);
    mocks.waitForReady.mockResolvedValue({
      ready: false,
      lastStatus: 502,
      detail: "not listening",
    });

    const response = await POST(request({}) as never);
    const body = await response.json();

    expect(response.status).toBe(504);
    expect(body).toMatchObject({
      phase: "failed",
      failedPhase: "checking_preview",
      code: "startup_not_ready",
      retryable: true,
    });
    expect(sbx.kill).toHaveBeenCalledOnce();
  });

  test("retains a successful preview and emits correlated phase logs", async () => {
    const sbx = sandbox();
    mocks.createSandbox.mockResolvedValue(sbx);

    const response = await POST(request({}) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      requestId: "6d6fb39f-94af-48f7-b888-5d13ec3a5f0d",
      phase: "ready",
      code: "sandbox_ready",
      retryable: false,
      sbxId: "sbx_123",
      template: "nextjs-developer",
      url: "https://preview.e2b.app",
      ready: true,
    });
    expect(sbx.kill).not.toHaveBeenCalled();
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      expect.stringContaining(
        "requestId=6d6fb39f-94af-48f7-b888-5d13ec3a5f0d phase=starting_sandbox",
      ),
    );
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      expect.stringContaining("phase=ready"),
    );
  });
});
