import { afterEach, describe, expect, test, vi } from "vitest";

const { uploadMock, loggerMock, createSandboxMock } = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  createSandboxMock: vi.fn(),
}));

vi.mock("lib/file-storage", () => ({
  serverFileStorage: { upload: uploadMock },
}));
vi.mock("lib/logger", () => ({ default: loggerMock }));
vi.mock("lib/e2b/create-sandbox", () => ({
  EXEC_SANDBOX_TIMEOUT_MS: 60_000,
  createSandbox: createSandboxMock,
  errorLabel: (err: unknown) => String(err),
  toSandboxErrorResponse: (err: unknown) => ({ message: String(err) }),
  isTemplateNotFound: (err: unknown) =>
    err instanceof Error && /^\d{3}:/.test(err.message)
      ? err.message.startsWith("404:")
      : false,
}));
vi.mock("lib/e2b/artifact-files", () => ({
  collectGeneratedFiles: vi.fn().mockResolvedValue([]),
  snapshotWorkdir: vi.fn().mockResolvedValue(new Set()),
}));

import type { E2BArtifact, LogEntry } from "./code-runner.interface";
import {
  describeExecutionError,
  e2bRun,
  persistArtifacts,
  stageFiles,
} from "./e2b-run";

afterEach(() => {
  vi.clearAllMocks();
  // Leaks into every later test's template resolution otherwise.
  delete process.env.E2B_EXECUTION_TEMPLATE;
});

function b64(s: string) {
  return Buffer.from(s).toString("base64");
}

describe("persistArtifacts", () => {
  test("uploads base64 artifacts and swaps in a durable download URL (dropping base64)", async () => {
    uploadMock.mockResolvedValue({
      key: "user-1/uuid-report.pdf",
      sourceUrl: "https://cdn.example.com/report.pdf",
      metadata: {},
    });
    const artifacts: E2BArtifact[] = [
      {
        filename: "report.pdf",
        mimeType: "application/pdf",
        contentBase64: b64("PDF"),
      },
    ];

    const [out] = await persistArtifacts(artifacts, "user-1");

    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        contentType: "application/pdf",
        filename: "report.pdf",
        userId: "user-1",
        uploadType: "attachment",
      }),
    );
    // The persisted URL must be the authenticated app route, not a bucket
    // URL — public/signed bucket URLs break after refresh or expiry.
    expect(out.url).toBe(
      `/api/storage/download?key=${encodeURIComponent("user-1/uuid-report.pdf")}`,
    );
    expect(out.contentBase64).toBeUndefined();
    // Measured from the decoded bytes, so the card can show it after refresh.
    expect(out.sizeBytes).toBe(3);
  });

  test("prefers the size measured at collection time", async () => {
    uploadMock.mockResolvedValue({
      key: "user-1/uuid-book.xlsx",
      sourceUrl: "https://cdn.example.com/book.xlsx",
      metadata: {},
    });

    const [out] = await persistArtifacts(
      [
        {
          filename: "book.xlsx",
          mimeType: "application/octet-stream",
          sizeBytes: 42,
          contentBase64: b64("xyz"),
        },
      ],
      "user-1",
    );

    expect(out.sizeBytes).toBe(42);
  });

  test("uploads byte artifacts without a base64 round trip and never returns bytes", async () => {
    uploadMock.mockResolvedValue({
      key: "user-1/uuid-book.xlsx",
      sourceUrl: "https://cdn.example.com/book.xlsx",
      metadata: {},
    });
    const bytes = new Uint8Array([1, 2, 3, 4]);

    const [out] = await persistArtifacts(
      [
        {
          filename: "book.xlsx",
          mimeType: "application/octet-stream",
          sizeBytes: 4,
          bytes,
        },
      ],
      "user-1",
    );

    expect(uploadMock.mock.calls[0]![0]).toBeInstanceOf(Buffer);
    expect(out).toEqual({
      filename: "book.xlsx",
      mimeType: "application/octet-stream",
      sizeBytes: 4,
      url: `/api/storage/download?key=${encodeURIComponent("user-1/uuid-book.xlsx")}`,
    });
    // The result is JSON-serialised into the tool-call response.
    expect(JSON.stringify(out)).not.toContain("bytes");
  });

  test("names a large file with the reason when its upload fails, instead of inlining megabytes", async () => {
    uploadMock.mockRejectedValue(new Error("storage down"));
    const big = new Uint8Array(3 * 1024 * 1024);

    const [out] = await persistArtifacts([
      { filename: "big.bin", sizeBytes: big.byteLength, bytes: big },
    ]);

    expect(out).toEqual({
      filename: "big.bin",
      sizeBytes: 3 * 1024 * 1024,
      error: "upload failed",
    });
    expect(JSON.stringify(out)).not.toContain("bytes");
  });

  test("passes a metadata-only entry through without uploading", async () => {
    const [out] = await persistArtifacts([
      { filename: "huge.pdf", sizeBytes: 1, error: "file too large" },
    ]);

    expect(uploadMock).not.toHaveBeenCalled();
    expect(out).toEqual({
      filename: "huge.pdf",
      sizeBytes: 1,
      error: "file too large",
    });
  });

  test("keeps base64 as a fallback when the upload fails", async () => {
    uploadMock.mockRejectedValue(new Error("storage down"));
    const artifacts: E2BArtifact[] = [
      { filename: "data.csv", mimeType: "text/csv", contentBase64: b64("a,b") },
    ];

    const [out] = await persistArtifacts(artifacts);

    expect(out.url).toBeUndefined();
    expect(out.contentBase64).toBe(b64("a,b"));
  });

  test("leaves artifacts without base64 untouched (no upload)", async () => {
    const artifacts: E2BArtifact[] = [
      { filename: "x.png", mimeType: "image/png", url: "https://cdn/x.png" },
    ];

    const [out] = await persistArtifacts(artifacts);

    expect(uploadMock).not.toHaveBeenCalled();
    expect(out.url).toBe("https://cdn/x.png");
  });
});

describe("stageFiles", () => {
  test("writes an uploaded CSV into the interpreter working directory", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const logs: LogEntry[] = [];

    const staged = await stageFiles(
      { files: { write } } as never,
      [
        {
          filename: "account-statement_21-Oct-2025_04-Aug-2026.csv",
          bytes: Buffer.from("date,revenue\n2026-08-01,42\n"),
        },
      ],
      logs,
    );

    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toBe(
      "/home/user/account-statement_21-Oct-2025_04-Aug-2026.csv",
    );
    expect(Buffer.from(write.mock.calls[0][1] as ArrayBuffer).toString()).toBe(
      "date,revenue\n2026-08-01,42\n",
    );
    expect(staged).toEqual(["account-statement_21-Oct-2025_04-Aug-2026.csv"]);
    expect(logs[0]?.args[0]).toEqual({
      type: "data",
      value:
        "Staged attachment in /home/user: account-statement_21-Oct-2025_04-Aug-2026.csv",
    });
  });
});

describe("e2bRun", () => {
  test("reports code that raised as a failure, and logs it", async () => {
    // A SyntaxError is a normal `runCode` result, not a throw, so it never
    // reached the logger — the failure was invisible in production.
    createSandboxMock.mockResolvedValue({
      sandboxId: "sbx-1",
      runCode: vi.fn().mockResolvedValue({
        logs: { stdout: [], stderr: [] },
        results: [],
        error: {
          name: "SyntaxError",
          value:
            "closing parenthesis ']' does not match opening parenthesis '{'",
        },
      }),
      kill: vi.fn().mockResolvedValue(undefined),
    });
    process.env.E2B_API_KEY = "key";

    const result = await e2bRun("print(", "python", {
      userId: "u1",
      customerId: "c1",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("SyntaxError");
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining("SyntaxError"),
    );
    expect(loggerMock.warn.mock.calls[0]![0]).toContain("[e2b]");
  });

  test("persists kernel image output and returns it without bytes", async () => {
    createSandboxMock.mockResolvedValue({
      sandboxId: "sbx-3",
      runCode: vi.fn().mockResolvedValue({
        logs: { stdout: [], stderr: [] },
        results: [{ png: b64("PNG") }],
        error: undefined,
      }),
      kill: vi.fn().mockResolvedValue(undefined),
    });
    uploadMock.mockResolvedValue({
      key: "u1/uuid-output.png",
      sourceUrl: "https://cdn.example.com/output.png",
      metadata: {},
    });
    process.env.E2B_API_KEY = "key";

    const result = await e2bRun("plt.show()", "python", {
      userId: "u1",
      customerId: "c1",
    });

    expect(result.artifacts?.[0]).toMatchObject({
      filename: "output.png",
      sizeBytes: 3,
      url: expect.stringContaining("/api/storage/download?key="),
    });
    expect(JSON.stringify(result)).not.toContain('"bytes"');
  });

  test("does not log an error line for a clean run", async () => {
    createSandboxMock.mockResolvedValue({
      sandboxId: "sbx-2",
      runCode: vi.fn().mockResolvedValue({
        logs: { stdout: ["42"], stderr: [] },
        results: [],
        error: undefined,
      }),
      kill: vi.fn().mockResolvedValue(undefined),
    });
    process.env.E2B_API_KEY = "key";

    const result = await e2bRun("print(42)", "python", {
      userId: "u1",
      customerId: "c1",
    });

    expect(result.success).toBe(true);
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  // E2B_EXECUTION_TEMPLATE took production down by naming a template that had
  // never been built: both Python and JS resolve the same id, so every run
  // failed. Degrading to the stock interpreter loses the preinstalled document
  // libraries; it does not lose code execution.
  test("falls back to the stock interpreter when the template does not exist", async () => {
    const sbx = {
      sandboxId: "sbx-3",
      runCode: vi.fn().mockResolvedValue({
        logs: { stdout: ["ok"], stderr: [] },
        results: [],
        error: undefined,
      }),
      kill: vi.fn().mockResolvedValue(undefined),
    };
    createSandboxMock
      .mockRejectedValueOnce(
        new Error("404: template 'navigator-python-docs' not found"),
      )
      .mockResolvedValueOnce(sbx);
    process.env.E2B_API_KEY = "key";
    process.env.E2B_EXECUTION_TEMPLATE = "navigator-python-docs";

    const result = await e2bRun("print(1)", "python", {
      userId: "u1",
      customerId: "c1",
    });

    expect(result.success).toBe(true);
    expect(createSandboxMock).toHaveBeenCalledTimes(2);
    expect(createSandboxMock.mock.calls[0]?.[0]).toBe("navigator-python-docs");
    expect(createSandboxMock.mock.calls[1]?.[0]).toBe("code-interpreter-v1");
    // The operator's only clue that the env var is wrong.
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining("E2B_EXECUTION_TEMPLATE"),
    );
  });

  test("does not retry the stock interpreter against itself", async () => {
    // Nothing left to fall back to — one attempt, and the error surfaces.
    //
    // The template is pinned rather than left to the registry default: this
    // case is about the configured template already BEING the fallback, so
    // leaning on the default made the test silently stop testing that the
    // day the default moved to navigator-python-docs.
    process.env.E2B_EXECUTION_TEMPLATE = "code-interpreter-v1";
    createSandboxMock.mockRejectedValue(
      new Error("404: template 'code-interpreter-v1' not found"),
    );
    process.env.E2B_API_KEY = "key";

    const result = await e2bRun("print(1)", "python", {
      userId: "u1",
      customerId: "c1",
    });

    expect(result.success).toBe(false);
    expect(createSandboxMock).toHaveBeenCalledTimes(1);
  });
});

describe("describeExecutionError", () => {
  test("tells the model how to recover from a missing module", () => {
    // The single most common PDF failure in production. With only the bare
    // exception the model re-ran the same import instead of installing.
    const message = describeExecutionError({
      name: "ModuleNotFoundError",
      value: "No module named 'reportlab'",
    });

    expect(message).toContain("ModuleNotFoundError");
    expect(message).toContain("!pip install -q reportlab");
    expect(message).toContain("SAME code block");
  });

  test("leaves every other error untouched", () => {
    expect(
      describeExecutionError({ name: "ValueError", value: "bad input" }),
    ).toBe("ValueError: bad input");
    // No module name to extract — nothing useful to add.
    expect(
      describeExecutionError({ name: "ModuleNotFoundError", value: "opaque" }),
    ).toBe("ModuleNotFoundError: opaque");
  });
});
