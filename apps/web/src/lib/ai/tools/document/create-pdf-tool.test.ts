import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSandbox: vi.fn(),
  persistArtifacts: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("lib/e2b/create-sandbox", () => ({
  createSandbox: mocks.createSandbox,
  errorLabel: (err: unknown) => String(err),
  toSandboxErrorResponse: (err: unknown) => ({ message: String(err) }),
}));
vi.mock("lib/code-runner/e2b-run", () => ({
  persistArtifacts: mocks.persistArtifacts,
}));
vi.mock("lib/logger", () => ({ default: mocks.logger }));

import { createPdfTool, ensurePdfName } from "./create-pdf-tool";

const CTX = { userId: "user_1", customerId: "cus_1" };

/** Minimal stand-in for the E2B sandbox surface the tool touches. */
function fakeSandbox({
  error,
  pdf = Buffer.from("%PDF-1.7 body padded out to look like a real document"),
}: { error?: { name: string; value: string }; pdf?: Buffer } = {}) {
  return {
    sandboxId: "sbx_1",
    files: {
      write: vi.fn().mockResolvedValue(undefined),
      read: vi.fn().mockResolvedValue(new Uint8Array(pdf)),
    },
    runCode: vi.fn().mockResolvedValue({ error }),
    kill: vi.fn().mockResolvedValue(undefined),
  };
}

/** The AI SDK passes a second argument the tool ignores. */
function run(tool: ReturnType<typeof createPdfTool>, input: unknown) {
  return (tool.execute as (i: unknown, o: unknown) => Promise<any>)(
    input,
    {} as never,
  );
}

afterEach(() => vi.clearAllMocks());

describe("createPdfTool", () => {
  test("renders the HTML and returns a durable artifact", async () => {
    const sbx = fakeSandbox();
    mocks.createSandbox.mockResolvedValue(sbx);
    mocks.persistArtifacts.mockImplementation(async (artifacts: any[]) =>
      artifacts.map((a) => ({
        filename: a.filename,
        mimeType: a.mimeType,
        url: `/api/storage/download?key=user_1%2Fuuid-${a.filename}`,
      })),
    );

    const result = await run(createPdfTool(CTX), {
      filename: "offer.pdf",
      html: "<h1>Offer</h1>",
      title: "Offer for Acme",
    });

    expect(result.success).toBe(true);
    expect(result.artifacts).toEqual([
      {
        filename: "offer.pdf",
        mimeType: "application/pdf",
        url: "/api/storage/download?key=user_1%2Fuuid-offer.pdf",
        sizeBytes: expect.any(Number),
      },
    ]);

    // The HTML goes in as a file. Interpolating it into the script would let a
    // quote or backslash in the document change the program being run.
    const [writtenPath] = sbx.files.write.mock.calls[0];
    expect(writtenPath).toBe("/home/user/create-pdf-input.html");
    const [code] = sbx.runCode.mock.calls[0];
    expect(code).not.toContain("<h1>Offer</h1>");
    expect(code).toContain("weasyprint");

    // The sandbox must not outlive the request.
    expect(sbx.kill).toHaveBeenCalled();
  });

  test("reports a render failure instead of throwing", async () => {
    const sbx = fakeSandbox({
      error: { name: "ValueError", value: "bad CSS at line 3" },
    });
    mocks.createSandbox.mockResolvedValue(sbx);

    const result = await run(createPdfTool(CTX), {
      filename: "broken.pdf",
      html: "<h1>x</h1>",
    });

    // A failure the model can read and react to, not a thrown tool call.
    expect(result.success).toBe(false);
    expect(result.error).toContain("ValueError");
    expect(result.error).toContain("bad CSS at line 3");
    expect(mocks.persistArtifacts).not.toHaveBeenCalled();
    expect(sbx.kill).toHaveBeenCalled();
  });

  test("refuses an oversized document without starting a sandbox", async () => {
    const result = await run(createPdfTool(CTX), {
      filename: "huge.pdf",
      html: "x".repeat(3 * 1024 * 1024),
    });

    expect(result.success).toBe(false);
    expect(mocks.createSandbox).not.toHaveBeenCalled();
  });

  test("surfaces a sandbox that never started", async () => {
    mocks.createSandbox.mockRejectedValue(new Error("template_not_available"));

    const result = await run(createPdfTool(CTX), {
      filename: "a.pdf",
      html: "<p>a</p>",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("template_not_available");
  });
});

describe("ensurePdfName", () => {
  test("guarantees the extension", () => {
    expect(ensurePdfName("offer")).toBe("offer.pdf");
    expect(ensurePdfName("offer.pdf")).toBe("offer.pdf");
    expect(ensurePdfName("OFFER.PDF")).toBe("OFFER.PDF");
  });

  test("strips path traversal out of the name", () => {
    expect(ensurePdfName("../../etc/passwd")).toBe("passwd.pdf");
    expect(ensurePdfName("")).toBe("document.pdf");
  });
});
